# Integrations

[NousResearch/hermes-agent PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246) showed that Jev-only compaction misses assistant-text recall and eventually hits a text floor. This port keeps Jev as a ranking layer and exposes an LCM-owned SQLite evidence surface, while DSH host installation, loader commitment, and full parity remain pending verification.

## Install into a DSH profile

The upstream DSH CLI reference documents profile plugin operations and config dumps. For a fresh profile, use:

```sh
dsh plugin --profile web add github:bojansandhaus/jev-lcm-dsh-compaction
dsh --profile web --dump-config
```

The repository is local and experimental. Replace the repository spec with a reviewed checkout or package only after confirming its package manifest and patch. DSH profiles reconcile bundle declarations; do not manually add a duplicate patch row. A dump is a composition view, not a runtime loader or compaction receipt.

## DSH conventions

`package.json` declares `dsh.bundle.patch`; `cordis.patch.yml` disables `compaction-basic` and inserts `jev-lcm-compaction`; `apply(ctx, config)` registers the engine and tools. The package injects `llm`, `tokenMeter`, `sessions`, and `tools`. Pin Node and DSH versions from `package.json` until a tested compatibility range is recorded.

## Provider paths

TypeSafe-only: set `jev_provider: typesafe` and `TYPESAFE_API_KEY`. OpenRouter-only: set `jev_provider: openrouter` and `OPENROUTER_API_KEY`. Both: use `auto`, keep fallback enabled, and set both keys. A configured `429`, timeout, transport error, or listed status can try the fallback and produce a sanitized diagnostic. With neither key, Jev scoring is disabled.

Local mode is the alternative to a key, not an addition to it: set `jev_provider: laya` and the engine scores through a `laya-serve` process on loopback, which publishes `/v1/systemone` in the same Decisions contract. Laya is a separate local model rather than a hosted Jev endpoint, so it replaces the hosted pair for that profile: `auto` never selects it, `jev_fallback_order` accepts only `typesafe` and `openrouter`, and no credential is required unless the server was started with its own `LAYA_API_KEY`. Measured limits of the base checkpoint on the production retention questions, and the shared-port trap on `127.0.0.1:8000`, are documented in the README FAQ entry on running locally.

The third route is the explicit opt-in `laya_then_hosted`: the local server leads and the hosted providers follow, as `laya` plus the members of `jev_fallback_order` that have a key. The existing triggers, cooldown, and retries apply unchanged, so a transport error, timeout, `401`, `403`, `429`, or `5xx` from the local server falls through to the hosted hop. Selecting the mode with no hosted key at all fails at load and names the missing environment variables, because the promised fallback cannot exist. Privacy consequence: unlike plain `laya`, this route can send state to a hosted API, since a failed local attempt re-sends it there. Coverage is `tests/laya-then-hosted.test.ts`, and its hosted leg is exercised with an injected synthetic transport only.

OpenRouter has two selectable surfaces behind one provider. The default is the native Decisions endpoint at `openrouter_base_url` plus `openrouter_endpoint_path`, which ships as `https://openrouter.ai/api` plus `/alpha/decisions`, because OpenRouter refuses the Jev model anywhere else: a chat completions request for `~typesafe/jev-latest` returns `400` with "is a decisions model and cannot be used with the chat/completions endpoint. Use the /api/alpha/decisions endpoint instead." Set `openrouter_endpoint_path` to any other path, for example `/v1/chat/completions` with base `https://openrouter.ai/api`, to select the chat completions adapter instead. That adapter sends a JSON mode chat request carrying the same `state` and `questions`, maps the completion back onto the Decisions response contract, and passes a response that already carries an `answers` mapping straight through, so a self-hosted router that speaks the Decisions shape keeps working. Malformed completions fail as `malformed` rather than scoring zero. Both surfaces are covered by `tests/providers.test.ts`. Use HTTPS; plain HTTP is restricted to local addresses.

## Running with other compaction plugins

Do not load this bundle beside another bundle that replaces `compaction-basic`. DSH can reconcile bundle layers, and duplicate loader identifiers can fail at runtime even when a config dump looks clean. Back up the profile, inspect `dsh --profile web --dump-config`, then boot a test profile and verify the actual loader before migration.

## Migration from native DSH compaction

Preserve the profile and database. Install in a disposable profile first. Confirm one compaction row, set a unique `databasePath`, configure a provider, run a synthetic marker, then query `lcm_grep` and `lcm_expand`. Keep the old profile disabled until runtime and recovery evidence exists.

## Privacy

Selected conversation content can reach the configured provider. No automatic secret redaction is promised. SQLite archives are local and not encrypted by this package. Use a secret manager and exclude archives from source control.

`jev_provider: laya` keeps scoring on the machine and sends nothing to a hosted API. `jev_provider: laya_then_hosted` does not: a local attempt that fails with a configured trigger re-sends the same state to the hosted provider that follows it. That is the point of the mode, so choose it only when a hosted hop is acceptable for the state being scored, and keep plain `laya` when it is not.