# Changelog

This project addresses the Jev-only compaction failure modes described in [Hermes PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246). The work below concerns calibrated scoring, protected evidence, text condensation, bounded requests, batching, and operational visibility.

## [Unreleased]

Jev-LCM Compaction Plugin for DeepSeek Harness: Jev ranks stale evidence before LCM condenses conversation history.

### Added

- Rolling threshold calibration and a minimum retention floor, addressing the fixed-threshold failure.
- Assistant anchor extraction and verbatim evidence retention, addressing identifier loss during summarization.
- Raw SQLite evidence storage and retrieval, independent of active-prompt retention.
- Tiered state shaping and explicit unscored candidates for oversized batches.
- Batched scoring with forced lifecycle flushes and serialized concurrent requests.
- TypeSafe and OpenRouter provider resolution, retries, fallback, cooldown diagnostics, and secret-safe status output.
- Compaction counters and a warning after repeated low token savings.

### Changed

- Protected evidence and active-context assembly are being reworked against the original product contract.
- Host integration tests now supplement scoring and storage helper tests.

### Architecture

LCM remains responsible for evidence storage and context assembly. Jev supplies ranking hints; it never rewrites raw messages. Pinned source regions are excluded from scoring. Scoring failure falls back to the host condensation path.

### Release blockers

The production recall-at-budget comparison, fresh-profile installation qualification, provider parity review, final documentation review, and publication remain open. No stable 1.0.0 release is asserted here. The requested September 19 release heading must not imply a release occurred before acceptance.

### Credits and license

Tamara Tran contributed the upstream state-shaping and two-question scoring design. TheEpTic supplied the Hermes integration precedent. Stephen Schoettler authored Hermes-LCM's storage, summary DAG, and retrieval implementation. Bojan Sandhaus supplied Jev Decisions product and documentation conventions. TypeSafe supplies Jev; OpenRouter supplies an alternative provider surface. Ehrlich and Blackman authored the LCM research cited in the original brief. The Hermes maintainers supplied the evaluation motivating this project.

The project uses the MIT license. See [third party notices](THIRD_PARTY_NOTICES.md) for licenses and specific reuse.

## [1.0.0-rc.4] - 2026-09-26

Bounds the local Laya fallback, names the DOGA decision modes, and stops one log line from carrying host model text. The default and every existing provider value are unchanged.

### Added

- A consecutive-failure breaker on the local hop, ported from the DOGA fork's v1.3.0 behaviour. Three consecutive local failures still try the hosted hop; every further failure suppresses the hosted leg, logs `laya_fallback_suppressed count=<n> limit=3 reason=<category>`, and re-raises the local error instead of answering remotely. A successful local answer clears the count on both the local routes. The count is per process and resets on restart, which the per-provider cooldown cannot do: a cooldown is a per-chain timer that expires by itself, so a host that fails on every request still receives one remote attempt per cooldown window.
- `laya_local` and `laya_with_jev_fallback` as accepted aliases for `laya` and `laya_then_hosted`. `settings()` resolves them to the canonical value, so no alias reaches a provider chain, a diagnostic, or a log. Every existing value still resolves, and anything else is rejected with a named list of what is accepted.
- `src/laya-breaker.ts`: one module-level counter plus a promise-chain mutex that serializes the increment and the reset, mirroring the lock the DOGA fork holds around its counter.
- `tests/laya-fallback-breaker.test.ts`, nine contracts: three fallbacks then suppression with no hosted call; a healthy local call resetting a tripped counter; the same reset on the plain local route; a weak but valid local answer never triggering the fallback; a local-only route never spending breaker budget; a non-trigger failure never spending it either; the aliases resolving to the canonical values; the order validator still rejecting `laya` under either alias; and the fallback and suppression logs carrying the failure category only.

### Changed

- `jev-lcm rollup skipped:` now logs the error class name instead of `error.message`, so a host summarizer failure cannot put summarized content into a log line.
- `settings()` accepts the alias spelling in its input type and its error names the accepted values. `EngineConfig.jev` is typed as that accepted input shape, so a profile can use the DOGA names without a cast.
- `jev_providers` and `jev_stats`, `docs/reference.md` and the README now describe the local route as the DOGA fork's `laya_local` and the opt-in chain as its `laya_with_jev_fallback`.

### Evaluation and limitations

- The DOGA fork's matched 100-question, three-mode evaluation is the headline quality evidence for the local classifier, and it is DOGA's report, not re-measured here: against 100 authored labels, Laya local agreed on goal 56/100, mode 41/100, stakes 37/100, scenario need 59/100 and high-versus-low ambiguity 67/100, while Jev with the API agreed on 88, 68, 67, 70 and 87. Laya detected none of the 30 authored high-ambiguity labels at the existing 0.7 threshold. Keep the hosted providers as the default ranking route until Laya questions and checkpoints are validated on new labels.
- The breaker bounds repeated remote egress after local errors. It cannot detect a valid yet incorrect local judgment, so the fallback stays error-only and never fires on a weak or low-confidence answer. The breaker does not make Laya's confidence calibrated, and nothing here tunes the 0.7 threshold.
- A failure whose reason is not a configured trigger never reaches the hosted hop, so it does not spend breaker budget. That is deliberate: the count exists to bound remote egress, not to score the local model.

