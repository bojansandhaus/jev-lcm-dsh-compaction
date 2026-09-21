# Experimental release boundaries

This is a release candidate, not a production-certified replacement.

Tests use synthetic text and scores. HTTP tests use loopback servers. They do not measure provider quality, real billing, or comparative performance against private transcripts.

Selected conversation text is sent to the configured provider. This is not an automatic secret-redaction system. The local raw archive is not encrypted by this package. Use a private data directory.

Hermes uses bundled upstream LCM. DSH uses its native BasicCompactionEngine with a separate SQLite archive and summary links, not a full TypeScript port of Hermes LCM.

The byte-based request cap is conservative, not an exact provider tokenizer. Oversized candidates remain unscored. Provider failure leaves host condensation available without fabricated scores.

Further qualification is required for live providers, sustained DSH sessions, cancellation, restart restoration of calibration, independently measured recall, and randomized cross-language parity.

DSH summary nodes currently record generated summaries, including attempts the host may reject. They do not prove a surface replacement committed. Their predecessor chain is not a complete source DAG. Raw evidence is stored separately.

Publication does not activate this engine in a running agent. Package registry publication is separate from GitHub publication.
