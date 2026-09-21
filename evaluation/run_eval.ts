import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { JevLCMCompactionEngine } from '../src/compressor.js';
import { Prepass } from '../src/prepass.js';
import { ProviderChain } from '../src/providers.js';
import { settings } from '../src/settings.js';
import type { Message } from '../src/anchors.js';

/** Three arms, one measurement basis. See docs/evaluation.md for what each one proves. */
export const ARMS = ['ranking-disabled', 'jev-only', 'jev-lcm'] as const;
export type Arm = (typeof ARMS)[number];

export interface Fixture {
  name: string; note: string; budget_tokens: number; filler_turns: number; filler_repeat: number;
  markers: string[]; summary: string; tool_score: number; anchor_score: number;
  upstream_transcripts_available: boolean; upstream_production_run_reproduced: boolean;
}

export function loadFixture(): Fixture {
  const raw = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url), 'utf8')) as Partial<Fixture>;
  const required: (keyof Fixture)[] = ['budget_tokens', 'filler_turns', 'filler_repeat', 'markers', 'summary', 'tool_score', 'anchor_score'];
  const missing = required.filter((key) => raw[key] === undefined);
  if (missing.length) throw new Error('fixture missing keys: ' + missing.join(', '));
  if (!raw.markers?.length) throw new Error('fixture needs at least one marker');
  return raw as Fixture;
}

/** The transcript every arm is built from: filler turns, markers, and a closing request. */
export function fixtureTurns(fixture: Fixture): Message[] {
  const turns: Message[] = [{ role: 'user', content: 'Continue the synthetic archive exercise.' }];
  for (let turn = 0; turn < fixture.filler_turns; turn += 1) {
    const evidence = turn < fixture.markers.length ? 'The root cause is `' + fixture.markers[turn] + '` and it must stay exact. ' : '';
    turns.push({ role: 'assistant', content: 'Investigation ' + (turn + 1) + ': ' + evidence + 'Synthetic filler without evidence. '.repeat(fixture.filler_repeat) });
    turns.push({ role: 'user', content: 'Continue the synthetic archive exercise.' });
  }
  turns.push({ role: 'assistant', content: 'Ready.' });
  turns.push({ role: 'user', content: 'Report the retained evidence.' });
  return turns;
}

class StubModelTransport extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  constructor(readonly summary: string) { super(); }
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: 10_000 } });
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options);
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.summary } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}

function appendTurns(session: Session, turns: readonly Message[], startTurn = 1): number {
  let turn = startTurn;
  for (const message of turns) {
    session.append('turn/start', { turn });
    session.append('step/start', { turn, step: 1 });
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
    if (message.role === 'assistant') {
      session.append('assistant/message', {
        stream: [], turn, step: 1,
        message: createMessage({ role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model', provider: 'stub', model: 'stub' } }),
      }, { surfaceOp: 'append' });
    } else {
      session.append('user/message', createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }), { surfaceOp: 'append' });
    }
    session.append('step/end', { turn, step: 1 });
    session.append('turn/end', { turn, reason: { kind: 'completed' } });
    turn += 1;
  }
  return turn;
}

function baseContext(summary = 'unused'): { ctx: Context; transport: StubModelTransport } {
  const ctx = new Context();
  new LlmRuntime(ctx);
  new SessionStore(ctx);
  new SessionProjectionRegistry(ctx);
  new TokenMeter(ctx);
  ctx.sessions.flush = async () => false;
  const transport = new StubModelTransport(summary);
  ctx.llm.registerAdapter(['stub'], transport);
  return { ctx, transport };
}

/** Host condensation path. protect selects the Jev arm; without it this is the production equivalent stand in. */
function harness(protect: boolean, summary: string, fixture: Fixture) {
  const { ctx, transport } = baseContext(summary);
  const engine = new JevLCMCompactionEngine(ctx, {
    auto: false, thresholdRatio: 0.8, retainTokens: 0, databasePath: ':memory:',
    jev: { jev_anchor_protection_enabled: protect },
  });
  const session = Session.create(SessionId(protect ? 'jev-lcm' : 'ranking-disabled'));
  session.append('request/header', { header: { config: { provider: 'stub', model: 'stub' } }, reason: 'initial' });
  appendTurns(session, fixtureTurns(fixture));
  const agent = {
    session,
    options: { provider: 'stub', model: 'stub' },
    runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> { return task(new AbortController().signal); },
  } as unknown as Agent;
  engine.states.set(session.id, new Prepass(engine.jevSettings,
    new ProviderChain(engine.jevSettings, { TYPESAFE_API_KEY: 'synthetic' },
      async (_url, _key, payload) => ({ answers: Object.fromEntries(Object.keys((payload as { questions: Record<string, unknown> }).questions).map((q) => [q, { noul: .99 }])) }))));
  return { ctx, agent, engine, transport };
}

function retained(context: string, markers: readonly string[]): number {
  return markers.filter((marker) => context.includes(marker)).length;
}

