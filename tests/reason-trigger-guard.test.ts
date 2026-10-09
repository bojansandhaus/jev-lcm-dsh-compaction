// The reason-sentence pre-test guard dropped the constraint and decision
// sentences the anchor extractor exists to protect. `_REASON_TRIGGER` held three
// of the shipped pattern's six trigger words, so `must`, `never` and `always`
// were absent from the guard; the guard was case-insensitive while the pattern
// was not, so a sentence-initial `Because` / `Must` passed the guard and was then
// missed by the pattern; and `needsReasonTrigger` decided a pattern was
// reason-shaped by asking for two specific substrings, so an operator-supplied
// pattern that shared the shape without them lost the guard entirely.
//
// All three are fixed by deriving the guard's vocabulary out of the pattern's own
// alternation. These tests pin each half of that: that every trigger the pattern
// names reaches extraction, and that the guard still short-circuits on text with
// no trigger at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { extract } from '../src/anchors.js';
import { settings } from '../src/settings.js';

const patterns = (settings({} as never) as { jev_anchor_patterns: string[] }).jev_anchor_patterns;
const reason = patterns.find((p) => p.includes('root cause') && p.includes('because'))!;

// Every trigger word the shipped pattern actually alternates over.
const TRIGGERS = ['root cause', 'because', 'constraint', 'must', 'never', 'always'];

// A sentence using one trigger word and nothing else, so a failing guard is
// unambiguous: the pattern can only match through that word.
function sentence(trigger: string): string {
  return trigger === 'root cause'
    ? `The root cause of the failure is the misconfigured route.`
    : `We ${trigger} pin the dependency before the release.`;
}

test('every trigger the pattern names reaches extraction', () => {
  const missing = TRIGGERS.filter((t) => extract(sentence(t), patterns).length === 0);
  assert.deepEqual(missing, [], `these triggers produced no spans: ${missing.join(', ')}`);
});

test('the trigger is honoured wherever its capitalisation falls', () => {
  // The guard matched case-insensitively; the pattern did not. A trigger word at
  // the start of a sentence is capitalised in ordinary prose, and it used to be
  // the exact shape that got through the guard and then matched nothing.
  for (const text of [
    'Because the cache is cold, the call is slow.',
    'Must pin the dependency before the release.',
    'Never bypass the approval gate.',
    'Always validate input at the boundary.',
    'The build failed. Must pin the dependency.',
  ]) {
    assert.ok(
      extract(text, patterns).length > 0,
      `no span extracted from: ${text}`,
    );
  }
});

test('an operator-supplied reason pattern is guarded, not skipped', () => {
  // `needsReasonTrigger` asked for `root cause` AND `because` before it would
  // apply the guard at all. A hand-written pattern without both lost the guard
  // entirely and paid the unbounded cost. The guard is now read out of the
  // pattern's own alternation, so any reason-shaped pattern gets one.
  const custom = [
    ...patterns.filter((p) => p !== reason),
    String.raw`[^.!?\n]{0,400}(?:must|should|shall)[^.!?\n]{0,400}[.!?]?`,
  ];
  assert.ok(extract('You should pin the dependency before the release.', custom).length > 0);
  // And it is still guarded: no trigger word in the text means no scan.
  assert.equal(extract('Nothing of interest happens here.', custom).length, 0);
});

test('the guard still short-circuits on trigger-free text', () => {
  // The guard exists for performance. It was correct about that and must stay
  // correct: text with none of the trigger words must not run the pattern.
  const hostile = 'x'.repeat(64 * 1024);
  const started = process.hrtime.bigint();
  const spans = extract(hostile, patterns);
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  assert.equal(spans.length, 0);
  assert.ok(elapsed < 50, `trigger-free 64 KB took ${elapsed.toFixed(1)} ms`);
});

test('the non-reason patterns are unchanged by the case policy', () => {
  // Only the reason-sentence pattern is compiled case-insensitively. Widening
  // every pattern's flags would have changed what the identifier and credential
  // patterns match, which this fix has no business doing. `[a-f0-9]` is a
  // character class rather than a flag, so uppercase hex has never matched and
  // still must not — that invariance is the proof the flag change did not leak.
  const idPattern = patterns.find((p) => p.includes('[a-f0-9]'))!;
  assert.ok(extract('commit deadbeefcafe0123', [idPattern]).length > 0);
  assert.equal(extract('commit DEADBEEFCAFE0123', [idPattern]).length, 0);

  // The credential pattern is uppercase-only by construction, so it still
  // matches exactly what it matched before and nothing more.
  const credPattern = patterns.find((p) => p.includes('KEY'))!;
  assert.ok(extract('THE SUPERSECRET_KEY is in the env', [credPattern]).length > 0);
  assert.equal(extract('the superscret_key is in the env', [credPattern]).length, 0);
});
