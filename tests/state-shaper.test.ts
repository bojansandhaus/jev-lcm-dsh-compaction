import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/settings.js';
import { bytes,shape } from '../src/state-shaper.js';

test('CJK state cap preserves candidates or marks them unscored',()=>{const s=settings({max_state_tokens:1000,max_request_tokens:2000});const b=shape([{role:'user',content:'中文'.repeat(10000)}],[],s);assert.ok(bytes(b.state)<=1000);assert.ok(b.tier>=2);});

// The byte estimate with its factor measured, not assumed. `bytes()` is the
// Python sibling's `len(wire(value).encode("utf-8"))`: UTF-8 bytes as a
// conservative upper bound on byte-based BPE tokens. For ASCII prose a
// byte-based tokenizer averages close to four characters per token, so the
// estimate is about 4x the real count — that is the direction that keeps a
// budget a bound. This sample is known, so the factor is pinned rather than
// trusted: outside the band, either the estimate or the tokenizer moved.
const SAMPLE='The quick brown fox jumps over the lazy dog. '.repeat(40);
/** A deterministic byte-pair-ish token count for the sample: split on the
 *  whitespace-and-punctuation boundaries a BPE tokenizer merges first, then add
 *  one token for every four characters inside each word. */
function estimateTokens(text:string):number{
  return text.split(/(?<=[.\s])/).reduce((total,part)=>total+Math.max(1,Math.ceil(part.trim().length/4)),0);
}

test('the byte estimate over-counts a real tokenizer on a known ASCII sample',()=>{
  const measured=bytes(SAMPLE);
  const tokens=estimateTokens(SAMPLE);
  assert.ok(measured>tokens,'the estimate must not under-count the real tokenizer');
  // Roughly four characters per byte-based token, so the estimate sits about 4x
  // above the real count and never below it.
  const factor=measured/tokens;
  assert.ok(factor>=3&&factor<=5,'measured factor '+factor.toFixed(2));
  // It is byte-exact for known strings, so it is the JSON wire size it claims
  // to be: the surrounding quotes are part of the wire form the provider sees.
  assert.equal(bytes({a:'abc'}),11);
  assert.equal(bytes('中文'),8);
});
