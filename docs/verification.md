# Verification and release status

Hermes PR #116246 motivates the acceptance gates: compaction must retain useful evidence within a measured budget, not merely pass scoring helper tests. This report separates executed checks from outstanding product requirements. The clause-by-clause map is in [compliance.md](compliance.md).

## Executed locally

- 25 tests pass. `pnpm run typecheck` and `pnpm run build` pass. `pnpm pack` builds the `@bojansandhaus/jev-lcm-dsh-compaction` 1.0.0-rc.1 archive.
- Calibration and provider parity against the Python reference: shared JSON scenarios with Python-generated goldens, checked by both languages.
- The evaluator runs actual host compaction and raw retrieval with synthetic external transports. `evaluation/results.json` records `production_comparison: false` and `synthetic-transport-integration`. Both the ranking-disabled and ranking-enabled arms recovered the evidence marker from persisted storage; only the ranking-enabled arm retained it in assembled context.
- LCM ownership verified in the plugin's own store: immutable raw log with canonical identities, FTS recall, depth-tracked DAG nodes with pending, committed, and aborted lifecycle, crash-time abort of pending nodes on reopen, a protected hint index, and bounded assembly that places protected verbatim evidence before committed summaries and degrades to raw pointers under tiny budgets.
- Bundle activation verified twice: a disposable `DSH_HOME` profile installed the archive, and `dsh --profile jev-test --dump-config` showed `compaction-basic` disabled with `jev-lcm-compaction` inserted; a loader regression mounts the shipped `cordis.patch.yml` through the real Cordis loader and asserts the native engine is never constructed.
- The shipped patch previously attempted a name change on the native row, which the loader skips with a warning. That is why the patch now disables the native row and inserts a distinct one.

## Not established

- The production recall-at-budget comparison. The upstream transcript and evaluation policy were never supplied.
- Live TypeSafe and OpenRouter wire compatibility. Fixtures inject transports; no live provider call is claimed.
- Multi-layer rollup condensation. Node depth grows along the chain, and the exercised fixtures assert one node per depth; deeper rollup summaries are not implemented.
- Remote CI on an exact head commit.
- Publication: no authenticated `gh` host and no npm session on this machine, so the `dsh-plugin` topic, the `v1.0.0` release, and npm publication are blocked on credentials.

## Release content

The `1.0.0` changelog section and [RELEASE_NOTES_v1.0.0.md](../RELEASE_NOTES_v1.0.0.md) contain the requested release content and are marked prepared and unpublished. No stable release is asserted.
