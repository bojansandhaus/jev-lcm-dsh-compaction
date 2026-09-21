# Compaction evaluation

[Hermes PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246) rejected Jev-only compaction because token reduction did not prove evidence retention, and its recall losses lived in assistant text. This harness measures recall at budget for three arms through executed plugin and host code, covering FIX-1 through FIX-6 together.

## Run

From the repository root, with development dependencies and the supported host installed:

```sh
pnpm exec tsx evaluation/run_eval.ts
```

The pinned host packages are development dependencies. There are no live-mode flags. Unknown arguments are rejected rather than silently producing fixture results.

## What executes

The harness creates an isolated synthetic conversation longer than the target budget and runs three arms through real code:

| Arm | What runs | Why it is here |
|---|---|---|
| `ranking-disabled` | the plugin with Jev ranking off, so the host condensation path runs unranked | stand-in for the production arm, because the PR's own transcripts are not published |
| `jev-only` | Jev ranking with every user and assistant turn left verbatim and no condensation path | the arm PR #116246 rejected, reproduced so its text floor is measurable |
| `jev-lcm` | Jev ranking before host condensation, the shipped design | the design under test |

Jev scoring runs through an explicit synthetic transport that returns the anchor band high and the tool band low, mirroring the distribution the upstream scorecard measured. Summarization runs through an explicit synthetic transport whose text omits the known marker, so retention is decided by assembly, not by the summary. Nothing leaves the machine.

This is not a comparison against a separate full Hermes-LCM port. The DSH plugin subclasses native host compaction, so the production-equivalent arm is that same path with ranking switched off. The two host evaluators use different token accounting and budgets; do not compare their token totals as if they shared a tokenizer.

Raw retrieval uses the persisted store: DSH calls its store grep and expand methods, and the score requires recovery of the exact marker. It never scans only the original input to claim retrieval success. The `jev-only` arm owns no store, so its raw retrieval value is null rather than zero.

## Metrics and checks

- `input_tokens` and `active_tokens` use the host tokenMeter, the same accounting for every arm.
- `markers_retained` counts fixture markers present verbatim in the assembled context, and `recall_at_budget` is that count over the marker total.
- `budget_converged` reports whether the assembled context fits the target budget. For the `jev-only` arm an overrun is a result, not an error; for the two host arms a nonconvergent budget raises.
- `raw_retrieval_retention` is marker recovery through persisted retrieval, and it is null for the arm that owns no store.
- `freed_ratio` is the measured fraction of input context removed. A negative value means the arm grew the prompt.
- `hint_chars` is the size of the Jev hint block the `jev-only` arm actually built, so its Jev work is visible even though it keeps everything verbatim.
- Invalid budgets, unknown arms, and incomplete fixtures raise rather than producing numbers.
- Tests change the synthetic summary content and check that retained evidence changes with it.

## Latest measured output

From the bundled fixture `bundled-synthetic-transcript`, measured 2026-09-21:

| Arm | Input tokens | Active tokens | Budget met | Markers kept | Recall at budget | Raw retrieval |
|---|---:|---:|---|---:|---:|---:|
| `ranking-disabled` | 52745 | 138 | yes | 0 of 1 | 0.00 | 1 |
| `jev-only` | 52745 | 52821 | no | 1 of 1 | 1.00 | not applicable |
| `jev-lcm` | 52745 | 200 | yes | 1 of 1 | 1.00 | 1 |

The `verdict` block in `evaluation/results.json` carries the comparison this harness is able to make: `production_recall_at_budget` 0 against `jev_lcm_recall_at_budget` 1, `jev_lcm_meets_or_beats_production` true, `jev_only_budget_converged` false. It also carries `upstream_transcripts_available: false` and `upstream_production_run_reproduced: false`, because the production arm here is a local stand-in rather than the published run. An earlier manual-message-selection evaluator was rejected and replaced; none of its figures is accepted as plugin performance.

## Upstream production baseline

The comparison this project responds to is published upstream. The figures below are quoted from the upstream scorecard, [SCORECARD-2026-09-19-jev.md](https://github.com/NousResearch/hermes-agent/blob/main/evals/compaction/results/SCORECARD-2026-09-19-jev.md), produced by `evals/compaction/runner.py` in that repository. They are not measurements of this plugin.

| Upstream arm | Recall at retained tokens | Compaction cost | Wall time |
|---|---|---|---|
| `current` plus `session_search` recovery, the shipping path | 78.9% at 55K | $0.061 | 36.9 s |
| Jev plugin defaults | 75.5% at 115K | $0.007 | 1.4 s |
| Jev at threshold 0.15 | 90.0% at 396K | $0.007 | 1.4 s |
| Jev-ranked with a 60K tool budget | 77.8% at 176K | $0.007 | 1.5 s |
| Recency-ranked with the same budget | 77.8% at 177K | $0 | 0.0 s |

The same scorecard records the default threshold dropping 100% of 851 scored candidates, freed space decaying from 89% to 8% across 32 to 40 cycles on the Jev-only path, the 25K state ceiling binding in every measured cycle, and a fourth transcript of 541 tool calls that never fitted the ceiling and was recorded as a fallback rather than scored. The scorecard's own conclusion is that the facts the summariser loses (delegation ids, root causes, config keys, exact error strings) sit in assistant text, which is a retention target rather than a reason to change compaction cadence.

Reproduction is not possible from here. The upstream harness runs three real 500K-token session transcripts that its policy keeps out of the repository, and it judges answers through a configured model route. Neither the transcripts nor that judging route exist on this machine, and the upstream CI artifacts for the run are timing reports, not evaluation data. What this repository can do is measure the same quantities, recall at budget and freed ratio, on a generated transcript, which is what the harness executes.

## Limits

These tests establish integration behavior under synthetic transport outputs. They establish neither live Jev accuracy nor superiority over the upstream production compactor. A production comparison requires attributable transcripts, the upstream evaluation policy and budget, exact provider/model identities, and real model outputs. The original production transcript was not supplied with this task. No stable release should cite these synthetic results as production evidence.