async function runHostArm(arm: 'ranking-disabled' | 'jev-lcm', budget: number, summary: string, fixture: Fixture) {
  const h = harness(arm === 'jev-lcm', summary, fixture);
  try {
    const input = h.ctx.tokenMeter.measure(h.agent.session).totalTokens;
    if (input <= budget) throw new Error('input must exceed target budget');
    const result = await h.engine.compactNow(h.agent, new AbortController().signal);
    assert.ok(result, 'host did not compact');
    assert.ok(h.transport.requests.length, 'model transport was not exercised');
    const active = h.ctx.tokenMeter.measure(h.agent.session).totalTokens;
    if (active > budget) throw new Error('nonconvergence: ' + active + ' > ' + budget);
    const context = JSON.stringify(h.agent.session.deriveMessages());
    const hits = h.engine.store.grep(h.agent.session.id, fixture.markers[0]) as { id: number }[];
    const recovered = hits.some((hit) => JSON.stringify(h.engine.store.expand(h.agent.session.id, hit.id)).includes(fixture.markers[0]));
    const kept = retained(context, fixture.markers);
    return {
      mode: 'synthetic-transport-integration', arm, budget_tokens: budget,
      token_accounting: 'DSH tokenMeter estimate, the same host accounting for every arm',
      input_tokens: input, active_tokens: active, budget_converged: active <= budget,
      markers_total: fixture.markers.length, markers_retained: kept, recall_at_budget: kept / fixture.markers.length,
      raw_store: true, raw_retrieval_retention: Number(recovered),
      freed_ratio: (input - active) / input, model_calls: h.transport.requests.length,
    };
  } finally { await h.ctx.fiber.dispose(); }
}

/**
 * The arm PR #116246 rejected: Jev ranking with every user and assistant turn left
 * verbatim and no condensation path. It is measured so its text floor is visible,
 * not so it can be recommended. Budget overrun is a result here, not an error.
 */
async function runJevOnlyArm(budget: number, fixture: Fixture) {
  const { ctx } = baseContext();
  try {
    const turns = fixtureTurns(fixture);
    const baseline = Session.create(SessionId('jev-only-baseline'));
    baseline.append('request/header', { header: { config: { provider: 'stub', model: 'stub' } }, reason: 'initial' });
    appendTurns(baseline, turns);
    const input = ctx.tokenMeter.measure(baseline).totalTokens;

    const chain = new ProviderChain(settings({ jev_provider: 'typesafe' }), { TYPESAFE_API_KEY: 'synthetic' },
      async (_url, _key, payload) => ({ answers: Object.fromEntries(Object.keys((payload as { questions: Record<string, unknown> }).questions).map((q) => [q, { noul: fixture.anchor_score }])) }));
    const prepass = new Prepass(settings({ jev_provider: 'typesafe' }), chain);
    prepass.collect(turns, Math.max(1, turns.length - 2));
    await prepass.flush(true);
    const hint = prepass.hintBlock();

    const assembled = Session.create(SessionId('jev-only-assembled'));
    assembled.append('request/header', { header: { config: { provider: 'stub', model: 'stub' } }, reason: 'initial' });
    const nextTurn = appendTurns(assembled, turns);
    appendTurns(assembled, [{ role: 'user', content: hint }], nextTurn);
    const active = ctx.tokenMeter.measure(assembled).totalTokens;

    const context = JSON.stringify(assembled.deriveMessages());
    const kept = retained(context, fixture.markers);
    return {
      mode: 'synthetic-transport-integration', arm: 'jev-only' as const, budget_tokens: budget,
      token_accounting: 'DSH tokenMeter estimate, the same host accounting for every arm',
      input_tokens: input, active_tokens: active, budget_converged: active <= budget,
      markers_total: fixture.markers.length, markers_retained: kept, recall_at_budget: kept / fixture.markers.length,
      raw_store: false, raw_retrieval_retention: null,
      freed_ratio: (input - active) / input, model_calls: prepass.chain.calls,
      hint_chars: hint.length,
    };
  } finally { await ctx.fiber.dispose(); }
}

export async function evaluate(arm: Arm = 'jev-lcm', budget?: number, summary?: string, fixture: Fixture = loadFixture()) {
  if (!ARMS.includes(arm)) throw new Error('unknown arm: ' + String(arm));
  const target = budget ?? fixture.budget_tokens;
  if (!Number.isInteger(target) || target < 1) throw new Error('invalid budget');
  const text = summary ?? fixture.summary;
  return arm === 'jev-only' ? runJevOnlyArm(target, fixture) : runHostArm(arm, target, text, fixture);
}

/** Verdict compares the shipped arm against the production equivalent arm on the only axis this harness can measure. */
export function verdict(arms: Awaited<ReturnType<typeof evaluate>>[], fixture: Fixture) {
  const by = new Map(arms.map((arm) => [arm.arm, arm]));
  const production = by.get('ranking-disabled');
  const jevOnly = by.get('jev-only');
  const shipped = by.get('jev-lcm');
  if (!production || !jevOnly || !shipped) throw new Error('verdict needs all three arms');
  return {
    production_recall_at_budget: production.recall_at_budget,
    jev_lcm_recall_at_budget: shipped.recall_at_budget,
    jev_lcm_meets_or_beats_production: shipped.recall_at_budget >= production.recall_at_budget,
    jev_only_budget_converged: jevOnly.budget_converged,
    jev_only_recall_at_budget: jevOnly.recall_at_budget,
    upstream_transcripts_available: fixture.upstream_transcripts_available,
    upstream_production_run_reproduced: fixture.upstream_production_run_reproduced,
  };
}

export async function runAll() {
  const fixture = loadFixture();
  const arms = [await evaluate('ranking-disabled', undefined, undefined, fixture), await evaluate('jev-only', undefined, undefined, fixture), await evaluate('jev-lcm', undefined, undefined, fixture)];
  return { fixture: { name: fixture.name, note: fixture.note, budget_tokens: fixture.budget_tokens }, arms, verdict: verdict(arms, fixture) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length > 2) throw new Error('No live mode or external fixture flags are implemented');
  console.log(JSON.stringify(await runAll(), null, 2));
}
