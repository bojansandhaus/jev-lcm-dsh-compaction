# Technical reference

[NousResearch/hermes-agent PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246) reported that Jev-only compaction can saturate a 25K state ceiling, miss assistant-text identifiers, and leave a growing text floor. This DSH package carries the Jev scoring, anchors, calibration, batching, provider chain, and an LCM-owned SQLite evidence surface, but the complete parity and fresh-host acceptance required by the corrected specification remain pending.

## Package and lifecycle

`package.json` declares an npm package with a `dsh.bundle.patch` manifest pointing to `cordis.patch.yml`. `src/index.ts` exports `apply(ctx, config)`, declares `llm`, `tokenMeter`, `sessions`, and `tools` injection, registers the LCM and Jev tools, and constructs `JevLCMCompactionEngine`. The current package targets Node >=22.19 and the pinned DSH 0.1.6-alpha.2 peer packages. DeepSeek Harness is developer preview software; pin a tested DSH range.

The current patch disables `compaction-basic` and inserts `jev-lcm-compaction` and supplies `thresholdRatio`, `retainRatio`, and `databasePath`. DSH loader composition is a host concern. A config dump is not proof that a real loader mount or agent session committed a compaction.

## Configuration

The TypeScript defaults in `src/settings.ts` and the bundle defaults in `src/index.ts` are distinct layers.

| Setting | Default | Meaning |
|---|---:|---|
| `databasePath` | `jev-lcm.sqlite` | DSH bundle SQLite path. |
| `thresholdRatio` | `0.8` | Bundle compaction trigger ratio. |
| `retainRatio` | `0.16` | Bundle retention ratio. |
| `maxTokens` | `8192` | Engine context budget. |
| `auto` | `true` | Enable automatic compaction behavior. |
| `jev_provider` | `auto` | `auto`, `typesafe`, `openrouter`, or `laya` for a local server. |
| `TYPESAFE_API_KEY` | unset | TypeSafe credential. |
| `OPENROUTER_API_KEY` | unset | OpenRouter credential. |
| `LAYA_API_KEY` | unset | Optional bearer for a local `laya-serve` started with `LAYA_API_KEY`. The local route needs no credential. |
| `typesafe_base_url` | `https://api.typesafe.ai/v1` | TypeSafe base. |
| `openrouter_base_url` | `https://openrouter.ai/api` | OpenRouter base. |
| `openrouter_endpoint_path` | `/alpha/decisions` | OpenRouter surface. The native Decisions path, or any other path to select the chat completions adapter. |
| `jev_endpoint_path` | `/systemone` | TypeSafe path. |
| `jev_model` | `jev-latest` | TypeSafe model. |
| `openrouter_model` | `~typesafe/jev-latest` | Current OpenRouter adapter model. |
| `laya_base_url` | `http://127.0.0.1:8000` | Local `laya-serve` base. Plain HTTP is accepted for loopback only. |
| `laya_endpoint_path` | `/v1/systemone` | Local path, the route the Decisions contract uses. |
| `laya_model` | `convaiinnovations/laya` | Laya checkpoint. `english`, `multilingual`, or `typed-decisions` name one directly; any other value routes by script and language. |
| `jev_fallback_enabled` | `true` | Allow fallback. |
| `jev_fallback_order` | `typesafe, openrouter` | Order inside the hosted pair. Only `typesafe` and `openrouter` are accepted, because the local route replaces the pair rather than joining it. |
| `jev_fallback_on` | transport, timeout, 401, 403, 429, 5xx | Fallback triggers. |
| `jev_fallback_cooldown_s` | `60` | Provider cooldown. |
| `jev_fallback_max_retries` | `1` | Retry count. |
| `keep_threshold` | `0.15` | Low-sample threshold. |
| `keep_threshold_max` | `0.40` | Calibration cap. |
| `min_keep_rate` | `0.10` | Quantile target. |
| `jev_calibration_enabled` | `true` | Enable rolling calibration. |
| `jev_calibration_window` | `500` | Rolling samples. |
| `jev_calibration_min_samples` | `50` | Calibration minimum. |
| `conservative` | `false` | Conservative mode flag. |
| `jev_anchor_protection_enabled` | `true` | Protect selected anchors. |
| `jev_batch_window_turns` | `3` | Batch window. |
| `jev_max_candidates_per_batch` | `300` | Batch cap. |
| `jev_urgent_context_ratio` | `0.90` | Urgent flush ratio. |
| `max_state_tokens` | `25000` | Jev state budget. |
| `max_request_tokens` | `30000` | Request budget. |
| `truncate_head_chars` | `300` | Truncate head. |
| `min_result_chars` | `8000` | Candidate minimum. |
| `hint_budget_tokens` | `4000` | Protected hint budget. |
| `lcm_rollup_fan_in` | `4` | Committed top-layer summaries condensed into one higher-depth rollup node. `0` disables rollups. |

