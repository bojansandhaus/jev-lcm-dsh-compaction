# Requirement compliance map

This page is part of the rework of the Jev-only compaction failure modes reported in [hermes-agent PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246). It maps the six required corrections, the dual-provider contract, and the packaging requirements to implementation files, tests, and executed receipts.

## FIX-1 to FIX-6

| Clause | Implementation | Tests | Status |
|---|---|---|---|
| FIX-1 calibrated threshold, never a fixed `0.5` | `src/calibration.ts` | `tests/core.test.ts` "calibration and minimum retention", `tests/parity.test.ts` "cross-language calibration outcomes match the Python golden" | Passing |
| FIX-2 assistant-text anchors protected verbatim | `src/anchors.ts`, `src/prepass.ts`, `src/store.ts` hint index and assembly | `tests/core.test.ts` "assistant spans are exact", `tests/lcm-vertical.test.ts` "LCM active context assembles protected verbatim evidence before summaries within budget", "protected keep is exact, while truncate uses only configured head and tiny budgets keep pointers" | Passing |
| FIX-3 LCM owns storage, condensation, and assembly | `src/store.ts` raw log, FTS, DAG nodes, bounded assembly; `src/compressor.ts` host replacement and recall | `tests/lcm-vertical.test.ts` "LCM condenses text while retaining raw messages and committed DAG lineage", "LCM keeps raw tool evidence recoverable when active context is bounded", `tests/host-compaction.test.ts` "compactNow uses the host model and commits exact host result boundaries" | Passing |
| FIX-4 tiered shrink ladder, hard cap, explicit `jev_unscored` | `src/state-shaper.ts` | `tests/core.test.ts` "541 candidates: batched, bounded, unscored and recoverable", "CJK state cap preserves candidates or marks them unscored" | Passing |
| FIX-5 batched scoring across turns | `src/batcher.ts`, `src/prepass.ts` serialized flush queue | `tests/core.test.ts` "541 candidates: batched, bounded, unscored and recoverable", `tests/concurrency.test.ts` "overlapping forced flushes score each candidate once", "summary persistence failure prevents returning a replacement" | Passing |
| FIX-6 honest metrics and low-freed warning | `src/metrics.ts` | `tests/core.test.ts` "bad input and low freed warnings" | Passing |
| Dual-provider authentication with identical resolution and fallback behavior | `src/providers.ts`, `src/jev-client.ts`, `src/settings.ts` | `tests/core.test.ts` "provider resolution, fallback, cooldown and no secret logging", `tests/parity.test.ts` "cross-language provider selection and fallback outcomes match the Python golden" | Passing |
| Multi-layer rollup condensation | `src/store.ts` (`rollup`, `topLayer`, descendant suppression), `src/compressor.ts` (`rollupOnce`) | `tests/lcm-vertical.test.ts` "rollup condenses sibling leaves into a higher layer and replaces them in assembly", `tests/host-compaction.test.ts` "rollup condenses sibling leaf summaries through the host model" | Passing |
| Node lifecycle and crash recovery | `src/store.ts` pending, committed, aborted states with reopen abort | `tests/lcm-vertical.test.ts` "nodes expose pending, committed, and aborted lifecycle states", `tests/host-compaction.test.ts` "assembly excludes explicitly aborted summaries" | Passing |
| Recall-at-budget evaluator | `evaluation/run_eval.ts` | `tests/evaluation.test.ts` "actual host compaction preserves raw retrieval in both arms", "retention responds to actual model transport content", "invalid and nonconvergent budgets are rejected" | Passing |
| Bundle activation through the shipped patch | `cordis.patch.yml`, `src/index.ts` | `tests/loader.test.ts` "shipped bundle disables native engine and mounts Jev through the real loader" | Passing |

## Required regression assertions

| Required assertion | Covered by | Status |
|---|---|---|
| Uniform low `keep_result` probabilities still keep at least 10% of candidates | `tests/core.test.ts` "calibration and minimum retention" uses `i/2500` over 500 samples and asserts at least 50 retained | Passing |
| A delegation id in assistant text appears verbatim in the assembled context | `tests/lcm-vertical.test.ts` "LCM active context assembles protected verbatim evidence before summaries within budget" | Passing |
| A 541-call transcript yields unscored candidates that stay retrievable | `tests/core.test.ts` "541 candidates: batched, bounded, unscored and recoverable" expands each unscored candidate and greps it | Passing |
| Three consecutive low-freed cycles emit a warning | `tests/core.test.ts` "bad input and low freed warnings" asserts exactly one emitted warning | Passing |
| Two consecutive turns inside the batch window do not produce two Jev requests | `tests/core.test.ts` "541 candidates: batched, bounded, unscored and recoverable" asserts zero calls after two ticks and one at the window boundary | Passing |
| OpenRouter alone loads and scores | `tests/core.test.ts` "provider resolution, fallback, cooldown and no secret logging" scores through an OpenRouter-only chain | Passing |
| Both keys set with a primary 429: one fallback, count increments by one | Same test asserts `fallback_count == 1` and provider `openrouter` | Passing |
| Pinned `typesafe` with only an OpenRouter key fails fast naming `TYPESAFE_API_KEY` | Same test asserts the constructor throws matching `TYPESAFE_API_KEY` | Passing |
| Both keys missing disables scoring while LCM condensation proceeds without raising | `tests/core.test.ts` "missing provider keys disable ranking while LCM condensation proceeds" | Passing |
| No key value appears in a log line, metric, or error | `tests/core.test.ts` "provider resolution, fallback, cooldown and no secret logging" asserts no `SECRET_` value in logs or diagnostics | Passing |
| Cross-language parity for calibration and provider selection | `tests/parity.test.ts` both cases against the Python-generated golden | Passing |

## Packaging and documentation

| Requirement | Receipt |
|---|---|
| `pnpm test` | 27 tests pass |
| `pnpm run typecheck` | Passes |
| `pnpm run build` | Passes |
| npm archive contents | `pnpm pack` builds `@bojansandhaus/jev-lcm-dsh-compaction` 1.0.0-rc.1 |
| No secret, key, token, or private path in tracked content | Scan returns no hit |
| `THIRD_PARTY_NOTICES.md` lists upstream projects, licenses, and reuse | Present |
| README section order, provider section, comparison table, FAQ with at least 12 questions, credits, license, DSH install section | Present; 17 FAQ entries |
| Doc pages open with the PR #116246 reminder | `docs/*.md` all open with the reminder and the fixes they concern |
| Disposable profile install and configuration dump | Fresh `DSH_HOME` profile: the package installed, and `dsh --profile jev-test --dump-config` shows `compaction-basic` disabled with `jev-lcm-compaction` inserted; receipt in `docs/verification.md` |

## Deviations and open items

- The shipped patch previously attempted a name change on the native row, which the loader skips. It now disables `compaction-basic` and inserts a distinct row, and the loader test mounts the shipped patch rather than a hand-authored substitute.
- `dsh plugin --dump-config` does not exist in the installed CLI revision; verification uses `dsh --profile <name> --dump-config`. This is documented in the README.
- Summarization text still comes from the host model. LCM owns the raw log, DAG, protected index, bounded assembly, rollup layering, and recall surface, which is the FIX-3 split.
- The upstream production transcript and evaluation policy were never supplied; the evaluator reports synthetic transport integration only.
- npm publication is blocked because `npm whoami` reports no session. The GitHub remote, the `dsh-plugin` topic, and the `v1.0.0` draft release are handled through the stored Git credential.
- The requested `1.0.0` changelog heading is present as prepared release content marked unpublished; no stable release is asserted.
