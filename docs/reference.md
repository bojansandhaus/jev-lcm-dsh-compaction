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
| `jev_provider` | `api_only` | One of the four modes: `api_with_local_fallback`, `api_only`, `local_only`, `local_with_api_fallback`. Earlier names stay valid as aliases; see the mode table below. |
| `api_provider` | `auto` | Which hosted provider the `api_*` modes lead with: `typesafe`, `openrouter`, `clef`, or `auto` for the usable members of `jev_fallback_order` in order. A pinned provider that cannot authenticate fails at load naming its variable. |
| `local_model` | `convaiinnovations/laya` | Which local decision model answers, sent as the checkpoint or engine name. Deliberately not an allowlist, so a newly released local model works without a code change. Rejects only an empty value or one unsafe in a URL path segment or JSON string. See the local model section. |
| `TYPESAFE_API_KEY` | unset | TypeSafe credential. |
| `OPENROUTER_API_KEY` | unset | OpenRouter credential. |
| `CLOUDFLARE_API_TOKEN` | unset | Cloudflare credential for Clef. Needs **Account > Workers AI > Read** and is sent as a bearer token in the `Authorization` header. |
| `CLOUDFLARE_ACCOUNT_ID` | unset | Cloudflare account that scopes the Workers AI endpoint. Configuration rather than a secret, but it appears in the request URL. Required for Clef alongside the token, because the endpoint is per account and the account cannot be inferred from the token. |
| `clef_model` | `clef` | Clef checkpoint. `clef-flash` is the smaller variant. This is a setting on the one Clef provider, not a second provider name, alias, or chain member. |
| `LAYA_API_KEY` | unset | Optional bearer for a local `laya-serve` started with `LAYA_API_KEY`. The local route needs no credential. |
| `typesafe_base_url` | `https://api.typesafe.ai/v1` | TypeSafe base. |
| `openrouter_base_url` | `https://openrouter.ai/api` | OpenRouter base. |
| `openrouter_endpoint_path` | `/alpha/decisions` | OpenRouter surface. The native Decisions path, or any other path to select the chat completions adapter. |
| `jev_endpoint_path` | `/systemone` | TypeSafe path. |
| `jev_model` | `jev-latest` | TypeSafe model. |
| `openrouter_model` | `~typesafe/jev-latest` | Current OpenRouter adapter model. |
| `laya_base_url` | `http://127.0.0.1:8000` | Local `laya-serve` base. Plain HTTP is accepted for loopback only. |
| `laya_endpoint_path` | `/v1/systemone` | Local path, the route the Decisions contract uses. |
| `laya_model` | `convaiinnovations/laya` | Superseded by `local_model` and still read when `local_model` is left at its default, so an existing profile keeps working. `local_model` wins whenever it is set explicitly. |
| `jev_fallback_enabled` | `true` | Allow fallback. |
| `jev_fallback_order` | `typesafe, openrouter` | Order inside the hosted set. `typesafe`, `openrouter`, and `clef` are accepted, because the local route replaces the hosted set rather than joining it. Under `laya_then_hosted` this order supplies the hosted hops that follow the local one. Clef is never selected implicitly: it appears only when named here or as `jev_provider`. |
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

## The System One decision model category

The providers here are **System One decision models**, also written "typed decision models". The term is TypeSafe's own, and the reference is https://systemonemodels.org/guides/what-is-a-system-one-model/ . A System One model returns typed values with a probability for each rather than prose: `Choice` picks one option from a list, `Score` places content on an ordered scale, `Noul` answers yes or no with a number from 0 to 1.