### Verification

- 63 tests pass, `pnpm run typecheck` passes for source and tests, `pnpm run build` passes, and `pnpm pack` builds the 1.0.0-rc.4 archive.
- Live, 2026-09-26, base English checkpoint on CPU at `127.0.0.1:8123`: the alias `laya_with_jev_fallback` resolved to `laya_then_hosted`, built `['laya','typesafe','openrouter']`, and answered three consecutive calls from the local hop in `422 ms`, `528 ms` and `547 ms` with `0.0569` for the probe question, `calls=1`, `fallback_count=0`, `last_provider=laya`, breaker `0`, and only the local URL on the wire.
- Live breaker evidence through the real transport with the local base repointed at a dead port and no hosted key: calls one to three each attempted the hosted hop and were answered `401` by the live endpoints (or `transport_error` while the first DNS lookup was cold), reaching breaker counts 1, 2 and 3; the fourth call attempted only the dead local port, raised `transport_error`, and logged `laya_fallback_suppressed count=4 limit=3 reason=transport_error` with zero hosted attempts.
- The hosted leg is covered by unit tests with an injected synthetic transport only. No hosted key exists in this checkout, so no hosted score is claimed; the live hosted calls above returned `401`, which is a fallback trigger rather than an answer.

## [1.0.0-rc.3] - 2026-09-26

Adds the third provider route: the local Laya server first with the hosted Jev providers behind it, as an explicit opt-in. The default and the existing local route are unchanged.

### Added

- `laya_then_hosted` as a `jev_provider` value. The order is the local server followed by the members of `jev_fallback_order` that have a key, so `['laya','typesafe','openrouter']` with both keys and `['laya','typesafe']` with only TypeSafe. The configured triggers, cooldown, and retries apply unchanged, so a local `transport_error`, timeout, `401`, `403`, `429`, or `5xx` falls through to the hosted hop.
- A load-time error naming the missing environment variables when the mode is selected with no hosted key at all, because the mode promises a fallback that cannot exist.
- `mode` in the `jev_providers` diagnostics, and a `dry_run` probe that follows the real order of this mode instead of the generic hosted pair.
- `tests/laya-then-hosted.test.ts`, ten contracts: order construction with both keys, with one key, with a reordered `jev_fallback_order`, and without any key; local success using the local hop; fallthrough for every configured trigger class; `fallback_count`, `last_provider`, error and cooldown bookkeeping; walking past both hosted providers with the retry on the last one; standalone `laya` unchanged; `auto` still excluding the local route; the order validator still rejecting `laya`; fallback disabled collapsing to the local hop; and the dry-run order.

### Privacy

In this mode a failed local attempt sends the state to a hosted API. That is the point of the mode. Plain `laya` never leaves the machine. Both statements sit beside each other in the README FAQ, [docs/reference.md](docs/reference.md), [docs/integrations.md](docs/integrations.md) and [docs/operator-guide.md](docs/operator-guide.md).

### Live evidence, 2026-09-26

- With a `laya-serve` process on `127.0.0.1:8123` (base English checkpoint, CPU), the mode built `['laya','typesafe','openrouter']` and the local hop answered in `543 ms` with `0.1612` for the probe question, `calls=1`, `fallback_count=0`, `last_provider=laya`.
- With the local base repointed at a dead port, the real transport walked the whole route: `laya` `transport_error`, then `401` from both hosted providers because no hosted key exists on this machine, `calls=4`, `fallback_count=2`. The hosted leg returning an answer is covered by unit tests with an injected synthetic transport only.

### Unchanged

- `auto` never selects the local route, `laya` stays a single-provider route with no fallback, and `jev_fallback_order` still rejects `laya`.
- Key values are never printed; diagnostics report variable names only.

### Status

Implementation, tests, and documentation are complete and pushed: 54 tests, source and test typecheck, and a clean build. Registry publication is unchanged from `1.0.0-rc.2`. Nothing in this release selects the new mode by default.

## [1.0.0-rc.2] - 2026-09-22

Adds a local route for Jev scoring: instead of calling TypeSafe or OpenRouter with a key, point the engine at a Laya server on your own machine. The hosted pair remains the default and an existing configuration keeps behaving exactly as before.

### Added

- `laya` as a `jev_provider` value that replaces the hosted pair for that profile. Laya is a separate local model, and `laya-serve` publishes `/v1/systemone` in the same Decisions contract as TypeSafe, so the request and response path are shared with the hosted route.
- `laya_base_url`, `laya_endpoint_path`, and `laya_model`, defaulting to `http://127.0.0.1:8000`, `/v1/systemone`, and `convaiinnovations/laya`.
- Keyless wire handling: `post` omits the `Authorization` header when no key is configured, and `LAYA_API_KEY` is forwarded only when the local server was started with its own bearer check.
- `jev_calibrate` with `dry_run` now probes the configured route, so a local profile probes the local server rather than the hosted providers.
- `tests/laya-provider.test.ts`, seven contracts: replacement ordering, keyless payload shape, the hosted chain never selecting the local route, fallback-order rejection, credential forwarding without leaking it, the header rule, and dry-run routing.

