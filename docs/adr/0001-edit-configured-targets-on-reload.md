# 0001: Edit configured alias targets locally, accepting that /reload applies them

> Status: Accepted · Date: 2026-10-13

## Context

The chain editor must change one role's failover order without adopting Pi's scoped-model meaning, where an empty selection sentinel enables every catalog model. The running extension also captures the flattened chain at load; only timeout and cooldown policy are re-read per stream.

Source: [design spec](../superpowers/specs/2026-10-13-model-alias-chain-editor-design.md)

## Decision

The editor writes the role's configured targets in the raw map and tells the user to `/reload`. It does not import Pi's scoped-model selector and does not patch the loaded chain.

A local selector can keep an explicit target list and preserve nested alias targets, which the scoped-model component and the flattened runtime map cannot do.

## Consequences

A saved chain does not affect a session that is already open. That delay is expected, not a failed write. Formatting of the whole map is normalized to two-space JSON on save.

## Alternatives considered

| Alternative | Why not chosen |
|-------------|----------------|
| Embed `ScopedModelsSelectorComponent` | Not a public export, and its all-enabled sentinel would persist every catalog model. |
| Mutate the loaded flattened chain | Drops the distinction between configured targets and expanded targets, so a later reload could not round-trip nested alias targets. |
