# Verification and release status

Hermes PR #116246 motivates the acceptance gates: compaction must retain useful evidence within a measured budget, not merely pass scoring helper tests. This report separates executed checks from outstanding product requirements. The clause-by-clause map is in [compliance.md](compliance.md).

## Executed locally

- 25 tests pass. `pnpm run typecheck` and `pnpm run build` pass. `pnpm pack` builds the `@bojansandhaus/jev-lcm-dsh-compaction` 1.0.0-rc.1 archive.
- Calibration and provider parity against the Python reference: shared JSON scenarios with Python-generated goldens, checked by both languages.
- The evaluator runs actual host compaction and raw retrieval with synthetic external transports. `evaluation/results.json` records `production_comparison: false` and `synthetic-transport-integration`. Both the ranking-disabled and ranking-enabled arms recovered the evidence marker from persisted storage; only the ranking-enabled arm retained it in assembled context.
- LCM ownership verified in the plugin's own store: immutable raw log with canonical identities, FTS recall, depth-tracked DAG nodes with pending, committed, and aborted lifecycle, crash-time abort of pending nodes on reopen, a protected hint index, and bounded assembly that places protected verbatim evidence before committed summaries and degrades to raw pointers under tiny budgets.
- Bundle activation verified twice: a disposable `DSH_HOME` profile installed the archive, and `dsh --profile jev-test --dump-config` showed `compaction-basic` disabled with `jev-lcm-compaction` inserted; a loader regression mounts the shipped `cordis.patch.yml` through the real Cordis loader and asserts the native engine is never constructed.
- The shipped patch previously attempted a name change on the native row, which the loader skips with a warning. That is why the patch now disables the native row and inserts a distinct one.
- Multi-layer rollup condensation is implemented and tested. Sibling leaf summaries are created without chaining, `rollup` builds the next layer over at least two of them, assembly emits the higher layer and suppresses its descendants while they stay recallable, and the engine condenses four committed top-layer summaries through the host model. Receipts: `tests/lcm-vertical.test.ts` and `tests/host-compaction.test.ts`.
- Live provider qualification on 2026-09-21 through the plugin's own client: TypeSafe at `https://api.typesafe.ai/v1/systemone` returned `{"q0": 0.83}` and OpenRouter at `https://openrouter.ai/api/alpha/decisions` with `~typesafe/jev-latest` returned `{"q0": 0.84}`. Each used one request, selected the pinned provider, and recorded no fallback. The prompt was a synthetic sentence, not conversation data.
- Live provider characterization on 2026-09-21 through `evaluation/live-qualification.ts`, 12 scoring calls per provider over one synthetic payload of 2485 state characters and 4 questions: TypeSafe answered 12 of 12 with p50 321 ms and p95 879 ms, OpenRouter 12 of 12 with p50 690 ms and p95 1140 ms, no errors and no fallback. Scores for the same question stayed inside 0.68 to 0.71 for both providers. The band sits far above the fixed `0.5` the upstream report criticises, which is the case for the calibrated threshold rather than a fixed cut. `LIVE_QUALIFICATION_CALLS` changes the call count; the harness sends no conversation data.
- Both repositories are pushed to their GitHub remotes. Release content exists as a draft release; npm publication remains blocked.


## Not established

- The production recall-at-budget comparison. The upstream transcript and evaluation policy were never supplied.
- Remote CI on an exact head commit.
- npm publication: `npm whoami` reports no session, so registry publication is blocked. The GitHub side is complete through the stored Git credential.

## Release content

The `1.0.0` changelog section and [RELEASE_NOTES_v1.0.0.md](../RELEASE_NOTES_v1.0.0.md) contain the requested release content and are marked prepared and unpublished. No stable release is asserted.

## Publication record

- Continuous integration, workflow `Tests`, passes on the default branch: the runs for the pushed rework commits, including `35637337297`, were read back green. Later documentation-only commits run the same workflow.
- Repository topics include the discovery topic required by the brief: `dsh-plugin` on the DSH repository, plus `lcm`, `compaction`, `context-management`, and `jev` on both.
- The `v1.0.0` release exists as a draft and is marked prerelease, with content taken from `RELEASE_NOTES_v1.0.0.md`. A draft release is not a published release and the tag does not exist until it is published.
- npm publication is still blocked: `npm whoami` reports no session on this machine. For this distribution the remaining command is `npm publish --access public`.

