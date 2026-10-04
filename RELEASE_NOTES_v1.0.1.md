# jev-lcm-dsh-compaction v1.0.1

## The anchor scan could take 4.6 seconds on a single message

`extract()` runs every configured pattern over every assistant message on every
turn, so a pattern's cost is multiplied by the whole backlog. The
reason-sentence pattern's leading `[^.!?\n]*` was unbounded, which reads like a
linear scan and is not one: on text with no sentence terminator, V8 retried the
greedy prefix from every offset.

Measured on Node 22 / V8, a single 64 KB input:

| input | before | after |
| --- | --- | --- |
| 64 KB, no terminator, no trigger word | 4,608 ms | 1 ms |
| 64 KB of ordinary prose | 1 ms | 1 ms |

Minified JSON, base64 blobs and long paths all have the terminator-free shape
that triggers it, so this was reachable from ordinary transcripts rather than a
contrived input. The same defect and the same fix landed in the Python sibling
`jev-lcm-hermes-compaction` v1.0.1, where the same input measured 49 seconds
because CPython's engine backtracks further.

## What changed

- The reason-sentence pattern is bounded to a 400-character window either side of
  its trigger word, so a minified blob cannot become one enormous protected span.
- A cheap literal pre-test rejects the pattern outright when none of its trigger
  words is present. That is the case that was pathological, and it is the common
  one.
- Compiled regexes are cached per pattern. `extract()` previously built a fresh
  `RegExp` inside the loop, once per pattern per message per turn.

## A correction

The first draft of this change also deleted the `jev_anchor_patterns.forEach(p =>
new RegExp(p,'g'))` line in `settings.ts` on the grounds that it built regexes
and threw the result away. That was wrong: it is deliberate fail-fast validation
at config time, so an unparseable pattern raises where the user set it rather
than from inside the per-message scan several turns later. The line is retained,
with a comment recording why.

## What deliberately did not change

The bound is a real behaviour change, so it is pinned on both sides.
`tests/anchors-perf.test.ts` (8 tests) asserts that ordinary sentences extract
**identical spans** to the old unbounded pattern, that only a terminator-free run
is truncated, and that repeated scans are idempotent.

## Verification

```
85 passed, 0 failed          (77 before, 8 new)
tsc --noEmit && tsc -p tsconfig.test.json    clean
```
