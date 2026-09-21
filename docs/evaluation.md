# Compaction evaluation

[Hermes PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246) motivates the evaluation: token reduction does not prove evidence retention. This harness checks text condensation, protected identifiers, budget enforcement, and durable retrieval through actual engine code.

## Run

From the repository root, with development dependencies and the supported host installed:

```sh
pnpm exec tsx evaluation/run_eval.ts
```

For Hermes, set HERMES_AGENT_PATH to the host source checkout. For DSH, the pinned host packages are development dependencies. There are no live-mode flags. Unknown arguments are rejected rather than silently producing fixture results.

## What executes

The harness creates an isolated synthetic conversation longer than the target budget. It calls the actual compactor and measures the actual assembled context. External summarization and Jev scoring use explicit synthetic transports. The summary intentionally omits a known evidence marker. The ranking-enabled arm can recover that marker through protected assembly.

Hermes compares vendored LCM with Jev-LCM. DSH compares its ranking-disabled plugin with its ranking-enabled plugin; this is not a comparison against a separate full Hermes-LCM port. The two host evaluators use different host token accounting and budgets. Do not compare their token totals as if they shared a tokenizer.

Raw retrieval uses the persisted store: Hermes invokes lcm_grep and lcm_expand; DSH calls its store grep and expand methods. The score requires recovery of the exact marker. It never scans only the original input to claim retrieval success.

## Metrics and checks

- input_tokens and active_tokens use each host's context accounting.
- exact_evidence_retention is literal marker presence in assembled context, not model answer accuracy.
- raw_retrieval_retention is marker recovery through persisted retrieval.
- freed_ratio is the measured fraction of input context removed.
- Nonconvergent budgets and invalid inputs fail explicitly.
- Tests change the synthetic summary content and check that retained evidence changes.

The latest local output is in evaluation/results.json. It records production_comparison=false and synthetic-transport-integration mode. An earlier manual-message-selection evaluator was rejected and replaced; none of its figures is accepted as plugin performance.

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
