# Model alias

A Pi extension that exposes stable `alias/<role>` models backed by ordered provider fallback chains.

## Language

**Role**:
A top-level map key, other than a `$` metadata key, that registers `alias/<role>`.
_Avoid_: alias name, profile

**Configured target**:
One `provider/model` entry stored for a role before nested aliases are expanded.
_Avoid_: fallback entry, raw model

**Concrete target**:
A configured target whose provider is not `alias`.
_Avoid_: real model, direct target

**Nested alias target**:
A configured target whose provider is `alias`, such as `alias/fallback`.
_Avoid_: scoped model, alias link

**Flattened chain**:
The ordered concrete targets a role uses at runtime after nested aliases are expanded.
_Avoid_: fallback list, scoped models
