# Model-alias chain editor

## Problem

Alias roles are configured only by editing `model-alias.json`. After a role exists, choosing its concrete failover targets should be a TUI selection, not a hand edit.

## Outcome

`/model-alias-chain [role]` opens a selector modeled on Pi's `/scoped-models` interaction. `Ctrl+S` replaces that role's concrete configured targets with the checked catalog models, keeps nested alias targets, and leaves every other map entry untouched. The running session keeps its loaded chain until `/reload`.

## Non-goals

- Creating, renaming, or deleting a role.
- Editing `timeouts`, `cooldown`, `$settings`, or `$defaults` in the TUI.
- RPC, JSON, or print UI. The command requires `ctx.mode === "tui"`.
- Importing `ScopedModelsSelectorComponent`. It is not a public package export, and its `null` value means "every catalog model", which an alias chain must not mean.
- Patching the in-memory flattened chain. Streaming reads the chain captured at extension load.

## Language

A **role** is a top-level map key that is not prefixed with `$`. A **configured target** is one entry in that role's raw value, before nested aliases are flattened. A **concrete target** is a configured target whose provider is not `alias`. A **nested alias target** is a configured target whose provider is `alias`, such as `alias/fallback`. The **flattened chain** is the runtime expansion and is not what this editor writes.

## Flow

The command is registered beside the existing alias commands. If the map fails to load or has no roles, the extension returns before registration, as it does today.

1. If the mode is not `tui`, notify and return.
2. Re-read the raw map. If it is missing, not a JSON object, or contains no roles, notify and return.
3. If the optional role argument is empty, `ctx.ui.select` the current role keys. Cancel returns. An unknown argument notifies and returns.
4. If `ctx.modelRegistry.getAll()` has no model whose provider is not `alias`, notify and return. Do not open the selector and do not write.
5. Open the chain selector through `ctx.ui.custom()`. Checked rows are the role's concrete configured targets that are present in that catalog, in configured order, with duplicates removed.
6. `Esc`, or `Ctrl+C` while search is empty, closes without writing. `Ctrl+C` with search text clears the search.
7. `Ctrl+S` merges and writes. The selector stays open. A refused or failed save stays dirty and does not write.

The selector uses the `KeybindingsManager` passed to `custom()` and displays hints with `keyText`. Bindings:

- `tui.select.up` and `tui.select.down` move the row, wrapping.
- `tui.select.confirm` toggles the selected catalog model.
- `app.models.enableAll` checks every catalog model, or only the filtered rows when search is non-empty. The result is an explicit list, never a sentinel for "all".
- `app.models.clearAll` unchecks the same scope.
- `app.models.toggleProvider` checks or unchecks every catalog model from the selected row's provider.
- `app.models.reorderUp` and `app.models.reorderDown` move a checked row within the checked order. An unchecked row does not move.
- Other input goes to the search field. Search uses `fuzzyFilter` over model id, provider, and name.

Checked models render first, in failover order, followed by unchecked catalog models in registry order. A row shows a cursor, a check mark when checked, the model id, and the provider. The selected row also shows the model name. The footer shows the key hints, the checked count, how many concrete configured targets will be dropped because they are absent from the catalog, and how many nested alias targets will be kept.

## Merge

`mergeChain(original, checked, catalog)` is a pure function.

- `original` is the role's configured targets in file order.
- `checked` is the explicit checked ids, deduped, first wins.
- `catalog` is the set of `provider/model` ids from the registry, excluding provider `alias`.

Each nested alias target is kept once, first configured occurrence wins. Its anchor is:

- the nearest preceding configured target that is in `catalog` and still checked, when one exists;
- the start of the chain, when no concrete target preceded it;
- the end of the chain, when a concrete target preceded it but none of those predecessors remain checked.

Unavailable concrete targets are not anchors and are dropped. Nested alias targets that share an anchor keep their configured relative order. Their global order may change when their anchors differ.

The saved chain is the start-anchored aliases, then each checked model followed by aliases anchored to it, then the end-anchored aliases.

Examples:

- `[A, alias/fallback, B]` with `A` and `B` still checked stays `[A, alias/fallback, B]`.
- `[A, alias/fallback, B]` with only `C` checked becomes `[C, alias/fallback]`.
- `[alias/fallback, A]` with `A` checked stays `[alias/fallback, A]`.
- `[missing/model, alias/fallback, A]` with `A` checked becomes `[A, alias/fallback]`, because the unavailable concrete predecessor was removed.
- `[A, alias/x, B, alias/y]` with only `B` checked becomes `[B, alias/y, alias/x]`.

A merge that produces no targets is refused. A catalog that was non-empty when the selector opened may still save a chain of only nested alias targets.

## File write

Read `MAP_PATH` again at save time. Abort without writing when the file is missing, not a JSON object, or no longer contains the role.

Replace only that role's targets:

- An object keeps `timeouts`, `cooldown`, and any other keys. Only `targets` changes.
- A string or array is replaced by the new chain.
- One resulting target is written as a string. More than one is written as an array. This applies both to a bare role value and to an object's `targets`.

Then `parseAliasConfig` must accept the new object. If it throws, do not write.

Write with `writeFileSync` to a temp file in the same directory, then `renameSync` over `MAP_PATH`. `JSON.stringify(value, null, 2)` plus a trailing newline rewrites formatting and preserves key insertion order. It does not preserve the previous indentation. On write or rename failure, notify and leave any existing map in place.

Do not update the loaded alias map, provider models, or status snapshot. Notify that `/reload` is required. Policy re-reads do not pick up a new target chain.

## Components

- `src/setup/chain-document.ts` reads a role's configured targets, decides the initial check list, merges, and builds the replacement role value. No TUI imports.
- `src/setup/chain-selector.ts` is the `ctx.ui.custom()` component. It owns draft check state and calls `onSave` or `onCancel`.
- `index.ts` registers the command and performs mode, catalog, file, and notification guards.
- `README.md` documents `/model-alias-chain [role]`.

## Errors

Every refusal uses `ctx.ui.notify` and does not write: non-TUI mode, cancelled role selection, unknown role, empty catalog, empty merged chain, unreadable or invalid map, role removed since open, parse rejection, or filesystem write failure. Duplicate checked ids keep the first.

## Testing

`__tests__/chain-document.test.ts` covers initial check order, alias reinsertion including the examples above, dropped unavailable targets, duplicate removal, empty-chain refusal, object policy preservation, string-versus-array shape, and untouched sibling keys.

`__tests__/chain-selector.test.ts` drives `handleInput` and `render` for toggle, reorder, search, enable-all, clear-all, provider toggle, save, cancel, and the dropped and kept counts.

`__tests__/index.test.ts` covers command registration only when the loaded map has a role, and the non-TUI guard.

`npm run check` must pass, including the 95% coverage gate.

## Workspace

This design is committed on `main` by explicit consent. Implementation stays on `main`.
