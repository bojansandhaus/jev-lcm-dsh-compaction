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

## Limits

These tests establish integration behavior under synthetic transport outputs. They establish neither live Jev accuracy nor superiority over the upstream production compactor. A production comparison requires attributable transcripts, the upstream evaluation policy and budget, exact provider/model identities, and real model outputs. The original production transcript was not supplied with this task. No stable release should cite these synthetic results as production evidence.
