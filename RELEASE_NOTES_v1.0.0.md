## [1.0.0] - 2026-09-19 (prepared, unpublished)

Jev-LCM Compaction Plugin for DeepSeek Harness: Jev ranks stale evidence before Lossless Context Management condenses conversation history.

Fixes the Jev-only compaction failure modes identified in [NousResearch/hermes-agent#116246](https://github.com/NousResearch/hermes-agent/pull/116246).

### Added

- Jev scoring pass before LCM condensation, so ranking happens on evidence that is still verbatim.
- Assistant-text anchor extraction and protected retention, covering the recall gap the PR identified.
- Calibrated keep thresholds derived from observed score distributions, replacing the fixed `0.5` default.
- Multi-layer rollup condensation over committed sibling summaries with descendant suppression in active context.
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
