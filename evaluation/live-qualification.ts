// Bounded live qualification of the DSH provider chain, at more than one request.
// Synthetic conversation only; no user data. Set one or both provider keys in the
// environment, then run `pnpm exec tsx evaluation/live-qualification.ts`.
// LIVE_QUALIFICATION_CALLS sets the scoring calls per provider (default 12).
import * as settingsModule from '../src/settings.js';
import * as shaper from '../src/state-shaper.js';
import { ProviderChain } from '../src/providers.js';

const exported = Object.keys(settingsModule).sort();

function buildConfig(): any {
  const factory = (settingsModule as any).defaultSettings ?? (settingsModule as any).loadSettings
    ?? (settingsModule as any).Settings ?? (settingsModule as any).settings;
  if (typeof factory === 'function') {
    try { return factory(); } catch { try { return new factory(); } catch { /* fall through */ } }
  }
  if (factory && typeof factory === 'object') return factory;
  return null;
}

const messages = [
  { role: 'user', content: 'Summarise the release checklist.' },
  { role: 'tool', content: 'make test: 27 passed in 3.1s '.repeat(40) },
  { role: 'assistant', content: 'The gate is `abc123def456` and src/a.ts at v1.2.3.' },
  { role: 'tool', content: 'git log --oneline -1: 0952d2b '.repeat(30) },
  { role: 'assistant', content: 'Keep the calibration threshold at 0.15 for now.' },
];
const candidates = [
  { id: 'a', kind: 'anchor', message_index: 2, text: 'abc123def456', start: 13, end: 25, scores: {}, action: 'unscored', jev_unscored: true },
  { id: 'b', kind: 'anchor', message_index: 4, text: '0952d2b', start: 0, end: 7, scores: {}, action: 'unscored', jev_unscored: true },
];

async function main(): Promise<void> {
  const config = buildConfig();
  if (!config) {
    console.log('no settings factory; exports are', JSON.stringify(exported));
    process.exit(2);
  }
  const built: any = (shaper as any).shape(messages, candidates, config);
  const report: any = {
    payload: {
      state_chars: JSON.stringify(built.state).length,
      question_count: Object.keys(built.questions).length,
      selected: built.selected.length,
      tier: built.tier,
      keys_present: ['TYPESAFE_API_KEY', 'OPENROUTER_API_KEY'].filter((k) => process.env[k]),
    },
    providers: {},
  };
  for (const provider of ['typesafe', 'openrouter']) {
    const chain = new ProviderChain(config, process.env as any);
    chain.order = [provider as 'typesafe' | 'openrouter'];
    const latencies: number[] = [];
    const scores: number[] = [];
    const errors: string[] = [];
    const calls = Number(process.env.LIVE_QUALIFICATION_CALLS ?? 12);
  for (let i = 0; i < calls; i += 1) {
      const started = performance.now();
      try {
        const answers = await chain.score(built.state, built.questions);
        latencies.push(performance.now() - started);
        scores.push(Number(answers[Object.keys(built.questions)[0]].toFixed(4)));
      } catch (error: any) {
        errors.push(`${error?.constructor?.name ?? 'Error'}: ${String(error?.message ?? error)}`.slice(0, 120));
      }
    }
    const sorted = [...latencies].sort((a, b) => a - b);
    report.providers[provider] = {
      calls,
      ok: latencies.length,
      errors: errors.slice(0, 3),
      p50_ms: latencies.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : null,
      p95_ms: latencies.length ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)]) : null,
      first_question: Object.keys(built.questions)[0],
      scores,
      distinct_scores: Array.from(new Set(scores)).sort((a, b) => a - b),
    };
  }
  console.log(JSON.stringify(report, null, 1));
}

main().catch((error) => { console.error(error); process.exit(1); });
