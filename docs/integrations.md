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

The current OpenRouter adapter uses `openrouter_base_url` plus `/alpha/decisions`. This is an implementation detail that requires live contract verification. A self-hosted router must accept the repository's `model`, `state`, and `questions` payload and return parseable score fields. Use HTTPS; plain HTTP is restricted to local addresses.

## Running with other compaction plugins

Do not load this bundle beside another bundle that replaces `compaction-basic`. DSH can reconcile bundle layers, and duplicate loader identifiers can fail at runtime even when a config dump looks clean. Back up the profile, inspect `dsh --profile web --dump-config`, then boot a test profile and verify the actual loader before migration.

## Migration from native DSH compaction

Preserve the profile and database. Install in a disposable profile first. Confirm one compaction row, set a unique `databasePath`, configure a provider, run a synthetic marker, then query `lcm_grep` and `lcm_expand`. Keep the old profile disabled until runtime and recovery evidence exists.

## Privacy

Selected conversation content can reach the configured provider. No automatic secret redaction is promised. SQLite archives are local and not encrypted by this package. Use a secret manager and exclude archives from source control.