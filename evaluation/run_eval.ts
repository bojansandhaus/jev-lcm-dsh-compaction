import { pathToFileURL } from 'node:url';
import { Prepass } from '../src/prepass.js';
import { ProviderChain } from '../src/providers.js';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime, { LlmAdapter, createMessage, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import TokenMeter from '@deepseek-ai/dsh-token-meter';
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { JevLCMCompactionEngine } from '../src/compressor.js';


class StubModelTransport extends LlmAdapter {
  readonly requests: GenerateOptions[] = [];
  constructor(readonly summary: string){super();}
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

function harness(protect: boolean, summary: string): { ctx: Context; agent: Agent; engine: JevLCMCompactionEngine; transport: StubModelTransport } {
  const auto = false;
  const ctx = new Context();
  new LlmRuntime(ctx);
  new SessionStore(ctx);
  new SessionProjectionRegistry(ctx);
  new TokenMeter(ctx);
  ctx.sessions.flush = async () => false;
  const transport = new StubModelTransport(summary);
  ctx.llm.registerAdapter(['stub'], transport);
  const engine = new JevLCMCompactionEngine(ctx, {
    auto,
    thresholdRatio: 0.8,
    retainTokens: 0,
    databasePath: ':memory:',
    jev: { jev_anchor_protection_enabled: protect },
  });
  const session = Session.create(SessionId(`host-${auto ? 'auto' : 'manual'}`));
  for (let turn = 1; turn <= 6; turn += 1) {
    session.append('turn/start', { turn });
    session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Continue the synthetic archive exercise.' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' });
    session.append('step/start', { turn, step: 1 });
    if (turn === 1) session.append('request/header', { header: { config: { provider: 'stub', model: 'stub' } }, reason: 'initial' });
    session.append('assistant/message', {
      stream: [], turn, step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: `Investigation ${turn}: ` + (turn === 1 ? 'The root cause is `deadbeef1234567`. ' : '') + 'Synthetic filler without evidence. '.repeat(1000) }],
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
  engine.states.set(session.id, new Prepass(engine.jevSettings,
    new ProviderChain(engine.jevSettings, {TYPESAFE_API_KEY:'synthetic'},
      async (_url,_key,payload) => ({answers:Object.fromEntries(Object.keys((payload as {questions:Record<string,unknown>}).questions).map(q=>[q,{noul:.99}]))}))));
  return { ctx, agent, engine, transport };
}


export async function evaluate(protect = true, budget = 10000, summary = 'Synthetic transport summary deliberately omits the evidence marker.') {
  if (!Number.isInteger(budget) || budget < 1) throw new Error('invalid budget');
  const h = harness(protect, summary);
  try {
    const input = h.ctx.tokenMeter.measure(h.agent.session).totalTokens;
    if (input <= budget) throw new Error('input must exceed target budget');
    const result = await h.engine.compactNow(h.agent, new AbortController().signal);
    assert.ok(result, 'host did not compact');
    assert.ok(h.transport.requests.length, 'model transport was not exercised');
    const active = h.ctx.tokenMeter.measure(h.agent.session).totalTokens;
    if (active > budget) throw new Error(`nonconvergence: ${active} > ${budget}`);
    const marker = 'deadbeef1234567';
    const context = JSON.stringify(h.agent.session.deriveMessages());
    const hits = h.engine.store.grep(h.agent.session.id, marker) as {id:number}[];
    const recovered = hits.some(hit => JSON.stringify(h.engine.store.expand(h.agent.session.id,hit.id)).includes(marker));
    return {mode:'synthetic-transport-integration', arm:protect?'jev-lcm':'ranking-disabled',
      budget_tokens:budget, token_accounting:'DSH tokenMeter estimate, same host accounting for both arms',
      input_tokens:input, active_tokens:active, exact_evidence_retention:Number(context.includes(marker)),
      raw_retrieval_retention:Number(recovered), freed_ratio:(input-active)/input,
      model_calls:h.transport.requests.length, production_comparison:false};
  } finally { await h.ctx.fiber.dispose(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if(process.argv.length>2) throw new Error('No live mode or external fixture flags are implemented');
  console.log(JSON.stringify(await Promise.all([evaluate(false),evaluate(true)]),null,2));
}
