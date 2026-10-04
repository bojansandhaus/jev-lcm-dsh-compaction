## [1.0.0-rc.5] - 2026-10-04 (published)

Cloudflare Clef joins TypeSafe, OpenRouter, and the local Laya server as a fourth provider surface. This is a prerelease; no stable release is asserted, and no registry publication exists. The package is distributed from the GitHub release, not from npm.

### What changed

Clef is served by Cloudflare Workers AI and called on the per-account endpoint in one request. No Worker is deployed, no GPU is provisioned, and nothing is self-hosted here. `CLOUDFLARE_ACCOUNT_ID` scopes the endpoint and `CLOUDFLARE_API_TOKEN` authorises the call; the token needs **Account > Workers AI > Read** and is sent as a bearer token in the `Authorization` header.

Clef enters the provider vocabulary in three ways:

- `jev_provider: clef` selects it first and keeps `jev_fallback_order` behind it, so a configured failure hands over rather than ending the call.
- Listing `clef` in `jev_fallback_order` puts it inside an `auto` or `laya_then_hosted` chain. It is never selected implicitly: the default order is TypeSafe and OpenRouter, so Clef runs only when named.
- `clef_api` is accepted as a mode alias resolving to `clef`, alongside the aliases this package already takes from the DOGA fork.

`clef_model` picks between `clef` and `clef-flash`. That is a setting on the one Clef provider, not a second provider name, alias, or chain member.

The wire contract parses both the bare model output and Cloudflare's `success`/`result` envelope. `success: false` surfaces Cloudflare's own error codes as the failure category. Question ids containing a character Clef rejects are sanitized outbound and mapped back inbound. `score` answers require an integer index inside the criterion range, and their `probabilities` block is accepted as an object keyed by criterion or as a positional array. `choice` answers require a `probabilities` distribution. Answers land on the same `0` to `1` index scale the local route uses.

### Privacy

This package ranks conversation state before a compaction pass, so selecting Clef sends the reviewed state off the machine on **every** call, not only when a fallback is reached. The `laya` route is the only one that keeps it local. Failure records carry the provider name and a canonical category only, never the state, candidate text, or an answer.

### Four defects found and fixed while testing

These are behavior changes, not only added tests.

- The provider chain filtered a route on the API token alone and ignored the account id, so a half-configured Clef was selected and failed on the first request instead of at load. Every chain member now passes through the same usability predicate, and for Clef that requires both values: the endpoint is per account and the account is not inferable from the token. A pinned `clef` route with no credential now refuses to construct rather than reporting an empty order, while `auto`, which only draws from providers it can authenticate, is the shape that collapses to no providers.
- A `probabilities` array was unreachable for a `score` answer. A guard returned `null` for any array before the branch that handled them ran, so every positional block was silently discarded and the score fell back to the index-derived value.
- A `choice` answer carrying no `probabilities` block was scored as a uniform `1/n` guess. Cloudflare documents `probabilities` as required on a choice answer, so a bare choice is now rejected rather than answered with an invented distribution.
- `clef` mode hardcoded a single-provider order, so a pinned Clef route could never use the fallback order it was configured with. Pinned `clef` now leads with Clef and keeps the usable members of `jev_fallback_order` behind it.

One pre-existing logging behavior was made explicit. A route that collapses to a single provider now logs nothing when that provider fails: with no successor there is no handover for the line to explain, and the thrown error already carries the same category to the caller.

Two test expectations were corrected rather than the code. A chain-wide cooldown rejection was wrong, because a cooldown applies to the provider that failed and the next call is supposed to take the fallback. A dry-run probe fixture answered under the raw anchor id, which no real provider would, since the request asks about the sanitized form.

### Verification

77 tests pass, up from 63. `pnpm run typecheck` passes for source and tests. No previously passing test was weakened to reach that number.

Clef is covered by unit tests with a synthetic transport plus a socket-capture check on the request shape. Those prove what is sent and how a response is read. **No live Clef call was made**: every Cloudflare credential available to this project returned HTTP 401 from Workers AI, and no account id is configured, so the wire contract comes from Cloudflare's published documentation rather than an observed response. Treat the first real Clef call as unverified.