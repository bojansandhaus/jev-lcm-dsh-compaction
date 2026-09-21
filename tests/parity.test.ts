import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { JevThresholdCalibrator } from '../src/calibration.js';
import { ProviderChain } from '../src/providers.js';
import { ProviderError } from '../src/jev-client.js';
import { settings } from '../src/settings.js';

type Case = Record<string, any>;
const root = new URL('.', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('parity_scenarios.json', root), 'utf8')) as { calibration: Case[]; providers: Case[] };
const golden = JSON.parse(readFileSync(new URL('parity_goldens.json', root), 'utf8'));

function calibration(case_: Case) {
  const cfg = case_.config ?? {};
  const c = new JevThresholdCalibrator(settings({
    jev_calibration_min_samples: cfg.jev_calibration_min_samples ?? 50,
    jev_calibration_window: cfg.jev_calibration_window ?? 500,
    keep_threshold: cfg.fallback ?? .15,
    keep_threshold_max: cfg.cap ?? .40,
    min_keep_rate: cfg.keep_rate ?? .10,
    conservative: cfg.conservative ?? false,
  }));
  return { name: case_.name, threshold: c.observe(case_.values), calibrated: c.calibrated };
}

async function provider(case_: Case) {
  let now = 0;
  const responses: Record<string, Case[]> = Object.fromEntries(Object.entries(case_.responses ?? {}).map(([k, v]) => [k, [...v as Case[]]]));
  const seen: string[] = [];
  const transport = async (url: string, _key: string, _payload: unknown, _timeout: number) => {
    const provider = url.includes('typesafe') ? 'typesafe' : 'openrouter';
    seen.push(provider);
    const item = responses[provider].shift()!;
    if (item.error) throw new ProviderError(item.error);
    return item;
  };
  const result: Case = { name: case_.name };
  let chain: ProviderChain;
  try {
    chain = new ProviderChain(settings({ jev_provider: case_.provider ?? 'auto' }), case_.env ?? {}, transport, () => now);
  } catch (error) {
    result.constructor_error = error instanceof Error ? error.message : String(error);
    return { ...result, calls: [], seen: [], fallback_count: 0, total_calls: 0, last_provider: '' };
  }
  const calls: Case[] = [];
  for (const advance of [0, Number(case_.second_call_after ?? 0)]) {
    if (advance) now = advance;
    try {
      calls.push({ scores: await chain.score({}, { x: { type: 'noul', instructions: 'fixture' } }) });
    } catch (error) {
      calls.push({ error: error instanceof ProviderError ? error.reason : String(error) });
    }
    if (!case_.second_call_after) break;
  }
  return { ...result, calls, seen, fallback_count: chain.fallback_count, total_calls: chain.calls, last_provider: chain.last_provider };
}

test('cross-language calibration outcomes match the Python golden', () => {
  deepStrictEqual(fixture.calibration.map(calibration), golden.calibration);
});

test('cross-language provider selection and fallback outcomes match the Python golden', async () => {
  const actual = [];
  for (const case_ of fixture.providers) actual.push(await provider(case_));
  deepStrictEqual(actual, golden.providers);
});
