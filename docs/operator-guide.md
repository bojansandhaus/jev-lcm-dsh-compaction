# Operator guide

[NousResearch/hermes-agent PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246) identified Jev-only threshold collapse, a 25K state ceiling, assistant-text recall loss, and cache churn. This guide covers the DSH port's provider, bundle, storage, and recovery boundaries without claiming a verified host installation.

## Prerequisites

The package declares Node >=22.19 and DSH 0.1.6-alpha.2 peer packages. Confirm the installed `dsh` and Node versions before use. DeepSeek Harness is developer preview software and may change compatibility surfaces.

## Install and verify composition

```sh
dsh plugin --profile web add github:bojansandhaus/jev-lcm-dsh-compaction
dsh --profile web --dump-config
```

The exact repository and profile are operator choices. Back up the profile before mutation. Inspect the dump for one intended compaction row. A successful dump does not prove runtime loader composition, session ownership, or a committed node.

## Configure

Set `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, or both in the DSH profile environment. Select the provider through the profile's plugin configuration. With `auto`, the configured order is TypeSafe then OpenRouter. A pinned provider with a missing key fails at load. No keys disables Jev scoring without intentionally deleting stored evidence.

To run with no hosted service at all, set `jev_provider: laya` and start `laya-serve` on the machine. The local route needs no key, defines no fallback chain because it replaces the hosted pair, and takes `laya_base_url`, `laya_endpoint_path`, and `laya_model`. `jev_calibrate` with `dry_run` probes whichever route is configured, so a local route probes the local server only.

To lead with the local server and keep a hosted provider behind it, set `jev_provider: laya_then_hosted`. The chain is the local hop followed by the members of `jev_fallback_order` that have a key, and the usual triggers, cooldown, and retries apply, so a local transport error, timeout, `401`, `403`, `429`, or `5xx` falls through to the hosted hop. At least one hosted key must be present: with none, the provider chain fails at load and names the missing variables. **Privacy consequence:** in this mode a failed local attempt sends the state to the hosted API, unlike plain `laya`, which never leaves the machine. Use plain `laya` when the state must stay local. `auto` never selects the local route, and `jev_fallback_order` still rejects `laya`, so this mode is the only way the local server leads a chain. `jev_providers` reports the mode, the real order, and the provider that last answered.

Use a distinct `databasePath` per test profile. The patch defaults to `jev-lcm.sqlite` and creates parent directories with restricted permissions where applicable.

## Reset and migration

Stop the profile before changing bundle or provider configuration. Start a fresh test session after changes. If the host exposes `/reset`, use it to flush pending scoring state and begin a new session. The exact reset command belongs to the DSH host version and is not asserted by this package. Never treat reset as archive deletion.

## Diagnostics

- `jev_stats`: metrics and threshold state.
- `jev_providers`: provider order, key-variable presence, cooldown, and sanitized errors.
- `jev_scores`: candidate decisions.
- `jev_anchors`: extracted anchors.
- `jev_calibrate`: threshold and calibration state, or a per-provider dry run probe.
- `lcm_nodes`: node status and host sequence fields.
- `lcm_grep` and `lcm_expand`: session-scoped recovery.
- `dsh --profile web --dump-config`: composed config, before runtime loader mounting.

## Troubleshooting

| Symptom | Action |
|---|---|
| Bundle absent from dump | Check package installation, manifest, patch path, profile, and pnpm resolution. |
| Duplicate compaction or loader failure | Remove competing compaction rows, restore the backup, and use one owner. |
| Provider disabled | Check environment-variable names, not values, and provider mode. |
| Fallback not used | Check trigger list, cooldown, and whether a second key is present. |
| Malformed payload | Treat as provider failure; fix the adapter or endpoint rather than guessing scores. |
| Empty recovery result | Verify active session and use a distinctive marker with `lcm_grep`. |
| Node says pending | A database write is not a host commitment; inspect host sequence fields and runtime logs. |

## Bad configuration recovery

1. Stop DSH and copy the profile plus SQLite file.
2. Restore the prior patch or remove this bundle from the disposable profile.
3. Dump the restored config and boot the host without the new engine.
4. Fix one variable or layer at a time.
5. Reinstall into a fresh profile and test a synthetic marker before migration.

Rotate a credential if it appears in a log. Do not include key values in bug reports.

## Limits

Installation, live providers, runtime loader behavior, complete LCM parity, and performance evaluation remain factual dependencies. The bundled tests do not close them.