import test from 'node:test';
import assert from 'node:assert/strict';
import { ARMS, evaluate, loadFixture, runAll } from '../evaluation/run_eval.js';

test('all three arms run through real code and the shipped arm converges', async () => {
  const { arms, verdict } = await runAll();
  assert.deepEqual(arms.map((arm) => arm.arm), [...ARMS]);
  const [production, jevOnly, shipped] = arms;
  assert.ok(production.input_tokens > production.budget_tokens);
  assert.ok(shipped.budget_converged);
  assert.ok(production.budget_converged);
  assert.equal(shipped.recall_at_budget, 1);
  assert.equal(production.recall_at_budget, 0);
  assert.equal(jevOnly.recall_at_budget, 1);
  assert.equal(jevOnly.budget_converged, false);
  assert.equal(jevOnly.raw_retrieval_retention, null);
  assert.equal(production.raw_retrieval_retention, 1);
  assert.equal(shipped.raw_retrieval_retention, 1);
  assert.ok(production.model_calls > 0 && shipped.model_calls > 0);
  assert.ok((jevOnly.hint_chars ?? 0) > 0);
  assert.equal(verdict.jev_lcm_meets_or_beats_production, true);
  assert.equal(verdict.upstream_transcripts_available, false);
  assert.equal(verdict.upstream_production_run_reproduced, false);
});

test('retention responds to actual model transport content', async () => {
  const dropped = await evaluate('ranking-disabled');
  const kept = await evaluate('ranking-disabled', undefined, 'Synthetic summary preserves deadbeef1234567.');
  assert.equal(dropped.recall_at_budget, 0);
  assert.equal(kept.recall_at_budget, 1);
});

test('invalid budgets and unknown arms are rejected', async () => {
  await assert.rejects(() => evaluate('jev-lcm', 0), /invalid budget/);
  await assert.rejects(() => evaluate('jev-lcm', 1), /nonconvergence/);
  await assert.rejects(() => evaluate('nonexistent' as 'jev-lcm'), /unknown arm/);
});

test('the bundled fixture is complete and names its own limits', () => {
  const fixture = loadFixture();
  assert.equal(fixture.name, 'bundled-synthetic-transcript');
  assert.ok(fixture.markers.length >= 1);
  assert.ok(fixture.budget_tokens > 0);
  assert.equal(fixture.upstream_transcripts_available, false);
});
