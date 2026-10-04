## [1.0.0] - 2026-10-04 (first stable release)

First stable release. This supersedes the `1.0.0-rc.5` prerelease, which stays published for its history, and the earlier candidates whose notes remain in [RELEASE_NOTES_v1.0.0.md](RELEASE_NOTES_v1.0.0.md). Release candidates are retired for this repository: everything after this is a plain version.

### The four decision modes

Configuration now exposes exactly four modes, each naming which side leads and whether the other is a fallback:

| Mode | Leads | Fallback |
|---|---|---|
| `api_with_local_fallback` | hosted API | local model |
| `api_only` | hosted API | none |
| `local_only` | local model | none |
| `local_with_api_fallback` | local model | hosted API |

The mode no longer names which hosted provider, because that was the reason "hosted first with local fallback" had no name at all: `typesafe`, `openrouter`, and `clef` were each a mode, so none of them could carry a fallback. The new `api_provider` setting picks the hosted side: `typesafe`, `openrouter`, `clef`, or `auto` for the usable members of `jev_fallback_order` in order. So `api_only` with `api_provider: clef` is Clef alone, and `api_with_local_fallback` with `api_provider: clef` is Clef first with the local model behind it.

A pinned `api_provider` leads but does not exclude the rest of the configured order. `api_provider: clef` with `jev_fallback_order: [clef, typesafe]` gives `clef, typesafe`, so a handover still exists once Clef cools down. Pinning says which provider is preferred, not that the route has one hop.

### The category: System One decision models

This repository names the category it works in. These are **System One decision models**, also written "typed decision models", which is TypeSafe's own term for a model that returns typed values with a probability for each rather than prose: `Choice` picks one option from a list, `Score` places content on an ordered scale, and `Noul` answers yes or no with a number from 0 to 1. The reference is https://systemonemodels.org/guides/what-is-a-system-one-model/

Members named in these notes: **Jev** (hosted by TypeSafe or OpenRouter, closed weights), **Clef** and **Clef Flash** (hosted on Cloudflare Workers AI), and **Laya** (local, open weights, the default).

Jev is one vendor's member of the category, not the category's name, so these notes say "System One decision model" rather than naming the category after one vendor.

### Laya is now a slot, not a model

The local side is Laya or other pre-deterministic routing models: `local_model` selects which one answers. It is the checkpoint or engine name sent to the local server, and it is deliberately not an allowlist: it rejects only an empty value or one containing a character that would corrupt a URL path segment or a JSON string. A pre-deterministic routing model released tomorrow works by configuration, with no code change.

Engine names known to fit the same `/v1/systemone` contract are the Laya ones, `laya` (Convai Innovations), `laya-multilingual`, and `laya-typed-decisions`. A self-hosted engine server such as [chaitin/Decis](https://github.com/chaitin/Decis) publishes pre-deterministic routing models behind one Jev-compatible endpoint with one image per engine, where swapping `base_url` is the whole migration. Switching engines is a `local_model` and `laya_base_url` change.

`laya_model` is superseded and still read when `local_model` is left at its default, so an existing profile keeps working; `local_model` wins whenever it is set explicitly.

### Every earlier mode name still works

`auto`, `typesafe`, `openrouter`, `jev_api`, `clef_api`, `clef`, `clef_with_local_fallback`, `laya`, `laya_local`, `laya_then_hosted`, and `laya_with_jev_fallback` all resolve to one of the four, case-insensitively, and no alias string reaches a chain, a diagnostic, or a log.

Three of them carry a Clef pin the mode name used to imply: `clef`, `clef_api`, and `clef_with_local_fallback` set `api_provider: clef`, but only when `api_provider` is still `auto`, so an explicit choice always wins.

`auto` keeps its historical meaning rather than becoming a fifth mode. It selected among the keyed hosted providers and never picked the keyless local route on its own initiative, so it resolves to `api_only` and only becomes `api_with_local_fallback` when the profile has pointed the local slot at a real engine.

### Three defects this change fixed

- The default `laya_base_url` is loopback, a placeholder rather than a deployment decision. Treating it as "a local model is configured" silently added a local hop to every hosted-only profile. A local model now counts only when the profile points it somewhere else.
- A pinned `api_provider` collapsed the route to a single hop, so there was no provider to hand over to after a cooldown. Pinning now means "leads with".
- `clef_credentials_error` checked the account id before the token, so a credential with only a token reported the wrong missing variable. Each absent value now names itself.

### Load-time failure and degradation

A mode that promises a fallback but has no usable provider on the other side still fails at load, naming the missing variables. A pinned `api_provider` that cannot authenticate is also a load error, because naming it asserted something about the deployment. `api_with_local_fallback` with nothing usable on the hosted side collapses to the local model alone rather than failing, since a route that can still answer beats no route, and `auto` with nothing usable yields an empty order that reports `disabled` while host compaction continues.

### Privacy boundary, unchanged

This plugin ranks conversation content before a compaction pass. A hosted review, whether Jev or Clef, sends the reviewed state off the machine on **every** call, not only when a fallback is reached. Only the local modes keep it on the machine. Failure logs carry the provider name and a canonical category only, never the state, candidate text, answers, or a credential. No log line on the scoring path carries a request, a state, candidate text, or an answer, and this release adds no line that does.

### Verification

77 tests pass, up from 63, with none deleted and none weakened. Typecheck and build pass for source and tests.

No live provider call was made by this change. No local engine other than the default has ever been called from this repository, and no Cloudflare credential available here is authorized for Workers AI, so both the Clef wire contract and the interchangeable-engine list come from published documentation rather than an observed response. Treat the first real call to either as unverified.