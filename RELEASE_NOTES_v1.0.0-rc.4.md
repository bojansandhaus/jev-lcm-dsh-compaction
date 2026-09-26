## [1.0.0-rc.4] - 2026-09-26 (prepared, not yet tagged)

Jev-LCM compaction for DeepSeek Harness: Jev ranks stale evidence before lossless context condensation.

This candidate makes the local Laya route behave the way the DOGA fork behaves. The opt-in `laya_then_hosted` chain now bounds its own remote egress: three consecutive local failures still reach the hosted hop, and every further failure until a local success keeps the request local and re-raises the local error. The same release accepts DOGA's mode names as aliases, so a profile written for DOGA can name the same three arrangements here. The default, `auto`, and every existing provider value are unchanged.

Publication state: this candidate is committed and pushed, and no tag or GitHub release has been cut for it, so no registry or release availability is claimed. Nothing here selects Laya by default, installs Laya, or edits a live DSH profile.

### Added

- `laya_local` as an alias for `laya`, and `laya_with_jev_fallback` as an alias for `laya_then_hosted`. `settings()` resolves either name to the canonical value, so the alias never reaches a provider chain, a diagnostic, or a log, and `jev_providers` reports the canonical mode. Every pre-existing value (`auto`, `typesafe`, `openrouter`, `laya`, `laya_then_hosted`) still resolves, and any other value is rejected with `invalid jev_provider: expected auto, typesafe, openrouter, laya, or laya_then_hosted, where laya_local aliases laya and laya_with_jev_fallback aliases laya_then_hosted`. DOGA's third name, `jev_api`, is not an alias here: the hosted arrangements in this package are `auto`, `typesafe` and `openrouter`.
- A consecutive-failure breaker on the local hop, as `src/laya-breaker.ts`: one module-level counter plus a promise-chain mutex, the same shape as the counter and lock DOGA holds for its local classifier. Each local failure increments it; at or below three the hosted fallback is attempted; past three the fallback is suppressed, `laya_fallback_suppressed count=<n> limit=3 reason=<category>` is logged, and the local error is re-raised instead of answered remotely. A successful local answer clears the count, on the `laya` route and on the `laya_then_hosted` route alike. The count is per process and resets on restart.
- `tests/laya-fallback-breaker.test.ts`, nine contracts. The breaker allows three consecutive fallbacks and suppresses the fourth with no remote call; a healthy local call resets a tripped counter and the next failure falls back again; the plain local route resets the same counter; a weak but valid local answer never triggers the fallback; a local-only route never spends breaker budget or logs suppression; a failure whose reason is not a configured trigger never spends it either; the aliases resolve identically to the canonical values; the order validator still rejects `laya` under either alias; and the fallback and suppression logs carry the failure category only.

### Changed

- `jev-lcm rollup skipped:` now logs the error class name instead of the error message. A host summarizer error can quote the content it was summarizing, and that line is not a place for it.
- The logging audit on the scoring path found no other call that can carry request text, state, candidate text, or answers: the fallback line carries only the two provider names and a canonical failure category, the two Prepass and metrics lines are fixed strings, and the per-compaction metrics dump carries numbers, booleans, thresholds and provider names only.
- `settings()` and `EngineConfig.jev` accept the alias spelling in their input type, so a profile can use the DOGA names without a cast.

### Evaluation and limitations

- The headline quality evidence is the DOGA fork's matched 100-question, three-mode evaluation of the same local classifier, and it is that fork's authored-label report rather than a measurement re-run here. Against 100 authored labels, Laya local agreed on goal 56/100, mode 41/100, stakes 37/100, scenario need 59/100 and high-versus-low ambiguity 67/100; Jev through the API agreed on 88, 68, 67, 70 and 87. Laya detected none of the 30 authored high-ambiguity labels at the existing 0.7 threshold, and no threshold was tuned on that set. Keep the hosted providers as the ranking route until Laya's questions and checkpoint are validated against new, independently labeled data, and do not read this as a final-answer quality study.
- The breaker bounds repeated remote egress after local errors. It cannot detect a valid yet incorrect local judgment: the fallback is error-only and never fires on a weak, low-confidence, or wrong-but-well-formed local answer, and the breaker does not make Laya's confidence calibrated.
- The breaker is not a durable rate limit. It is per process, it resets on restart, and it counts only fatal local failures, because that is what protects the hosted leg; a cooldown can only postpone the next remote attempt while the breaker stops the attempt.
- DOGA implements this rule inside its in-process classifier; this package implements it inside the provider chain, so the same rule is expressed on the chain that owns the hosted hop. Both are per process.

### Verification

- 63 tests pass, `pnpm run typecheck` passes for source and tests through `tsconfig.test.json`, `pnpm run build` passes, and `pnpm pack` builds the `@bojansandhaus/jev-lcm-dsh-compaction` 1.0.0-rc.4 archive.
- Live, 2026-09-26, a `laya-serve` process on `127.0.0.1:8123` with the base English checkpoint on CPU, reached through the plugin's own provider code and the real transport: the alias `laya_with_jev_fallback` resolved to `laya_then_hosted` and built `['laya','typesafe','openrouter']`; three consecutive calls answered from the local hop in `422 ms`, `528 ms` and `547 ms` with `0.0569` for the probe question, `calls=1`, `fallback_count=0`, `last_provider=laya`, breaker `0`, and only the local URL on the wire; `jev_providers` reported `mode: laya_then_hosted`.
- Live breaker evidence through the real transport, with the local base repointed at a dead port and no hosted key in the environment: calls one to three each attempted the hosted hop and were answered `401` by the live hosted endpoints, reaching breaker counts 1, 2 and 3; the fourth call attempted only the dead local port, raised `transport_error`, and logged `laya_fallback_suppressed count=4 limit=3 reason=transport_error` with zero hosted attempts.
- The hosted leg is covered by unit tests with an injected synthetic transport only. No hosted key exists in this checkout, so no hosted score is claimed; the live hosted calls returned `401`, which is a fallback trigger rather than an answer.

Licensed under the MIT license. Laya is by Nandakishor M and Convai Innovations, Apache-2.0: https://github.com/NandhaKishorM/laya