With `auto`, absent keys are filtered. A pinned provider with a missing key fails fast. With both keys absent, scoring is disabled and the host path remains available. Key values must never appear in diagnostics.

## Storage and tools

`LcmStore` owns raw rows, FTS indexing, summary nodes, edges, source links, hints, and committed or aborted node status. Raw identities are unique per session and immutable. `lcm_grep`, `lcm_expand`, and `lcm_nodes` are session-scoped tools. The current grep surface uses exact quoted FTS matching and returns at most 100 rows.

The active assembler gives protected hints first, then summary nodes within a character budget. Nodes arrive highest depth first, and a node that condenses others suppresses its descendants inside the same assembly while those descendants stay recallable. `rollup(session, summary, childIds)` creates that higher layer at `1 + max(child depth)` over at least two sibling nodes, `topLayer` reports the committed nodes no other node summarises, and after each successful compaction the engine condenses `lcm_rollup_fan_in` of them through the host model. A rollup whose host call fails is skipped, never failed forward into the compaction. A keep action can inject the original candidate. A truncate action injects a bounded head and a pointer. An over-budget candidate receives a pointer where possible. This is an implementation boundary, not proof that every host prompt consumes the assembled result.

## Decisions and edge cases

Actions are keep, truncate, defer/drop, or unscored. Jev never mutates raw rows. Unpaired calls remain raw and are not paired by guesswork. Duplicate raw identities with different bodies raise an ownership error. Anchor spans must be deduplicated before scoring; overlapping regexes are expected.

The shrink ladder is T0 full, T1 shortened inputs and headed results, T2 shorter inputs and results, T3 note-only results, and T4 folded old messages. Candidates beyond the hard cap become `jev_unscored`; they must remain recoverable from the raw store. CJK token accounting, externalized payload pointers, and full host prompt assembly remain explicit acceptance checks, not implied by a unit test.

Endpoint validation decodes paths, rejects queries, fragments, credentials, unsafe traversal, controls, and non-local plain HTTP. OpenRouter maps through `/alpha/decisions` and TypeSafe through `/systemone`. Both paths returned parseable `noul` scores in a live qualification on 2026-09-21 with one request each and no fallback; re-verify against your own account and model versions before production use.

## Metrics

`jev_stats` includes candidate, keep, anchor, unscored, call, fallback, provider, threshold, LCM node, text-floor, freed-per-compaction, and unevaluated recall fields. `jev_calibrate` reports the live threshold, whether calibration is active, and how many samples the rolling window holds; with `dry_run` it sends one synthetic probe per configured provider and returns latency and status for each, including `error` with the missing environment-variable name when a provider has no key. `jev_providers` reports order, environment-variable names present, cooldowns, errors, and last provider. `jev_scores` and `jev_anchors` expose candidate diagnostics. Three consecutive cycles below 20% freed space emit a warning in the metrics implementation.

## Sources and lineage

- [PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246), attributed findings and corrected design brief.
- [DeepSeek Harness CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md), plugin/profile and `--dump-config` semantics.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), host project.
- [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction), Jev lineage.
- [hermes-jev-compact](https://github.com/TheEpTic/hermes-plugins/tree/main/hermes-jev-compact), integration lineage.
- [hermes-lcm](https://github.com/stephenschoettler/hermes-lcm), LCM lineage.

The PR headline numbers are attributed, not reproduced here.