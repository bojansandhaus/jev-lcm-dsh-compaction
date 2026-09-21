# Third party notices

This package is MIT licensed and community maintained. It reuses design from five projects, depends on Cordis and DeepSeek Harness packages at runtime, and calls two external services. Each entry names the license as published in that repository and exactly what was reused. Licenses were read through the GitHub license API on 2026-09-21.

## deepseek-ai/deepseek-harness

- Repository: https://github.com/deepseek-ai/deepseek-harness
- License: MIT
- Reused: nothing copied. The plugin registers through the harness plugin lifecycle, subclasses native DSH compaction, and depends on the published peer packages listed in `package.json`. The harness is developer preview software and its API may change.

## Cordis and the @deepseek-ai packages

- Packages: `@deepseek-ai/cordis`, `@deepseek-ai/schemastery`, and the `@deepseek-ai/dsh-*` peer packages pinned in `package.json`.
- License: MIT as published on npm.
- Reused: the plugin context, the config schema helper, the tools registry, the session and token meter interfaces, and the compaction base class. No package source is vendored.

## hermes-lcm

- Repository: https://github.com/stephenschoettler/hermes-lcm
- License: MIT
- Reused: design only, no code. The vocabulary this port answers to, a SQLite lossless store, depth-aware summary nodes, a protected fresh tail, and recall tools, comes from that project and from the LCM paper. This port keeps the store shape and the protected-anchor idea while subclassing native DSH compaction rather than translating the Hermes engine.

## fast-jev-compaction

- Repository: https://github.com/tamaratran/fast-jev-compaction
- License: MIT
- Reused: design only, no code. The state shaping approach, the two-question scoring model, and the keep, truncate, drop vocabulary.

## hermes-jev-compact

- Repository: https://github.com/TheEpTic/hermes-plugins/tree/main/hermes-jev-compact
- License: MIT
- Reused: design only, no code. The fallback contract that keeps a session alive when scoring fails, and the counter vocabulary.

## jev-lcm-hermes-compaction

- Repository: https://github.com/bojansandhaus/jev-lcm-hermes-compaction
- License: MIT
- Reused: design and behavior. This plugin is the DeepSeek Harness port of that Hermes plugin by the same author. Provider resolution, the fallback chain, the calibration algorithm, and the anchor patterns are behaviorally matched, and the parity tests in `tests/parity.test.ts` assert that match against checked-in goldens produced by the Python implementation.

## jev-decisions

- Repository: https://github.com/bojansandhaus/jev-decisions
- License: MIT
- Reused: documentation only. README structure, section order, and documentation depth. No code.

## TypeSafe (Jev, System One, Decisions API)

- Service: https://api.typesafe.ai/v1
- No TypeSafe code is reused or redistributed. The plugin sends Decisions-shaped scoring requests over HTTPS with the operator's own key. Jev and System One are TypeSafe products; this project is independent and not affiliated with TypeSafe.

## OpenRouter

- Service: https://openrouter.ai
- No OpenRouter code is reused or redistributed. The plugin can send scoring requests either to the native Decisions surface at `/api/alpha/decisions` or to the chat completions surface at `/api/v1/chat/completions` through a Decisions-shaped adapter, using the operator's own key.

## Lossless Context Management

- Ehrlich and Blackman, Voltropy PBC, February 2026.
- No code reused. The vocabulary and the priorities, a DAG of summary nodes, a protected fresh tail, and a lossless raw store, come from the paper.
