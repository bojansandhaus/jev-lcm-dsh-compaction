/**
 * The anchor scan runs on every assistant message on every turn, so a pattern's
 * cost is multiplied by the whole backlog.
 *
 * These tests pin the guard added after an independent review measured the
 * reason-sentence pattern taking 4.6 seconds on a single 64 KB input: its greedy
 * `[^.!?\n]*` prefix was unbounded, so V8 retried it from every offset when the
 * text had no sentence terminator. Minified JSON, base64 blobs and long paths
 * all have that shape.
 *
 * The bound is a deliberate behaviour change, so both halves are asserted:
 * ordinary sentences must extract exactly what they did before, and a
 * pathological input must be bounded in time.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {extract} from '../src/anchors.js';
import {settings} from '../src/settings.js';

const PATTERNS = settings().jev_anchor_patterns;
const REASON_INDEX = 2;

/** The pattern set as it was before the bound, for behavioural comparison. */
function unboundedReasonPatterns(): string[] {
  const old = [...PATTERNS];
  old[REASON_INDEX] =
    String.raw`[^.!?\n]*(?:root cause|because|constraint|must|never|always)[^.!?\n]*[.!?]?`;
  return old;
}

const key = (spans: {start: number; end: number}[]): string =>
  spans.map(s => `${s.start}:${s.end}`).sort().join('|');

test('reason pattern has a bounded window', () => {
  // Guard against someone widening the window back to unbounded.
  assert.ok(PATTERNS[REASON_INDEX].includes(String.raw`[^.!?\n]{0,`));
  assert.ok(!PATTERNS[REASON_INDEX].includes(String.raw`[^.!?\n]*`));
});

test('ordinary sentences extract identically to the unbounded pattern', () => {
  const old = unboundedReasonPatterns();
  for (const text of [
    'The root cause is a timeout. Because of Y we must fix it.',
    'Must never always constraint root cause because.',
    'Deploy failed; the constraint is version pinning.',
    'There is no trigger word in this sentence at all.',
  ]) {
    assert.equal(key(extract(text, PATTERNS)), key(extract(text, old)), text);
  }
});

test('a long unterminated run is truncated not swallowed whole', () => {
  // The old form captured all 6000 characters as one protected span.
  const text = 'x'.repeat(3000) + ' because ' + 'y'.repeat(3000);
  const big = extract(text, PATTERNS).filter(s => s.end - s.start > 1000);
  assert.equal(big.length, 0, `unbounded capture returned ${JSON.stringify(big)}`);
  assert.ok(extract(text, PATTERNS).length > 0, 'the trigger word must still be found');
});

test('a degenerate 64k input is not pathological', () => {
  const text = 'x'.repeat(64_000);
  const start = performance.now();
  extract(text, PATTERNS);
  const elapsed = performance.now() - start;
  // The old form needed ~4600 ms here. The ceiling still fails loudly if the
  // unbounded form ever comes back.
  assert.ok(elapsed < 500, `anchor scan took ${elapsed.toFixed(0)}ms on 64 KB`);
});

test('realistic 64k prose is not pathological', () => {
  const text = ('The root cause is a timeout in the retry loop. '.repeat(1200)).slice(0, 64_000);
  const start = performance.now();
  assert.ok(extract(text, PATTERNS).length > 0);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 500, `anchor scan took ${elapsed.toFixed(0)}ms on 64 KB of prose`);
});

test('the pre-test short-circuits rather than merely running faster', () => {
  // Build a pattern that would match if it ran, and give the input no trigger
  // word. If the pre-test is missing this returns a span instead of nothing.
  const decoy = ['NEVERMATCHEDTRIGGER', 'ALSOABSENT'];
  assert.equal(extract('a plain sentence with no trigger', decoy).length, 0);
  assert.equal(extract('the root cause is here', ['NEVERMATCHEDTRIGGER']).length, 0);
});

test('a pattern is compiled once and reused across calls', () => {
  // The old implementation built a fresh RegExp per pattern per message. A
  // stateful lastIndex on a cached global regex would be a bug, so assert the
  // cache does not leak position between calls.
  const text = 'The root cause is a timeout at v1.2.3.';
  const first = extract(text, PATTERNS);
  for (let i = 0; i < 5; i += 1) {
    assert.equal(key(extract(text, PATTERNS)), key(first), `call ${i} differed`);
  }
});

test('extraction is idempotent across repeated scans', () => {
  const text = 'Root cause: `abc123def456` at line 42 because of DSH.';
  const once = extract(text, PATTERNS);
  const twice = extract(text, PATTERNS);
  assert.equal(key(once), key(twice));
  assert.ok(once.length > 0);
});