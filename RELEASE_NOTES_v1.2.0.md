# jevs-lcm-dsh-compaction v1.2.0

## A ranking layer that could stop ranking, quietly

v1.1.0 fixed the guard. This release is the eleven findings an adversarial
review of the whole surface produced after it, in review order. They share one
shape: a mechanism that was supposed to bound a decision — a budget, a cooldown,
a signal, a score — was either absent, unreachable, or measured in the wrong
unit, and the failure was silent in each case. Nothing here changes what the
plugin is for. All of it changes what it can quietly get wrong.

Three of these are the ones worth reading before the rest.

### 1. The ladder could shrink history past the evidence it was ranking

`state-shaper.ts` runs a T0–T4 ladder. At tier ≥ 2 every message is
whitespace-collapsed and cut to 200, then 60 characters; the fold that follows
keeps only the second half of what survives. A candidate's own `text` ships
verbatim, so a candidate could be scored against a span whose surrounding
context the model no longer received.

The Python sibling already carried the fix: a `folded` flag on the returned
state. The TypeScript port never read it, so the flag had nothing to read. It
does now:

```ts
export interface ShapedState { history: Message[]; candidates: unknown[]; folded: boolean }
```

`shape()` additionally returns the retained-history window, and the flush stops
selecting any candidate whose `message_index` falls below it. Such a candidate
stays `jev_unscored` — the state the design already had — and is counted in
`jev_folded_candidates` rather than dropped in silence. `jev_dropped_candidates`
counts the ones the budgets could not fit. Neither touches `jev_fallbacks`,
because neither is a provider failure.

### 2. One malformed answer discarded the whole batch

`parseAnswers` threw on the *first* id whose answer was out of range or missing.
With `jev_max_candidates_per_batch` at 300, one bad row out of up to 300
candidates threw away every score, `jev_fallbacks` incremented by 1 regardless
of how many had answered, and the reason recorded was "provider failed" when
the provider had answered fine.

It now returns per-id results:

```ts
export interface ParsedAnswers { scores: Scores; malformedIds: string[] }
```

The well-formed half is scored, calibrated and retained. The malformed ids are
recorded beside them in `jev_partial_fallback_count` and `jev_malformed_count`.
An answer set where *nothing* was readable still throws: a caller with no score
must fall back, and a silent empty score would be the same bug wearing a
different hat.

### 3. The last provider in the chain had no cooldown

`this.cooldowns[name] = this.clock() + ...` only ran after a successful handover.
When the last provider exhausted its attempts the loop fell through to
`throw last` without reaching that line, so the next turn re-attempted it at
full billed cost — up to a 60s blocking request per turn against an endpoint
that had just refused every attempt it was given.

The cooldown is now written for the final provider before the throw, and the
`1 + max_retries` attempts at one provider are spaced by exponential backoff
rather than hammered at once.

### The rest

4. **`hintBlock()` was dead code in the runtime path.** It is the only
   `hint_budget_tokens` enforcement and the only score-descending ordering in
   the codebase, and `summarize()` shipped `store.assemble()` at
   `hint_budget_tokens * 4` instead. `summarize()` now builds its summary from
   `hintBlock()`, and `assemble()` takes a `protectedEvidence` flag so the node
   layer receives what the ranked block leaves rather than emitting the same
   evidence twice in table order.

5. **Protected evidence was admitted in SHA-256 order.** `ORDER BY candidate`
   over candidates keyed by `sha256(...).slice(0,20)` is effectively random, so
   the budget was spent on whichever hashes sorted first. Ordering is now
   `json_extract(data,'$.score') DESC`.

6. **The `laya` breaker had no recovery path.** It cleared only on a successful
   *local* answer, so a Laya that never came back re-raised every later turn and
   never reached the hosted API that could still serve. It now half-opens after
   its cooldown: one hosted attempt per window, without incrementing the
   counter, and only a local success clears it.

7. **`score()` dropped the caller's `AbortSignal`.** `Transport` had no signal
   parameter and `post` built its own timeout, so the signal
   `compactIfNeeded` / `compactNow` / `summarize` receive never reached the
   network. It is now threaded through `AbortSignal.any([userSignal,
   AbortSignal.timeout(...)])`, and each session holds an in-flight controller
   so dispose can abort it.

8. **`pendingNodes` was a single slot per session.** Only `summarize()` wrote
   it, but `compactRegion` read it unconditionally, so a host-driven flow
   reaching `compactRegion` without a preceding `summarize()` consumed a stale
   node id and stamped it with the current region's seqs. Two overlapping calls
   overwrote each other. The node id is now passed to each override explicitly
   through a reservation stack rather than through a session-keyed map.

9. **Token accounting measured JSON bytes.** `tokens()` is
   `Buffer.byteLength`, roughly 4× off for ASCII, and the one test that
   asserted it was tautological against the same function. It is renamed
   `bytes()` with the Python sibling's UTF-8 upper-bound argument written down,
   and a new test pins the factor against a tokenizer on a known sample so the
   ratio is measured rather than assumed.

10. **Clef chunking dropped the batch-size safeguard.** The Python sibling
    raises `ClefError(...lower jev_max_candidates_per_batch)` past
    `CLEF_MAX_QUESTIONS`; the TypeScript port chunked quietly, discarding the
    diagnostic. `clef_chunk` now takes a callback, and the chain logs the
    question and request counts once per session.

11. **`jev: z.any()` accepted the whole settings blob.** A typo'd key failed
    later in `settings()` rather than at config load. Replaced with an inline
    object schema covering every scalar key, with a comment naming why the two
    array-valued keys are still deferred: this schema library fills an unset
    `z.array(...)` key with `[]`, which would wipe the shipped non-empty
    defaults.

### What is pinned

`tests/findings-v120.test.ts`, 12 tests, one per finding:

- the shaped state carries `folded` and a retained window, and a candidate
  below the window is never ranked;
- a partial answer scores its readable half and records the malformed count;
- the last provider's cooldown is written after a total failure, and its
  retries are spaced;
- the laya breaker half-opens past its cooldown and still needs a local
  success to clear;
- `assemble()` admits surviving evidence by score, and `summarize()` spends
  `hint_budget_tokens` on the ranked block;
- dispose aborts the in-flight scoring request;
- an over-limit Clef batch logs its request count once;
- the config surface types `jev`.

`tests/reason-trigger-guard.test.ts` passes unchanged. No existing test was
weakened; the three that asserted `parseAnswers` throwing were rewired to
assert the new per-id result and its unreadable-set behaviour, which is the
property those tests were actually protecting.

### Cross-language parity

The parity fixtures cover calibration and provider selection only, so nine of
these eleven findings were invisible to them, and the two the fixtures do cover
(both in the provider chain) are behaviour-preserving on the fixture
scenarios: `cooldown_expiration` and `both_failing` produce the same calls,
fallback counts and providers as before. The goldens are unchanged and still
pass. `tokens()` → `bytes()` is a rename with no numeric change, so the CJK
state-cap fixture's bound is bit-identical.

The Python sibling has the same three gaps — the missing last-provider
cooldown, the un-partial `parse_answers`, and a `hint_block` the compressor
does reach but which the TypeScript port did not — and the same `folded` flag
the TypeScript port did not read. Fixing them here without the sibling is a
known asymmetry, recorded rather than shipped silently.

### Verification

```
tsc --noEmit (src)                  0 errors
tsc --noEmit -p tsconfig.test.json  0 errors
tsx --test tests/*.test.ts        103 pass, 0 fail   (was 90; +13, all new)
```
