import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { JevLCMCompactionEngine } from '../src/compressor.js';
import { LcmStore } from '../src/store.js';

class StubModelTransport extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 10_000 } });
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'x' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

function harness(auto = false): { ctx: Context; agent: Agent; engine: JevLCMCompactionEngine; transport: StubModelTransport } {
  const ctx = new Context();
  new LlmRuntime(ctx);
  new SessionStore(ctx);
  new SessionProjectionRegistry(ctx);
  new TokenMeter(ctx);
  ctx.sessions.flush = async () => false;
  const transport = new StubModelTransport();
  ctx.llm.registerAdapter(['stub'], transport);
  const engine = new JevLCMCompactionEngine(ctx, {
    auto,
    thresholdRatio: 0.8,
    retainTokens: 0,
    databasePath: ':memory:',
    jev: { jev_anchor_protection_enabled: false },
  });
  const session = Session.create(SessionId(`host-${auto ? 'auto' : 'manual'}`));
  for (let turn = 1; turn <= 2; turn += 1) {
    session.append('turn/start', { turn });
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: `old user history ${turn} `.repeat(300) }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' });
    session.append('step/start', { turn, step: 1 });
    if (turn === 1) session.append('request/header', { header: { config: { provider: 'stub', model: 'stub' } }, reason: 'initial' });
    session.append('assistant/message', {
      stream: [], turn, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `old assistant history ${turn} `.repeat(1000) }],
        source: { kind: 'model', ...{ provider: 'stub', model: 'stub' } },
      }),
    }, { surfaceOp: 'append' });
    session.append('step/end', { turn, step: 1 });
    session.append('turn/end', { turn, reason: { kind: 'completed' } });
  }
  if (auto) session.append('turn/start', { turn: 3 });
  const agent = {
    session,
    options: { provider: 'stub', model: 'stub' },
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return task(new AbortController().signal);
    },
  } as unknown as Agent;
  return { ctx, agent, engine, transport };
}

test('compactNow uses the host model and commits exact host result boundaries', async () => {
  const h = harness();
  try {
    const result = await h.engine.compactNow(h.agent, new AbortController().signal);
    assert.ok(result);
    assert.equal(typeof result.summarySeq, 'number');
    assert.equal(typeof result.endSeq, 'number');
    assert.equal(h.transport.requests.length, 1);
    const events = h.agent.session.snapshotEvents();
    assert.equal(events.find((event) => event.seq === result.summarySeq)?.type, 'compaction/summary');
    assert.equal(events.find((event) => event.seq === result.endSeq)?.type, 'compaction/end');
    const nodes = h.engine.store.nodes(h.agent.session.id) as { status: string; host_summary_seq: number; host_end_seq: number }[];
    assert.equal(nodes.length, 1);
    assert.deepEqual({...nodes[0]}, { ...nodes[0], status: 'committed', host_summary_seq: result.summarySeq, host_end_seq: result.endSeq });
    const identities = h.engine.store.db.prepare('SELECT identity FROM raw WHERE session=? AND identity LIKE ? ORDER BY id').all(h.agent.session.id, 'message:%') as { identity: string }[];
    assert.ok(identities.length > 0);
    assert.ok(identities.every((row) => !/^message:\d+:/.test(row.identity)));
  } finally {
    await h.ctx.fiber.dispose();
  }
});

test('rollup condenses sibling leaf summaries through the host model', async () => {
  const h = harness();
  try {
    const raw = h.engine.store.ingest(h.agent.session.id, 'message:seed', { role: 'user', content: 'seed evidence' });
    const leaves: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      const node = h.engine.store.node(h.agent.session.id, `leaf summary ${i}`, [raw], [], false);
      h.engine.store.markNodeCommitted(node, i + 1, i + 2);
      leaves.push(node);
    }
    const nodeId = await h.engine.rollupOnce(h.agent, new AbortController().signal);
    assert.equal(typeof nodeId, 'number');
    assert.equal(h.transport.requests.length, 1);
    const nodes = h.engine.store.nodes(h.agent.session.id) as { id: number; depth: number; status: string }[];
    const rollup = nodes.find((node) => node.id === nodeId);
    assert.equal(rollup?.status, 'committed');
    const leafDepths = leaves.map((id) => Number(nodes.find((node) => node.id === id)?.depth));
    assert.ok(Number(rollup?.depth) > Math.max(...leafDepths));
    for (const id of leaves) assert.ok(h.engine.store.db.prepare('SELECT 1 FROM edges WHERE parent=? AND child=?').get(nodeId as number, id));
    const context = h.engine.store.assemble(h.agent.session.id, 20000);
    assert.ok(context.some((entry) => entry.node_id === nodeId));
    assert.ok(!context.some((entry) => leaves.includes(Number(entry.node_id))));
  } finally {
    await h.ctx.fiber.dispose();
  }
});

test('automatic pressure reaches the overridden compactRegion and commits only its host replacement', async () => {
  const h = harness(true);
  let calls = 0;
  const original = h.engine.compactRegion.bind(h.engine);
  h.engine.compactRegion = (async (...args: Parameters<JevLCMCompactionEngine['compactRegion']>) => {
    calls += 1;
    return original(...args);
  }) as JevLCMCompactionEngine['compactRegion'];
  try {
    const result = await h.engine.compactIfNeeded(h.agent, 'pressure', new AbortController().signal);
    assert.ok(result);
    assert.equal(calls, 1);
    assert.equal((h.engine.store.nodes(h.agent.session.id) as { status: string }[])[0]?.status, 'committed');
  } finally {
    await h.ctx.fiber.dispose();
  }
});

test('assembly excludes explicitly aborted summaries', () => {
  const first = new LcmStore(':memory:');
  const raw = first.ingest('reopen', 'message:native', { text: 'raw' });
  const pending = first.node('reopen', 'must not leak', [raw]);
  first.markNodeCommitted(pending, 1, 2);
  const aborted = first.node('reopen', 'aborted must not leak', [raw]);
  first.markNodeAborted(aborted);
  assert.ok(first.assemble('reopen', 10_000).every((entry) => !entry.text.includes('aborted')));
  first.close();
});
