# Compaction evaluation

[Hermes PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246) rejected Jev-only compaction because token reduction did not prove evidence retention, and its recall losses lived in assistant text. This directory holds the three arm recall-at-budget harness that measures that gap through executed plugin and host code, covering FIX-1 through FIX-6 together.

## Run

From the repository root, with development dependencies installed:

```sh
pnpm exec tsx evaluation/run_eval.ts
```

There are no live-mode flags. Unknown arguments are rejected rather than silently producing fixture results. The harness writes its JSON to stdout, and `evaluation/results.json` is the last recorded run. `evaluation/live-qualification.ts` is separate: it spends real provider calls and is run by hand, never by the test suite.

## The fixture

`evaluation/fixture.json` is the bundled synthetic transcript definition: the marker list, filler turns and repeat count, token budget, the summary text the synthetic summarization transport returns, and the two score bands the synthetic Jev transport returns. `tests/evaluation.test.ts` exercises it, including the fixture's own completeness fields.

The fixture carries `upstream_transcripts_available: false` because the PR's transcripts are real session data that its authors keep out of the repository. The harness therefore measures a local production-equivalent arm rather than re-running the published comparison, and `results.json` records `upstream_production_run_reproduced: false` so no reader mistakes the one for the other.

## Where the detail lives

`docs/evaluation.md` is the authoritative description: the three arms, every metric, the latest measured table, the upstream scorecard figures this project responds to, and the limits of synthetic transport results. This file exists to keep the evaluation directory self-describing without duplicating that page, so the numbers are stated once.