### Measured against a live `laya-serve`, 2026-09-22, base English checkpoint, CPU

- Keep and discard were not separated on the production retention questions: `0.6516` against `0.6502`, a gap of `0.0014`. Calibration then reported `0.40`, its ceiling, and all 16 answers were retained. The route fails safe by keeping evidence, and frees nothing until thresholds are recalibrated on labelled data or a retention-tuned checkpoint is used.
- Those 16 question rows took `25.6s`, roughly `1.6s` each, beyond the default `request_timeout_s` of `30`.
- `laya_base_url` defaults to `127.0.0.1:8000`, so another service bound to 8000 answers instead. A `404` carrying `{"detail": "Not Found"}` surfaces as `http_error`, which is not a fallback trigger.

### Status

Implementation, tests, and documentation are complete and pushed. Registry publication is unchanged from `1.0.0-rc.1`. Nothing in this release installs Laya or selects it by default.

## [1.0.0] - 2026-09-19 (prepared, unpublished)

Jev-LCM Compaction Plugin for DeepSeek Harness: Jev ranks stale evidence before Lossless Context Management condenses conversation history.

Fixes the Jev-only compaction failure modes identified in [NousResearch/hermes-agent#116246](https://github.com/NousResearch/hermes-agent/pull/116246).

### Added

- Jev scoring pass before LCM condensation, so ranking happens on evidence that is still verbatim.
- Assistant-text anchor extraction and protected retention, covering the recall gap the PR identified.
- Calibrated keep thresholds derived from observed score distributions, replacing the fixed `0.5` default.
- Multi-layer rollup condensation: committed sibling summaries are condensed into a higher-depth node through the host model, and assembly emits the higher layer while its descendants stay recallable.
- Tiered state shrink ladder with a hard token cap and explicit `jev_unscored` marking.
- Batched scoring across turns with forced flushes at lifecycle boundaries.
- LCM hint consumption so ranking decisions reach active-context assembly with raw evidence pointers.
- Recall-tool compatibility for `lcm_grep`, `lcm_expand`, and node inspection.
- Provider fallback contract and observability counters.
- Recall-at-budget evaluation harness in `evaluation/`.
- Dual-provider authentication across TypeSafe and OpenRouter with automatic fallback.

### Architecture

- LCM remains the source of truth and the primary text compressor.
- Jev is a ranking layer only; it never rewrites raw evidence.
- Pinned regions are excluded from scoring.
- Provider selection is configuration driven and never prints key values.

### Finding map

| PR #116246 finding | Shipped correction |
|---|---|
| Fixed `keep_threshold: 0.5` dropped every scored candidate | Rolling threshold calibration with a `0.15` low-sample fallback, a `0.40` cap, and a `0.10` minimum keep rate |
| Tool-call ranking missed assistant text | Regex anchor extraction and a protected verbatim index carried into assembled context |
| A Jev-only text floor grew across long runs | LCM remains the primary compressor and storage owner; Jev ranks |
| A 25K state ceiling forced blind decisions | T0 to T4 shrink ladder, hard request cap, and explicit `jev_unscored` candidates |
| Per-turn scoring disturbed the prompt cache | Three-turn batch window with pressure and lifecycle flushes |
| Metrics hid the cost of compaction | `lcm_recall_at_budget`, `lcm_freed_per_compaction`, `jev_unscored_count`, live threshold, provider counters, and a repeated low-freed warning |

### Credits

- Tamara Tran, [fast-jev-compaction](https://github.com/tamaratran/fast-jev-compaction) (MIT): state shaping, two-question scoring, keep/truncate/drop model.
- TheEpTic, [hermes-jev-compact](https://github.com/TheEpTic/hermes-plugins/tree/main/hermes-jev-compact) (MIT): Hermes integration seam, fallback contract, counters.
- Stephen Schoettler, [hermes-lcm](https://github.com/stephenschoettler/hermes-lcm) (MIT): SQLite store, summary DAG, recall tools, active-context assembly.
- Bojan Sandhaus, [jev-decisions](https://github.com/bojansandhaus/jev-decisions) (MIT): README structure, documentation depth, product framing.
- TypeSafe: the Jev model and Decisions API. OpenRouter: the alternative provider surface.
- Ehrlich and Blackman (Voltropy PBC): the LCM paper.
- The Hermes maintainers and the authors of [NousResearch/hermes-agent#116246](https://github.com/NousResearch/hermes-agent/pull/116246): the evaluation that established Jev-only compaction as insufficient. The port is behavioural parity for calibration and provider resolution, verified by shared fixtures.

### Status

Release content is complete but unpublished. This is a port of [jev-lcm-hermes-compaction](https://github.com/bojansandhaus/jev-lcm-hermes-compaction). The GitHub remote, repository topic, and draft release use the stored Git credential. Registry publication still requires an authenticated npm session, which this machine does not have. See [docs/compliance.md](docs/compliance.md) and [docs/verification.md](docs/verification.md).

Licensed under the MIT license.
