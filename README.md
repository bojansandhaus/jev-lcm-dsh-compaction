# Jev LCM for DeepSeek Harness

Keep exact evidence recoverable when an agent condenses a long conversation. This plugin adds Jev relevance scoring and a SQLite evidence archive around native DSH compaction. It is not a complete TypeScript port of Hermes LCM.

**Experimental release candidate.** [Read the limitations](docs/limitations.md) before activation. [Attribution](THIRD_PARTY_NOTICES.md).

## Install from source

```sh
git clone https://github.com/bojansandhaus/jev-lcm-dsh-compaction.git
cd jev-lcm-dsh-compaction
npm install
npm run build
npm test
npm pack
```

Requires Node 22.19 or newer and the pinned DSH 0.1.6-alpha.2 packages. Install the checkout or packed archive through DSH's plugin command in an isolated profile. The declared bundle replaces the compaction-basic row. Do not enable a second compaction backend.

Tools: `lcm_grep`, `lcm_expand`, `lcm_nodes`, `jev_stats`, `jev_providers`, `jev_scores`, and `jev_anchors`. Queries are scoped to the active session. Summary records are generated attempts, not proof of committed compaction.

## Provider setup

Supply TYPESAFE_API_KEY or OPENROUTER_API_KEY through your normal secret manager. Auto mode prefers TypeSafe, then OpenRouter. Pinning a provider requires its own key. With no key, Jev scoring is disabled and ordinary host condensation remains available. Installation does not select the active engine automatically.

## What it does

Raw evidence is stored before scoring. Exact assistant spans and matched tool-result pairs become candidates. A rolling calibrator starts at 0.15, requires 50 samples, retains 500 samples, and enforces a 10 percent minimum keep rate. Batches normally span three turns with at most 300 candidates. Oversized and unscored evidence remains available through the raw archive.

## Verification

Deterministic tests cover calibration, fallback, exact spans, and a 541-call overflow fixture. Hermes additionally exercises upstream condensation with a synthetic summarizer. DSH additionally exercises real Cordis Loader composition. These tests do not establish live provider quality or production benchmark superiority.

## Privacy and licensing

Configured providers receive selected conversation content. This is not automatic secret redaction. Raw archives are local and not encrypted by this package. Do not commit archives or credentials.

MIT license. Original upstream authorship and license notices are preserved. This project does not claim authorship of Hermes LCM, DeepSeek Harness, or Cordis.
