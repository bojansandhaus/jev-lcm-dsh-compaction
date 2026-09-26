# Verification and release status

Hermes PR #116246 motivates the acceptance gates: compaction must retain useful evidence within a measured budget, not merely pass scoring helper tests. This report separates executed checks from outstanding product requirements. The clause-by-clause map is in [compliance.md](compliance.md).

## Executed locally

- 44 tests pass. `pnpm run typecheck` (source and tests, the latter through `tsconfig.test.json`) and `pnpm run build` pass. `pnpm pack` builds the `@bojansandhaus/jev-lcm-dsh-compaction` 1.0.0-rc.2 archive.
- The local route is a replacement, not a chain member: `jev_provider: laya` builds an order of exactly one provider, `auto` never selects it, `jev_fallback_order` rejects it, and the wire client omits the `Authorization` header when no key exists. Receipts: `tests/laya-provider.test.ts`.
- The local route was exercised against a real `laya-serve` process on 2026-09-22 with the base English checkpoint on CPU, through the plugin's own provider code: the request reached `POST /v1/systemone`, returned Decisions shaped `noul` answers, and the production decision rules applied them. On the production retention questions the checkpoint did not separate keep from discard (`0.6516` against `0.6502` over eight scores each), calibration stopped at its `0.40` ceiling, and all 16 answers were retained, so the route fails safe by keeping evidence and frees nothing until thresholds are recalibrated. The same run took `25.6s` for 16 question rows, about `1.6s` each. No quality claim is made for it.
- Calibration and provider parity against the Python reference: shared JSON scenarios with Python-generated goldens, checked by both languages.
- The evaluator runs three arms through actual plugin and host code with synthetic external transports: `ranking-disabled` (the host condensation path unranked), `jev-only` (Jev ranking with no condensation path), and `jev-lcm` (the shipped design). `evaluation/results.json` records `synthetic-transport-integration`, `upstream_transcripts_available: false`, and `upstream_production_run_reproduced: false`. At a 10000-token budget over 52745 input tokens the ranking-disabled arm retained 0 of 1 fixture markers in the assembled context and the jev-lcm arm retained 1 of 1, both within budget; the jev-only arm retained the marker but grew the prompt to 52821 tokens and missed the budget, which is the unbounded text floor from PR finding #3 reproduced in a measurement. Raw retrieval recovered the marker in both arms that own a store, and the jev-only arm reports null because it owns none.
- The OpenRouter surface is selectable and tested both ways. The default is the native Decisions endpoint, because OpenRouter refuses the Jev model on chat completions with a 400; setting `openrouter_endpoint_path` to another path selects the chat completions adapter, which maps a Decisions shaped response onto the same scoring contract, passes a proxied gateway's answers mapping straight through, and rejects malformed completions as `malformed`. Receipts: `tests/providers.test.ts`.
- `jev_calibrate` reports the live threshold, the calibration flag, and the sample count, and with `dry_run` it sends one synthetic probe per configured provider and reports latency and status for each without touching session data. A provider with no key reports `error` with the missing variable name, not a crash. Receipts: `tests/providers.test.ts`.
- LCM ownership verified in the plugin's own store: immutable raw log with canonical identities, FTS recall, depth-tracked DAG nodes with pending, committed, and aborted lifecycle, crash-time abort of pending nodes on reopen, a protected hint index, and bounded assembly that places protected verbatim evidence before committed summaries and degrades to raw pointers under tiny budgets.
- Bundle activation verified twice: a disposable `DSH_HOME` profile installed the archive, and `dsh --profile jev-test --dump-config` showed `compaction-basic` disabled with `jev-lcm-compaction` inserted; a loader regression mounts the shipped `cordis.patch.yml` through the real Cordis loader and asserts the native engine is never constructed.
- The shipped patch previously attempted a name change on the native row, which the loader skips with a warning. That is why the patch now disables the native row and inserts a distinct one.
- Multi-layer rollup condensation is implemented and tested. Sibling leaf summaries are created without chaining, `rollup` builds the next layer over at least two of them, assembly emits the higher layer and suppresses its descendants while they stay recallable, and the engine condenses four committed top-layer summaries through the host model. Receipts: `tests/lcm-vertical.test.ts` and `tests/host-compaction.test.ts`.
- Live provider qualification on 2026-09-21 through the plugin's own client: TypeSafe at `https://api.typesafe.ai/v1/systemone` returned `{"q0": 0.83}` and OpenRouter at `https://openrouter.ai/api/alpha/decisions` with `~typesafe/jev-latest` returned `{"q0": 0.84}`. Each used one request, selected the pinned provider, and recorded no fallback. The prompt was a synthetic sentence, not conversation data.
- Live provider characterization re-run on 2026-09-21 against the shipped head through `evaluation/live-qualification.ts`, 12 scoring calls per provider over one synthetic payload of 2485 state characters and 4 questions: TypeSafe answered 12 of 12 with p50 325 ms and p95 899 ms, OpenRouter 12 of 12 with p50 655 ms and p95 885 ms, no errors and no fallback. Scores for the same question stayed inside 0.68 to 0.71 for TypeSafe and 0.69 to 0.71 for OpenRouter. The band sits far above the fixed `0.5` the upstream report criticises, which is the case for the calibrated threshold rather than a fixed cut. `LIVE_QUALIFICATION_CALLS` changes the call count; the harness sends no conversation data.
- Both repositories are pushed to their GitHub remotes. Release content exists as a draft release; npm publication remains blocked.


## Not established

- The production recall-at-budget comparison. The upstream transcript and evaluation policy were never supplied.
- Remote CI on an exact head commit.
- npm publication: `npm whoami` reports no session, so registry publication is blocked. The GitHub side is complete through the stored Git credential.

## Release content

The `1.0.0` changelog section and [RELEASE_NOTES_v1.0.0.md](../RELEASE_NOTES_v1.0.0.md) contain the requested release content. No stable release is asserted.

## Publication record

- Continuous integration, workflow `Tests`, passes on the default branch: the runs for the pushed rework commits, including `35637337297`, were read back green. Later documentation-only commits run the same workflow.
- Repository topics include the discovery topic required by the brief: `dsh-plugin` on the DSH repository, plus `lcm`, `compaction`, `context-management`, and `jev` on both.
- The release candidate is published as a GitHub prerelease tagged `v1.0.0-rc.1` at the commit whose CI run passed, with the built artifact `bojansandhaus-jev-lcm-dsh-compaction-1.0.0-rc.1.tgz` attached and verified downloadable. Registry publication has not happened, so no npm availability is claimed, and the `v1.0.0` tag is still unused.
- npm publication is still blocked: `npm whoami` reports no session on this machine. For this distribution the remaining command is `npm publish --access public`.

