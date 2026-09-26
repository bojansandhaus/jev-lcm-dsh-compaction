## [1.0.0-rc.3] - 2026-09-26 (prepared, not yet tagged)

Jev-LCM compaction for DeepSeek Harness: Jev ranks stale evidence before lossless context condensation.

This candidate adds the third way to reach a score. The engine could already run over a TypeSafe or OpenRouter key, or entirely locally against a Laya server with no key at all. `laya_then_hosted` is the explicit opt-in that does both in order: the local server answers first, and the hosted providers behind it answer when the local hop fails. The default and the standalone local route are unchanged, so a profile that leaves `jev_provider` at `auto`, or at `laya`, behaves exactly as it did in `1.0.0-rc.2`.

Publication state: this candidate is committed and pushed, and no tag or GitHub release has been cut for it, so no registry or release availability is claimed. Nothing here installs Laya, selects the new mode by default, or edits a live DSH profile.

### Added

- `laya_then_hosted` as a `jev_provider` value. The order is `laya` followed by the members of `jev_fallback_order` that have a key, so `['laya','typesafe','openrouter']` with both keys, `['laya','typesafe']` with one, and the configured order is respected when it is reordered.
- The existing fallback triggers, cooldown, and retries carry over unchanged: a `transport_error`, timeout, `401`, `403`, `429`, or `5xx` from the local server falls through to the hosted hop, and the last remaining provider takes its configured retry.
- A load-time error, naming the missing environment variables, when the mode is selected with no hosted key at all. The mode promises a fallback that cannot exist, so the provider chain refuses to build instead of quietly degrading to a local-only route. `auto` still never selects the local route, and `jev_fallback_order` still rejects `laya` as a member.
- Diagnostics that report the real route: `jev_providers` now includes the configured `mode` alongside the order, the environment-variable names present, cooldowns, sanitized errors, and the provider that last answered, and `jev_calibrate` with `dry_run` probes the local hop and keyed hosted hops in that order. Key values are never printed.
- `tests/laya-then-hosted.test.ts`, ten contracts.

### Privacy consequence

In this mode the state can leave the machine, and that is the point of the mode: a local attempt that fails with a configured trigger re-sends the same state to the hosted API behind it. The standalone `laya` route does not do this and never sends state anywhere. Both statements sit next to each other in the README FAQ, [docs/reference.md](docs/reference.md), [docs/integrations.md](docs/integrations.md), and [docs/operator-guide.md](docs/operator-guide.md). Pick plain `laya` when the state must stay local.

### Live evidence, 2026-09-26, base English checkpoint, CPU

- With `laya-serve` running on `127.0.0.1:8123`, the mode built `['laya','typesafe','openrouter']` and the real call answered from the local hop in `543 ms` with `0.1612` for the probe question: `calls=1`, `fallback_count=0`, `last_provider=laya`. The hosted hops were never contacted.
- With the local base repointed at a dead port, the real transport walked the entire route: `laya` failed as `transport_error`, both hosted providers then answered `401` because no hosted key exists on this machine, `calls=4`, `fallback_count=2`. That is the fallthrough working against the live network, not a hosted answer.

The hosted leg of this mode is covered by unit tests with an injected synthetic transport only. No hosted key was available, so no hosted score is claimed.

### Unchanged

- LCM remains the source of truth and owns raw storage, retrieval, and assembly.
- Jev remains a ranking layer that never rewrites raw evidence.
- `auto` never includes the local route, `laya` stays a single-provider route with no fallback, and the order validator still rejects `laya`.

### Status

Implementation, tests, and documentation are complete and pushed: 54 tests, source and test typecheck, and a clean build. Nothing in this release selects the new mode by default. See [docs/verification.md](docs/verification.md).

Licensed under the MIT license. Laya is by Nandakishor M and Convai Innovations, Apache-2.0: https://github.com/NandhaKishorM/laya
