# Contributing

Contributions to the Jev-LCM Compaction Plugin for DeepSeek Harness are welcome. Read the architecture and limits before changing behavior: [`docs/reference.md`](docs/reference.md), [`docs/operator-guide.md`](docs/operator-guide.md), and [`docs/limitations.md`](docs/limitations.md). The project follows the corrected pre-pass rationale from [hermes-agent PR #116246](https://github.com/NousResearch/hermes-agent/pull/116246).

## Scope

Keep changes inside the DSH package unless the change is explicitly about documentation or the plugin contract. Native DSH compaction remains the host compressor. The local SQLite archive remains the evidence surface. Jev ranks candidates and must not rewrite or delete raw rows.

Do not describe local tests as live provider validation, clean-profile acceptance, production parity, published npm availability, or full Hermes LCM equivalence. State what was actually exercised.

## Development setup

The checked-in package declares Node `>=22.19.0`, Cordis `4.0.2`, and DSH `0.1.6-alpha.2` peer packages. Use the repository's package manager and lockfile:

```sh
npm install
npm run typecheck
npm run build
npm test
```

The test suite uses synthetic inputs and local transports. Provider tests do not require real credentials. Never add a credential to a fixture, environment file, patch, log, issue, or commit.

## Making a change

1. Read the relevant source and tests before editing.
2. Add or update a focused test for behavior changes.
3. Preserve the provider boundary. TypeSafe and OpenRouter adapters must return the same parsed score shape.
4. Preserve the fallback contract. Missing keys, transport failures, timeouts, malformed responses, and configured status failures must not create fabricated scores.
5. Preserve raw evidence. A scoring decision may change active prominence, but it must not mutate the stored row.
6. Keep diagnostics sanitized. Report environment-variable names and provider state, never key values.
7. Update documentation when defaults, patch behavior, tools, or verification status changes.
8. Run typecheck, build, and tests before opening a pull request.

## DSH bundle changes

`package.json` points `dsh.bundle.patch` at `cordis.patch.yml`. The patch replaces the `compaction-basic` row. Keep the row unique and keep the example synchronized with the intended patch shape:

```sh
npm run build
npm test
npm pack
```

A config dump is a composition check, not proof of runtime loader mounting or committed compaction. If you test a DSH profile, use a disposable profile and record the exact DSH version and command. Do not run this bundle beside another owner of the same compaction row.

## Provider and data handling

Use synthetic conversation text for tests. The package can send selected conversation content to a configured provider, and its local archive is not encrypted by this package. Tests must not depend on a live service, real billing, or private transcripts.

When adding a provider or changing endpoint handling, test:

- provider selection with each key alone and both keys;
- pinned-provider failure when its key is absent;
- fallback on configured failures and cooldown behavior;
- malformed response handling;
- endpoint validation, including unsafe paths and non-local plain HTTP;
- diagnostics that contain no key values.

## Documentation standard

Write concrete, short prose. Link claims to source, tests, or an upstream reference. Keep the README section order intact. The README must retain the PR #116246 rationale, the TypeSafe/OpenRouter paths, the DSH developer-preview warning, upstream lineage, and the distinction between local test evidence and unverified fresh installation.

Relative links must point to files in the repository. When adding a link, check it from the repository root. Do not add claims that the package is published or that it matches Hermes LCM unless those facts have been independently verified and the scope is explicit.

## Pull requests

A pull request should include:

- a concise statement of the behavior changed;
- tests run and their actual result;
- any DSH version and profile used for manual checks;
- provider usage, if any, without credentials or response data that contains private text;
- documentation updates for changed public behavior;
- known verification gaps.

Keep commits focused. Do not bundle unrelated formatting changes with runtime or patch changes.

## License

By contributing, you agree that your contribution is provided under the repository's MIT license.
