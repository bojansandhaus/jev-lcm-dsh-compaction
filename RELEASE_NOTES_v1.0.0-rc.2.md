## [1.0.0-rc.2] - 2026-09-22 (published as a GitHub prerelease; registries pending)

Jev-LCM compaction for DeepSeek Harness: Jev ranks stale evidence before lossless context condensation.

This candidate adds a way to run without any hosted service. Jev runs over a TypeSafe or OpenRouter key, or over Laya on your own machine with no key at all, and the local route replaces the hosted one for the profile that selects it. Nothing about the existing default changes: a profile that leaves `jev_provider` at `auto` and supplies a hosted key behaves exactly as it did in `1.0.0-rc.1`.

Publication state: published as a GitHub prerelease at the commit whose CI run passed, with the built artifact `bojansandhaus-jev-lcm-dsh-compaction-1.0.0-rc.2.tgz` attached. No registry publication has happened, so no npm availability is claimed.

### Added

- Local route. Set `jev_provider: laya` and the engine scores through a `laya-serve` process on loopback.
- `laya_base_url`, `laya_endpoint_path`, and `laya_model`, defaulting to `http://127.0.0.1:8000`, `/v1/systemone`, and `convaiinnovations/laya`.
- Keyless wire handling. The request carries no `Authorization` header unless a key exists, and `LAYA_API_KEY` is forwarded only when the server was started with its own bearer check. Diagnostics keep reporting variable names rather than values.
- Replacement semantics. `jev_fallback_order` accepts only `typesafe` and `openrouter`, because the local route replaces the hosted pair instead of joining it, and `auto` never selects the local route on its own.
- `jev_calibrate` with `dry_run` probes the configured route, so a local profile probes the local server.
- `tests/laya-provider.test.ts`, seven contracts covering replacement ordering, keyless payload shape, hosted-chain behavior, order rejection, credential forwarding, the header rule, and dry-run routing.

### Why this works without an adapter

`laya-serve`, which Laya ships, publishes `POST /v1/systemone` in the TypeSafe Decisions contract and answers with the same `answers` mapping. The local route is the TypeSafe request shape pointed at loopback, not a second protocol path, and response validation is shared with the hosted route.

### Measured against a live `laya-serve`, 2026-09-22, base English checkpoint, CPU

- Keep and discard were not separated. Four obviously-keep spans and four obviously-droppable spans, scored with the production retention questions, averaged `0.6516` and `0.6502`, a gap of `0.0014`. Calibration then reported `0.40`, its `keep_threshold_max` ceiling, and all 16 answers were retained. The failure direction is safe: the local route keeps evidence instead of dropping it, and compaction frees nothing until thresholds are recalibrated on labelled data or a retention-tuned checkpoint is used.
- Latency scales with question rows. Those 16 rows took `25.6s`, roughly `1.6s` each, past the default `request_timeout_s` of `30`. Raise `request_timeout_s` for a CPU-only server.
- The default port is shared ground. `laya_base_url` points at `127.0.0.1:8000`; if another service owns that port, it answers the request and the failure appears as `http_error` from a `404` carrying `{"detail": "Not Found"}`. Start the server with `LAYA_PORT` and match the setting.

No quality claim is made for the local checkpoint on these questions. The numbers above come from one synthetic fixture, not from the production transcripts.

### Unchanged

- LCM remains the source of truth and owns raw storage, retrieval, and assembly.
- Jev remains a ranking layer that never rewrites raw evidence.
- Provider selection stays configuration driven, and key values are never printed.

### Status

Implementation, tests, and documentation are complete and pushed: 44 tests, source and test typecheck, and a clean build. Registry publication still requires an authenticated npm session this machine does not have. Nothing in this release installs Laya, selects it by default, or edits a live DSH profile. See [docs/verification.md](docs/verification.md).

Licensed under the MIT license. Laya is by Nandakishor M and Convai Innovations, Apache-2.0: https://github.com/NandhaKishorM/laya
