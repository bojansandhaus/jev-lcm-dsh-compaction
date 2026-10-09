# jevs-lcm-dsh-compaction v1.1.0

## The reason-sentence guard silently discarded every `must` / `never` / `always` anchor

`anchors.extract()` runs over every assistant message on every turn, and the
reason-sentence pattern carries the constraints and decisions this plugin
exists to protect. A literal pre-test guards it, so a message with no trigger
word never runs the pattern. The guard's vocabulary was:

```ts
const _REASON_TRIGGER = /root cause|because|constraint/i;
```

Three words. The shipped pattern alternates over six:

```
[^.!?\n]{0,400}(?:root cause|because|constraint|must|never|always)[^.!?\n]{0,400}[.!?]?
```

`must`, `never` and `always` were absent from the guard, so on a message whose
only trigger was one of them the guard skipped the pattern outright and the
sentence never became a candidate. Measured directly, against the raw regex:

| Input | Raw regex | `extract()` |
| --- | --- | --- |
| `We must pin the dependency before the release.` | 1 span | **0 spans** |
| `You never bypass the approval gate.` | 1 span | **0 spans** |
| `The service always validates input.` | 1 span | **0 spans** |

Nothing logged it and nothing counted it. The evidence was dropped before
candidate generation, so it never reached the model's prompt and no metric
recorded a loss.

### Two compounding defects, fixed together

**Case.** The guard matched case-insensitively; the pattern was compiled with
`g` only. A trigger word at the start of a sentence is capitalised in ordinary
prose, so `Because the cache is cold, the call is slow.` passed the guard and
was then missed by the pattern — one scan spent, nothing extracted.

**Applicability.** `needsReasonTrigger()` decided a pattern was reason-shaped by
asking for two specific substrings:

```ts
return pattern.includes('root cause') && pattern.includes('because');
```

`jev_anchor_patterns` is a documented operator setting, so a hand-written
pattern sharing the shape without both those words lost the guard entirely and
paid the 49-second pathological cost that v1.0.1's fix was written to remove.
No test covered a custom pattern list.

### What changed

The guard's vocabulary is now read out of the pattern's own alternation, so the
guard, its applicability, and the pattern it guards are one thing rather than
three that must agree:

```ts
function reasonTriggers(pattern: string): string[] {
  const group = pattern.match(/\(\?:((?:[a-z][a-z ]*\|)+[a-z][a-z ]*)\)/);
  if (!group) return [];
  return group[1].split('|').map((t) => t.trim().toLowerCase()).filter(Boolean);
}
```

And the reason-sentence pattern is the one pattern compiled case-insensitively,
because reason text is prose and its trigger's case depends on where the word
falls in the sentence.

The detector is deliberately **case-sensitive**, and that is load-bearing. This
module also ships `\b[A-Z_]{2,}_(?:KEY|TOKEN|SECRET|URL|PATH|ID)\b`, whose
alternation is just as well formed. An `/i` detector classified that credential
pattern as reason-shaped too and recompiled it case-insensitively, which began
matching `superscret_key` — the exact silent widening this fix exists to avoid.
The Python sibling hit the same trap through the same detector, independently.
A pattern whose author writes its triggers in capitals now simply is not treated
as a reason pattern: it loses the guard, which costs performance, and never
changes what it matches.

That mistake was made and caught during this change, and it is the reason the
detector is case-sensitive rather than the more obvious ignorecase form. It was
caught by a test asserting the credential pattern's behaviour was unchanged, so
the regression is pinned rather than merely avoided.

### What is pinned

`tests/reason-trigger-guard.test.ts`, 5 tests:

- every trigger the pattern names reaches extraction, all six;
- the trigger is honoured wherever its capitalisation falls, five shapes;
- a homeomorphic custom pattern is guarded *and* still matches;
- the guard still short-circuits on 64 KB of trigger-free text;
- the non-reason patterns match exactly what they matched before, in both
  directions, so the case policy cannot leak again.

`tests/anchors-perf.test.ts` passes unchanged, including its comparison against
the old unbounded pattern and its wall-clock ceiling.

### Cross-language

The identical defect existed in `jevs-lcm-hermes-compaction`, the Python sibling
that shares the parity fixtures. It was diagnosed independently in both
repositories and is fixed in both with the same mechanism. Python and TypeScript
now agree on all six triggers and on all three capitalisation shapes, which is
the property the cross-language parity tests were written to hold and did not
hold here.

The parity fixtures (`tests/parity_scenarios.json`, `parity_goldens.json`) cover
calibration and provider selection only, so they neither detected this nor are
affected by it. Anchor extraction has no cross-language fixture; that gap is the
reason the same bug shipped twice.

### Verification

```
tsc --noEmit (src)                  0 errors
tsc --noEmit -p tsconfig.test.json  0 errors
tsx --test tests/*.test.ts         90 pass, 0 fail   (was 85; +5, all new)
```