Members in this family: **Jev** (hosted by TypeSafe or OpenRouter, closed weights), **Clef** and **Clef Flash** (hosted on Cloudflare Workers AI), **Laya** (local, open weights, the default here), **Kev** (open weights, 0.8B to 27B on Qwen3.5 and Qwen3.8 bases, serving the same `/v1/systemone` shape as TypeSafe's API), and **Tev1** (Together AI, Qwen3.5-based, open weights).

Jev is one vendor's member of the category rather than the category's name, so this documentation does not use "Jev-like model" as a category term.

## Provider modes

Four canonical modes exist. Each names which side leads and whether the other is a fallback; the hosted provider itself is chosen by `api_provider`, not by the mode.

| Mode | Provider order | Notes |
|---|---|---|
| `api_with_local_fallback` | usable hosted providers, then `laya` | The local hop needs no credential, so it is always available as the successor. With no usable hosted provider the order collapses to `laya` alone rather than failing to construct, because a route that can still answer is better than no route. |
| `api_only` | the usable hosted providers | A pinned `api_provider` that cannot authenticate fails at load naming its variable. `auto` with nothing usable yields an empty order, which reports `disabled` on the scoring path and leaves host compaction available. |
| `local_only` | `laya` | No credential, no chain. |
| `local_with_api_fallback` | `laya`, then the usable hosted providers | The mode promises a fallback, so an order with no hosted member fails at load naming the missing variables. The check is unconditional, even when `jev_fallback_enabled` is false. |

A pinned provider leads but does not exclude the rest of the configured order: `api_provider: clef` with `jev_fallback_order: [clef, typesafe]` produces `clef, typesafe`, so a handover still exists once Clef cools down. Pinning says which provider is preferred, not that the route has exactly one hop.

`auto` keeps its historical meaning rather than becoming a fifth mode. It selected among the keyed hosted providers and never picked the keyless local route on its own initiative, so it resolves to `api_only` and only becomes `api_with_local_fallback` when the profile has pointed the local slot at a real engine. The default `laya_base_url` is loopback, which is a placeholder rather than a deployment decision, so its presence alone does not add a local hop to a hosted-only profile.

## Aliases

Every earlier mode name still resolves, so no deployed configuration breaks. Aliases resolve to a canonical name before they reach a chain, a diagnostic, or a log, and no alias string appears in observable output.

| Earlier name | Canonical mode | Also sets |
|---|---|---|
| `auto` | `api_only`, or `api_with_local_fallback` when a local engine is configured | nothing |
| `typesafe` | `api_only` | nothing; the hosted side still comes from `api_provider` |
| `openrouter` | `api_only` | nothing |
| `jev_api` | `api_only` | nothing |
| `clef_api` | `api_only` | `api_provider: clef` |
| `clef` | `api_with_local_fallback` | `api_provider: clef` |
| `clef_with_local_fallback` | `api_with_local_fallback` | `api_provider: clef` |
| `laya` | `local_only` | nothing |
| `laya_local` | `local_only` | nothing |
| `laya_then_hosted` | `local_with_api_fallback` | nothing |
| `laya_with_jev_fallback` | `local_with_api_fallback` | nothing |

The Clef names carry a provider pin because a mode no longer names one. They set `api_provider: clef` only when `api_provider` is still `auto`, so an explicit `api_provider` always wins. Resolution is case-insensitive, and an unknown name is refused with a message naming every accepted mode.

## The local model slot

`local_model` is the checkpoint or engine name sent to the local server. It is not an allowlist: it rejects an empty or whitespace-only value and any value containing a character that would corrupt a URL path segment or a JSON string, and accepts everything else. A local model released tomorrow therefore works by configuration.

Models known to fit the same `/v1/systemone` contract: `laya` (Convai Innovations, also `laya-multilingual` and `laya-typed-decisions`), `kev` (also published as `kev-0.8b`), `tev1` (Together AI, Qwen3.5-based, with `Tev1-4B` and `Tev1-0.8B` checkpoints), and the `jeff` family such as `jeff-qwen3.5-0.8b` and `jeff-gemma4-e2b`. `chaitin/Decis` serves Laya and Kev, and a `jeff` family, behind one Jev-compatible endpoint with one image per engine, where swapping `base_url` is the whole migration. Switching engines is therefore a `local_model` and `laya_base_url` change, with no code change.

Only the default local model has ever been called live from this repository. No other engine has been run here, so the list above is a contract claim from those projects' published documentation rather than a measurement.

Privacy consequence: `local_only` never sends state off the machine; `local_with_api_fallback` does, because a failed local attempt re-sends the same state to the hosted API. `auto` still never selects the local route, `laya` stays a single-provider route with no fallback, and `jev_fallback_order` still rejects `laya` as a member, so `laya_then_hosted` is the only mode in which the local server leads a chain. Hosted answers through this mode are covered by unit tests with a synthetic transport; no live hosted answer is claimed.

### DOGA mode names

The DOGA fork of this design exposes exactly three decision modes. Two of those names are accepted here as aliases for values this package already ships, and the alias is resolved in `settings()` before anything else reads the configuration, so it never reaches a provider chain, a diagnostic, or a log.

Every earlier mode name, including the DOGA fork's `jev_api`, `laya_local`, and `laya_with_jev_fallback`, is listed in the alias table above.

### Consecutive-failure breaker

`local_with_api_fallback` bounds its own remote egress. A local failure whose reason is a configured trigger increments one module-level counter; while the count is at or below three the hosted hop is attempted; past three the hosted leg is suppressed, `laya_fallback_suppressed count=<n> limit=3 reason=<category>` is logged through the engine's warning logger, and the local error is re-raised instead of answered remotely. A successful local answer clears the counter, on `laya` and on `laya_then_hosted` alike. The counter lives in the process, so it resets on restart, and no other route spends it: a standalone `local_only` profile, a chain collapsed by `jev_fallback_enabled: false`, and a failure whose reason is not a configured trigger all leave it at zero. The per-provider cooldown is a different instrument, not a substitute: it postpones the next attempt to one provider and expires by itself, so a local server that fails on every request still receives one remote attempt per cooldown window. The increment and the reset take a queue slot each, because scoring is awaitable and two sessions can score concurrently in one process.

The fallback stays error-only. A weak, low-confidence, or wrong-but-valid local answer is never replaced by a hosted one, and the breaker cannot detect a valid yet incorrect local judgment; it only bounds repeated remote egress after local errors.

### Quality evidence for the local route

The DOGA fork's matched 100-question, three-mode evaluation of the same local classifier is the headline quality evidence for it, and it is that fork's report against authored labels rather than a measurement re-run here: Laya local agreed with the labels on goal 56/100, mode 41/100, stakes 37/100, scenario need 59/100 and high-versus-low ambiguity 67/100, while Jev through the API agreed on 88, 68, 67, 70 and 87. Laya detected none of the 30 authored high-ambiguity labels at the existing 0.7 threshold, and no threshold was tuned on that set. That is a reason to keep the hosted route as the default ranking path, and it is not a final-answer quality study.

## Storage and tools

`LcmStore` owns raw rows, FTS indexing, summary nodes, edges, source links, hints, and committed or aborted node status. Raw identities are unique per session and immutable. `lcm_grep`, `lcm_expand`, and `lcm_nodes` are session-scoped tools. The current grep surface uses exact quoted FTS matching and returns at most 100 rows.

The active assembler gives protected hints first, then summary nodes within a character budget. Nodes arrive highest depth first, and a node that condenses others suppresses its descendants inside the same assembly while those descendants stay recallable. `rollup(session, summary, childIds)` creates that higher layer at `1 + max(child depth)` over at least two sibling nodes, `topLayer` reports the committed nodes no other node summarises, and after each successful compaction the engine condenses `lcm_rollup_fan_in` of them through the host model. A rollup whose host call fails is skipped, never failed forward into the compaction. A keep action can inject the original candidate. A truncate action injects a bounded head and a pointer. An over-budget candidate receives a pointer where possible. This is an implementation boundary, not proof that every host prompt consumes the assembled result.

## Decisions and edge cases

Actions are keep, truncate, defer/drop, or unscored. Jev never mutates raw rows. Unpaired calls remain raw and are not paired by guesswork. Duplicate raw identities with different bodies raise an ownership error. Anchor spans must be deduplicated before scoring; overlapping regexes are expected.

The shrink ladder is T0 full, T1 shortened inputs and headed results, T2 shorter inputs and results, T3 note-only results, and T4 folded old messages. Candidates beyond the hard cap become `jev_unscored`; they must remain recoverable from the raw store. CJK token accounting, externalized payload pointers, and full host prompt assembly remain explicit acceptance checks, not implied by a unit test.

Endpoint validation decodes paths, rejects queries, fragments, credentials, unsafe traversal, controls, and non-local plain HTTP. OpenRouter maps through `/alpha/decisions` and TypeSafe through `/systemone`. Both paths returned parseable `noul` scores in a live qualification on 2026-09-21 with one request each and no fallback; re-verify against your own account and model versions before production use.

## Metrics

`jev_stats` includes candidate, keep, anchor, unscored, call, fallback, provider, threshold, LCM node, text-floor, freed-per-compaction, and unevaluated recall fields. `jev_calibrate` reports the live threshold, whether calibration is active, and how many samples the rolling window holds; with `dry_run` it sends one synthetic probe per provider in the configured route, so a `laya_then_hosted` profile probes the local hop and the keyed hosted hops in that order, and returns latency and status for each, including `error` with the missing environment-variable name when a provider has no key. `jev_providers` reports the configured mode, the real provider order, environment-variable names present, cooldowns, errors, and the provider that last answered; key values are never printed. `jev_scores` and `jev_anchors` expose candidate diagnostics. Three consecutive cycles below 20% freed space emit a warning in the metrics implementation. A suppressed local fallback emits one `laya_fallback_suppressed` warning carrying the count, the limit, and the failure category. Nothing on the scoring path logs a request, a state, candidate text, or an answer: the fallback line carries two provider names and a canonical category, and the per-compaction metrics dump carries numbers, booleans, thresholds, and provider names only.

## Sources and lineage

- [PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246), attributed findings and corrected design brief.
- [DeepSeek Harness CLI reference](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/reference/README.md), plugin/profile and `--dump-config` semantics.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), host project.
- [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction), Jev lineage.
- [hermes-jev-compact](https://github.com/TheEpTic/hermes-plugins/tree/main/hermes-jev-compact), integration lineage.
- [hermes-lcm](https://github.com/stephenschoettler/hermes-lcm), LCM lineage.

The PR headline numbers are attributed, not reproduced here.