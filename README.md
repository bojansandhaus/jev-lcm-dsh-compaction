# Jev-LCM Compaction Plugin for DeepSeek Harness

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Node.js](https://img.shields.io/badge/node-%3E%3D22.19.0-339933.svg)](package.json) [![Status: RC](https://img.shields.io/badge/status-release--candidate-orange.svg)](docs/limitations.md)

**Jev-LCM Compaction Plugin for DeepSeek Harness** is an experimental `dsh-plugin` bundle that puts Jev scoring before a DSH compaction pass and keeps a local SQLite evidence surface beside it. It exists in response to the failure modes reported in [hermes-agent PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246): Jev-only compaction missed assistant-text identifiers, saturated its state budget, and eventually met a growing text floor. This checkout does not claim live provider success, production parity, published npm availability, or full LCM equivalence.

## What problem does hermes-agent PR 116246 identify?

PR #116246 evaluated Jev-only compaction against a production path and rejected it as a drop-in replacement. Its reported findings were:

| Reported finding | Corrective design represented here | Current evidence |
|---|---|---|
| A fixed `keep_threshold: 0.5` dropped all 851 scored candidates in the cited workload. | Rolling calibration with a `0.15` low-sample fallback, a `0.40` cap, and a `0.10` minimum keep-rate target. | Deterministic local tests cover calibration. The PR distribution is not reproduced here. |
| Tool-call ranking tied a recency baseline at one matched budget. | Score selected assistant-text anchors as well as calls and results. | Anchor tests exist. Host-level recall is unverified. |
| Jev-only retention left a growing text floor and decayed across long runs. | Keep native DSH compaction as the primary host compactor; Jev remains a ranking pre-pass. | The architecture is in source. Production parity is unverified. |
| A 25K state ceiling forced blind decisions, including a 541-call overflow case. | Use the T0 to T4 shrink ladder and mark overflow `jev_unscored`. | The 541-call fixture is covered locally. |
| The recall gap lived in assistant text, not only tool results. | Extract identifiers, constraints, decisions, paths, and version pins into anchor candidates. | Extraction is locally tested. Prompt acceptance is unverified. |
| Per-turn calls disturbed the prompt cache. | Batch candidates over three turns, with urgent, shutdown, and reset flushes. | Batching is locally tested. Live cache impact is unmeasured. |

The numbers in the first column belong to the cited PR. They are not fresh measurements from this repository.

## What does this plugin do?

- Ingests raw material into the package's SQLite archive before Jev scoring.
- Scores matched tool-result pairs and selected assistant-text anchors.
- Leaves raw rows unchanged. The archive owns raw evidence; Jev never rewrites it.
- Uses calibration rather than the rejected fixed `0.5` default.
- Batches scoring and marks candidates beyond the state cap `jev_unscored`.
- Accepts `TYPESAFE_API_KEY`, `OPENROUTER_API_KEY`, or both, with automatic fallback in `auto` mode.
- Exposes `lcm_grep`, `lcm_expand`, `lcm_nodes`, `jev_stats`, `jev_providers`, `jev_scores`, and `jev_anchors` as session-scoped tools.
- Keeps ordinary host condensation available when Jev is disabled or fails.

The archive and tools are package behavior. They do not establish that every DSH host prompt consumes the assembled hints exactly as Hermes LCM does.

## How does the DeepSeek Harness context engine pipeline work?

```text
new turn
   |
   v
archive raw messages and tool material
   |
   v
extract assistant-text anchors
   |
   v
batch Jev candidates
   |       T0..T4 state shaping and provider fallback
   v
rank calls, results, and anchors
   |
   v
native DSH compaction plus bounded evidence hints
   |
   v
active-session tools: lcm_grep, lcm_expand, lcm_nodes
```

Jev is a ranking layer. It does not summarize or mutate raw rows. Candidate actions are keep, truncate, defer/drop, or unscored. A candidate at or above the live threshold is eligible for protected inclusion, subject to the engine's hint budget and the host's own prompt budget. A truncated candidate keeps a bounded head and a pointer to the raw row. Deferred and unscored material remains in the local archive when storage is healthy.

The shrink ladder starts with full state, then shortens tool inputs and result bodies, and ends with folded old messages. If the hard cap still does not fit, the remainder is marked `jev_unscored` rather than assigned a fabricated score. Calibration begins with `keep_threshold`, then uses the configured rolling keep-rate quantile after the minimum sample count. DSH's native `BasicCompactionEngine` remains the host compaction path; this package is not a full TypeScript port of Hermes LCM.

## Can I use TypeSafe, OpenRouter, or both with this plugin?

Yes at the configuration and adapter level. The repository accepts either key alone or both. In `auto` mode it filters the configured order to providers with present keys, tries the first available provider, and can try the next provider for configured transport, timeout, authentication, rate-limit, or server failures. A typical sanitized fallback line is:

```text
jev_provider_fallback from=typesafe to=openrouter reason=429
```

Key values are never printed. Jev provider fallback covers configured transport, timeout, authentication, rate-limit, and server failures only. The current OpenRouter adapter targets the repository's `/alpha/decisions` path. Verify that endpoint against the provider you intend to use before sending real conversation data. No live provider success claim is made here.

## How does Jev-LCM compare with Jev-alone and LCM-alone?

| Approach | Evidence storage | Assistant-text targeting | Primary compression | Failure boundary |
|---|---|---|---|---|
| Jev-alone | Depends on the host integration | Original tool-only designs miss it | Text floor remains | Host-dependent |
| LCM-alone | Lossless store and recall | No Jev ranking hint | LCM summaries | Host-dependent |
| Jev-LCM for DSH | Local raw archive and recovery tools | Extracted, bounded anchors | Native DSH compaction | Continue without Jev scoring |

This is an architecture comparison, not a benchmark result. DSH's archive is not claimed to be equivalent to Hermes LCM's SQLite DAG.

## What changed after PR #116246?

The project follows the PR's conclusion that a summary path is still required. FIX-1 adds threshold calibration. FIX-2 reaches assistant-text anchors. FIX-3 keeps host compaction primary. FIX-4 adds the hard-capped shrink ladder. FIX-5 batches requests. FIX-6 exposes provider, threshold, unscored, freed-space, and recall fields. The provider chain accepts TypeSafe and OpenRouter credentials with fallback. These are implementation targets and local behaviors, not proof of production parity with the PR's reference path.

## How do I discover and install the plugin into DSH?

DeepSeek Harness is developer-preview software. Confirm the CLI and profile before changing a real installation:

```sh
dsh --help
dsh plugin --help
dsh plugin --profile web list
```

For a source checkout, use the repository's pinned toolchain:

```sh
git clone https://github.com/bojansandhaus/jev-lcm-dsh-compaction.git
cd jev-lcm-dsh-compaction
npm install
npm run build
npm test
npm pack
```

The local test result and the package archive are not proof of a fresh installation. Registry publication is not asserted. In a disposable DSH profile, install the checkout or reviewed package with the host's plugin command. The documented form is:

```sh
dsh plugin --profile web add github:bojansandhaus/jev-lcm-dsh-compaction
dsh --profile web --dump-config
```

The verified CLI uses `dsh --profile web --dump-config`. Plugin management requires an explicit profile. A config dump shows composition only. It does not prove runtime loader mounting, a committed compaction, live provider access, or prompt parity.

Enable one compaction owner only. The bundle patch disables the native `compaction-basic` row and inserts `jev-lcm-compaction`. Do not load this package beside another bundle that replaces the same row.

## What configuration does the DSH bundle expose?

The bundle schema in `src/index.ts` currently exposes these DSH-level values:

| Setting | Default | Meaning |
|---|---:|---|
| `databasePath` | `jev-lcm.sqlite` | Local archive path. |
| `thresholdRatio` | `0.8` | Host compaction trigger ratio. |
| `retainRatio` | `0.16` | Host retention ratio. |
| `maxTokens` | `8192` | Engine context budget. |
| `auto` | `true` | Enable automatic engine behavior. |
| `jev` | host-supplied value | Jev engine configuration passed to the implementation. |

The engine defaults in `src/settings.ts` include `jev_provider: auto`, TypeSafe base `https://api.typesafe.ai/v1`, OpenRouter base `https://openrouter.ai/api`, TypeSafe path `/systemone`, OpenRouter model `~typesafe/jev-latest`, a `0.15` fallback threshold, a `0.40` threshold cap, a `0.10` minimum keep rate, a 500-sample calibration window, a 50-sample calibration minimum, a three-turn batch window, a 300-candidate batch cap, a 25,000-token state cap, and a 30,000-token request cap. See [`docs/reference.md`](docs/reference.md) for the complete table and validation rules.

Provider environment variables are:

```sh
export TYPESAFE_API_KEY='set-through-your-secret-manager'
# or:
export OPENROUTER_API_KEY='set-through-your-secret-manager'
# with both keys, leave jev_provider at auto for fallback
```

Do not put real credentials in a profile file, patch, issue, test fixture, or log. The example values above are placeholders, not credentials.

## Which commands and tools are available?

The plugin registers these session-scoped tools through Cordis:

- `lcm_grep`: search archived evidence in the active session.
- `lcm_expand`: expand an archived row by store id.
- `lcm_nodes`: inspect archive node status.
- `jev_stats`: read counters and threshold state.
- `jev_providers`: inspect provider order, environment-variable presence, cooldowns, and sanitized errors.
- `jev_scores`: inspect candidate ids, scores, actions, and `jev_unscored` state.
- `jev_anchors`: inspect anchor candidates.

The exact DSH command used to invoke a tool depends on the host CLI. The source registration is in [`src/index.ts`](src/index.ts). Treat a tool result as session-scoped evidence, not as proof that the host committed a compaction.

## What does observability show?

`jev_stats` can expose candidate totals, keep counts, anchor counts, unscored counts, Jev calls, fallback counts, current and calibrated thresholds, the last provider, LCM node counts, text-floor estimates, freed-per-compaction, and the unevaluated recall field. `jev_providers` reports provider order and names of present environment variables, never key values. Three consecutive compactions below 20 percent freed space produce a warning in the metrics implementation.

The local tests cover deterministic calibration, provider fallback, exact spans, overflow handling, concurrency, and Cordis loader composition. They do not verify fresh installation, live provider quality, real billing, production latency, sustained sessions, or comparative recall.

## Why use this design for Jev compaction for DSH?

The boundaries stay visible. The archive keeps raw evidence. Native DSH remains responsible for host compaction. Jev ranks candidates and can stand down when its provider is unavailable. That gives operators a recoverable evidence surface without pretending that this package delivers Lossless Context Management for DeepSeek Harness with full Hermes LCM semantics.

## Is this compatible with my DSH installation?

The package declares Node `>=22.19.0`, Cordis `4.0.2`, and DSH `0.1.6-alpha.2` peer packages. DeepSeek Harness is developer-preview software, so compatibility-breaking changes are expected. Pin the DSH range used by your test suite. The repository has local build and test coverage against its installed dependencies. A clean-profile install, a real host loader, and live provider paths still require verification.

## What are the DSH plugin conventions?

`package.json` declares the `dsh.bundle.patch` manifest and points it at `cordis.patch.yml`. The patch disables `compaction-basic` and inserts a distinct `jev-lcm-compaction` row. `src/index.ts` exports `apply(ctx, config)`, declares `llm`, `tokenMeter`, `sessions`, and `tools` injection, registers the engine's tools, and uses the Cordis lifecycle. The example patch is [`examples/cordis.patch.yml`](examples/cordis.patch.yml). Keep its row unique in a profile.

## Who created the ideas behind this project?

- [Tamara Tran, `fast-jev-compaction`](https://github.com/tamaratran/fast-jev-compaction), MIT: state shaping and keep/truncate/drop lineage.
- [TheEpTic, `hermes-jev-compact`](https://github.com/TheEpTic/hermes-plugins/tree/main/hermes-jev-compact), MIT: Hermes integration lineage.
- [Stephen Schoettler, `hermes-lcm`](https://github.com/stephenschoettler/hermes-lcm), MIT: SQLite, DAG, active-context, and recall lineage.
- [Bojan Sandhaus, `jev-decisions`](https://github.com/bojansandhaus/jev-decisions), MIT: Decisions-shaped context and documentation lineage.
- [TypeSafe](https://typesafe.ai/): Jev model and Decisions API lineage.
- [OpenRouter](https://openrouter.ai/): alternate provider surface used by the adapter.
- [Ehrlich and Blackman, Voltropy PBC](https://arxiv.org/): LCM paper lineage.
- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and [Cordis](https://github.com/deepseek-ai/cordis): DSH host and plugin lifecycle.
- [Hermes maintainers and PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246): evaluation findings and the reason for this pre-pass design.

This repository is an independent community integration. It does not claim authorship of those projects.

## Frequently asked questions

### What happens if Jev is down?

The provider chain records a sanitized failure and the engine can continue without Jev scores. Native host compaction remains available; raw archive behavior depends on the local store being healthy.

### Does the plugin store more data?

Yes. It maintains a local SQLite archive and metadata for recovery. The archive is not encrypted by this package. Set a private `databasePath` and exclude it from source control.

### Can I use OpenRouter?

Yes. Set `OPENROUTER_API_KEY` and choose `jev_provider: openrouter`, or leave `auto` enabled. Verify the adapter endpoint and model contract before sending production data.

### Can I use both keys at once?

Yes. With `auto` and fallback enabled, the configured order selects the first available provider and can try the next provider on configured failures.

### What happens if TypeSafe is rate-limited?

A matching `429` can place TypeSafe on cooldown and try OpenRouter when a second key is present. The repository tests this chain locally. Live provider behavior is unverified.

### Does it work without Hermes LCM?

This is the DSH port. It includes its own SQLite evidence surface and runs beside native DSH compaction. It does not require external Hermes LCM, and it does not claim to implement all Hermes LCM semantics.

### How do I disable it?

Remove the plugin from the disposable profile or restore the prior compaction row, then dump the profile configuration before restarting. Do not run two compaction owners. A host-specific `/reset` may flush pending engine state, but it is not archive deletion.

### Does it slow down every turn?

Scoring is batched, so provider calls occur on flush rather than necessarily on every turn. No live latency claim is made. Measure your workload with the host and provider you actually deploy.

### Can I tune the threshold?

Yes. `keep_threshold` is the low-sample fallback. Calibration can replace it with a rolling quantile capped by `keep_threshold_max`, while `min_keep_rate` sets the target floor.

### What is the reduction ratio?

There is no universal ratio. `thresholdRatio`, `retainRatio`, and Jev thresholds control different parts of the pipeline. Use the local metrics and your workload; this repository does not publish a reduction claim.

### How is Jev threshold calibration performed?

The calibrator collects observed probabilities up to `jev_calibration_window`. Before `jev_calibration_min_samples`, it uses `keep_threshold`. Once the minimum is met, it uses the configured keep-rate quantile and applies `keep_threshold_max`.

### Why does the plugin score assistant text instead of only tool calls?

PR #116246 placed the recall gap in assistant-text identifiers, decisions, and constraints. Tool-call-only scoring cannot rank material it never receives. The anchor extractor targets those spans without rewriting them.

### How does this differ from `fast-jev-compaction`?

This package uses Jev as a pre-pass around native DSH compaction and a local archive. It does not present Jev as the sole compressor or claim that the upstream project fails outside the cited evaluation.

### What did PR #116246 actually prove?

It reported its threshold, recall, text-floor, state-ceiling, assistant-text, and cache findings for its tested workloads. This checkout has not reproduced the PR headline numbers.

### Are dropped results deleted?

A defer or drop action changes active prominence. The package intends to keep the raw row recoverable. Operators must still protect the SQLite file and verify recovery with `lcm_grep` and `lcm_expand`.

### Is the package available on npm?

The repository has package metadata and can produce a local tarball with `npm pack`. Published npm availability is not claimed. Install from a reviewed checkout or archive until a registry release is independently verified.

### Is this production-ready?

No. It is an experimental release candidate. Local deterministic tests pass in the maintained checkout, while clean-profile installation, live providers, host prompt parity, sustained sessions, and production benchmark equivalence remain open verification work.

## License

MIT. This is an independent, community-maintained integration. See [`LICENSE`](LICENSE) and [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
