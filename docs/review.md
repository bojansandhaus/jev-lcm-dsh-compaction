# Correctness review disposition

[Hermes PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246) motivates this project: ranking alone cannot replace text condensation. This page records limits or review evidence for the scoring, retention, storage, and compaction fixes.

The independent review identified overlapping DSH flush calls and a potential concurrent Hermes ingestion race. DSH scoring is now serialized per Prepass. The Hermes adapter uses a reentrant per-engine lock around ingestion, compaction, tool handling, and turn/end/reset callbacks. Clones receive independent locks. The subsequent Hermes rework extends the vendored LCM store with protected-evidence metadata; that extension requires separate review.

Regression tests exercise eight overlapping scoring calls and eight concurrent ingestion calls. Each candidate is scored once and each raw message is stored once in the tested cases.

In the initial concurrency review, the reported DSH summary publication ordering defect was not reproduced: SQLite node and hint writes already occur before the summarizer returns its result to the host. A new test injects a disk failure and verifies that the summary call rejects instead of returning a replacement. Generated-but-rejected summary attempts remain a separately documented limitation.

These regressions do not establish complete crash recovery, multi-process idempotency, or production concurrency qualification.
