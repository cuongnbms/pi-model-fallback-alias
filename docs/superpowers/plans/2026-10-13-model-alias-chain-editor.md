# Model-alias chain editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a TUI command that replaces one existing alias role's concrete configured targets and preserves nested alias targets.

**Architecture:** Pure document functions merge and atomically rewrite the raw map. A local selector edits an explicit checked list. The command wires Pi's TUI to those functions and does not patch the loaded flattened chain.

**Tech Stack:** TypeScript, Node 22.19+ test runner, `@earendil-works/pi-coding-agent` 0.84.4, `@earendil-works/pi-tui` 0.85.1.

**Spec:** `docs/superpowers/specs/2026-10-13-model-alias-chain-editor-design.md`

## Global Constraints

- Implement on `main`. Do not create a branch or worktree.
- Do not import `ScopedModelsSelectorComponent` or any `dist/modes` path.
- Do not mutate the loaded `aliases` map, provider models, or status snapshot.
- Map path is `dependencies.mapPath ?? MAP_PATH`.
- Temp file is `${path}.${process.pid}.tmp` in the same directory. Write that file, then `renameSync` it over the map.
- Serialized map is `JSON.stringify(value, null, 2) + "\n"`.
- A one-target chain is a string. A longer chain is an array. This applies to a bare role value and to an object's `targets`.
- Object roles keep every key except the replaced `targets`.
- Checked ids are always an explicit `string[]`. Never use `null` to mean all models.
- Ignore checked ids whose provider is `alias` or that are absent from the catalog.
- Nested alias targets stay out of the selector. Preserve the first configured occurrence of each.
- Anchor a nested alias to the nearest preceding configured target that is in the catalog and still checked. If no concrete target preceded it, anchor it at the start. If a concrete target preceded it but none remain checked, anchor it at the end. Unavailable concrete targets are not anchors and are dropped. Aliases sharing an anchor keep configured order.
- Selector shows at most 8 rows. Checked models come first in checked order, then unchecked models in the supplied order.
- Footer fragment, before any unsaved marker, is `` `${hints("tui.select.confirm")} toggle · ${hints("app.models.enableAll")} all · ${hints("app.models.clearAll")} clear · ${hints("app.models.toggleProvider")} provider · ${hints("app.models.reorderUp")}/${hints("app.models.reorderDown")} reorder · ${hints("app.models.save")} save · ${checked.length}/${models.length} · drop ${droppedCount} · keep ${keptAliasCount}` ``. Append ` (unsaved)` only while dirty.
- Default hints are `keyText` from `@earendil-works/pi-coding-agent`. Tests inject hints.
- Refusal notifications use type `"warning"`. The save notification uses `"info"`.
- Exact messages: `/model-alias-chain requires TUI mode`; `No model aliases to edit`; `Model alias "${role}" is no longer in the map`; `No catalog models available`; `Refusing to save an empty alias chain`; `Could not read model-alias map: ${reason}`; `Refusing to save an invalid model-alias map: ${reason}`; `Could not save model-alias map: ${reason}`; `Saved ${role}. Run /reload to apply.`
- A non-object JSON root uses reason `expected a JSON object`.
- Command name is `model-alias-chain`. Description is `Edit one alias role's concrete fallback targets`.
- Completions use the loaded alias keys. The role list and save use a fresh file read.
- Provider `alias` is excluded from the catalog passed to the selector.
- Run a single test file with `node --import ./scripts/pi-resolve.mjs --test <path>`.

## Review Focus

- An unavailable concrete target immediately before a nested alias must move that alias to the end, not leave it first.
- A checked id absent from the catalog must not be written.
- Rewriting the map must preserve sibling roles and `$` keys.
- A failed rename must leave the original map bytes unchanged.
- A non-TUI invocation must not read or write the map.

---

### Task 1: Chain document

**Files:**
- Create: `src/setup/chain-document.ts`
- Test: `__tests__/chain-document.test.ts`

**Interfaces:**
- Consumes: `parseAliasConfig` from `src/fallback/index.ts`.
- Produces:
  - `configuredTargets(value: unknown): readonly string[]`
  - `initialChecked(targets: readonly string[], catalog: ReadonlySet<string>): string[]`
  - `droppedConcreteCount(targets: readonly string[], catalog: ReadonlySet<string>): number`
  - `keptAliasCount(targets: readonly string[]): number`
  - `mergeChain(original: readonly string[], checked: readonly string[], catalog: ReadonlySet<string>): string[]`
  - `saveRoleChain(options: { path: string; role: string; checked: readonly string[]; catalog: ReadonlySet<string>; fs?: { readFileSync(path: string, encoding: "utf8"): string; writeFileSync(path: string, data: string, encoding: "utf8"): void; renameSync(from: string, to: string): void } }): { ok: true } | { ok: false; message: string }`

- [ ] **Step 1: Write the failing test**

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import {
	configuredTargets,
	droppedConcreteCount,
	initialChecked,
	keptAliasCount,
	mergeChain,
	saveRoleChain,
} from "../src/setup/chain-document.ts";

const catalog = new Set(["provider/a", "provider/b", "provider/c"]);

test("reads configured targets and the initial explicit check list", () => {
	assert.deepEqual(configuredTargets("provider/a"), ["provider/a"]);
	assert.deepEqual(configuredTargets(["provider/a", "alias/fallback", "provider/a"]), ["provider/a", "alias/fallback", "provider/a"]);
	assert.deepEqual(configuredTargets({ targets: ["provider/b"], timeouts: { firstEventMs: 10 } }), ["provider/b"]);
	assert.deepEqual(configuredTargets({ timeouts: {} }), []);
	assert.deepEqual(initialChecked(["provider/a", "alias/fallback", "missing/model", "provider/a", "provider/b"], catalog), ["provider/a", "provider/b"]);
	assert.equal(droppedConcreteCount(["provider/a", "missing/model", "alias/fallback"], catalog), 1);
	assert.equal(keptAliasCount(["alias/fallback", "alias/fallback", "provider/a"]), 1);
});

test("reinserts nested aliases around the checked concrete order", () => {
	assert.deepEqual(mergeChain(["provider/a", "alias/fallback", "provider/b"], ["provider/a", "provider/b"], catalog), ["provider/a", "alias/fallback", "provider/b"]);
	assert.deepEqual(mergeChain(["provider/a", "alias/fallback", "provider/b"], ["provider/c"], catalog), ["provider/c", "alias/fallback"]);
	assert.deepEqual(mergeChain(["alias/fallback", "provider/a"], ["provider/a"], catalog), ["alias/fallback", "provider/a"]);
	assert.deepEqual(mergeChain(["missing/model", "alias/fallback", "provider/a"], ["provider/a"], catalog), ["provider/a", "alias/fallback"]);
	assert.deepEqual(mergeChain(["provider/a", "alias/x", "provider/b", "alias/y"], ["provider/b"], catalog), ["provider/b", "alias/y", "alias/x"]);
	assert.deepEqual(mergeChain(["provider/a", "alias/fallback"], ["missing/model", "alias/nope", "provider/a", "provider/a"], catalog), ["provider/a", "alias/fallback"]);
	assert.deepEqual(mergeChain(["alias/fallback"], [], catalog), ["alias/fallback"]);
	assert.deepEqual(mergeChain(["provider/a"], [], catalog), []);
});

test("rewrites one role and preserves the rest of the map", () => {
	const files = new Map<string, string>([[
		"/map.json",
		JSON.stringify({ $comment: "keep", coder: ["provider/a", "alias/fallback"], reviewer: "provider/b" }),
	]]);
	const fs = memoryFs(files);
	const saved = saveRoleChain({ path: "/map.json", role: "coder", checked: ["provider/c", "provider/a"], catalog, fs });
	assert.deepEqual(saved, { ok: true });
	assert.deepEqual(JSON.parse(files.get("/map.json")!), {
		$comment: "keep",
		coder: ["provider/c", "provider/a", "alias/fallback"],
		reviewer: "provider/b",
	});
	assert.equal(files.get("/map.json")!.endsWith("\n"), true);
});

test("preserves object policy and uses a string for one target", () => {
	const files = new Map<string, string>([[
		"/map.json",
		JSON.stringify({ coder: { targets: ["provider/a", "provider/b"], timeouts: { firstEventMs: 15 }, cooldown: { baseMs: 5 } } }),
	]]);
	const saved = saveRoleChain({
		path: "/map.json",
		role: "coder",
		checked: ["provider/b"],
		catalog,
		fs: memoryFs(files),
	});
	assert.deepEqual(saved, { ok: true });
	assert.deepEqual(JSON.parse(files.get("/map.json")!), {
		coder: { targets: "provider/b", timeouts: { firstEventMs: 15 }, cooldown: { baseMs: 5 } },
	});
});

test("refuses an empty chain and a missing role without writing", () => {
	const original = JSON.stringify({ coder: "provider/a" });
	const files = new Map([["/map.json", original]]);
	const fs = memoryFs(files);
	assert.deepEqual(saveRoleChain({ path: "/map.json", role: "coder", checked: [], catalog, fs }), {
		ok: false,
		message: "Refusing to save an empty alias chain",
	});
	assert.deepEqual(saveRoleChain({ path: "/map.json", role: "missing", checked: ["provider/a"], catalog, fs }), {
		ok: false,
		message: 'Model alias "missing" is no longer in the map',
	});
	assert.equal(files.get("/map.json"), original);
	assert.equal([...files.keys()].some((path) => path.endsWith(".tmp")), false);
});

test("writes a bare one-target role as a string", () => {
	const files = new Map([["/map.json", JSON.stringify({ coder: "provider/a" })]]);
	saveRoleChain({ path: "/map.json", role: "coder", checked: ["provider/b"], catalog, fs: memoryFs(files) });
	assert.equal(JSON.parse(files.get("/map.json")!).coder, "provider/b");
});

test("refuses an unreadable, non-object, or invalid map and a failed rename", () => {
	const fs = memoryFs(new Map());
	assert.deepEqual(saveRoleChain({ path: "/missing.json", role: "coder", checked: ["provider/a"], catalog, fs }), {
		ok: false,
		message: "Could not read model-alias map: ENOENT",
	});
	const notObject = memoryFs(new Map([["/map.json", "[]"]]));
	assert.deepEqual(saveRoleChain({ path: "/map.json", role: "coder", checked: ["provider/a"], catalog, fs: notObject }), {
		ok: false,
		message: "Could not read model-alias map: expected a JSON object",
	});
	const invalid = memoryFs(new Map([["/map.json", JSON.stringify({ coder: { targets: "provider/a", extra: true } })]]));
	const rejected = saveRoleChain({ path: "/map.json", role: "coder", checked: ["provider/a"], catalog, fs: invalid });
	assert.equal(rejected.ok, false);
	if (!rejected.ok) assert.match(rejected.message, /^Refusing to save an invalid model-alias map: /);
	const original = JSON.stringify({ coder: "provider/a" });
	const failing = memoryFs(new Map([["/map.json", original]]));
	failing.renameSync = () => { throw new Error("busy"); };
	assert.deepEqual(saveRoleChain({ path: "/map.json", role: "coder", checked: ["provider/b"], catalog, fs: failing }), {
		ok: false,
		message: "Could not save model-alias map: busy",
	});
	assert.equal(failing.files.get("/map.json"), original);
});

function memoryFs(files: Map<string, string>) {
	return {
		files,
		readFileSync(path: string) {
			const value = files.get(path);
			if (value === undefined) throw new Error("ENOENT");
			return value;
		},
		writeFileSync(path: string, data: string) { files.set(path, data); },
		renameSync(from: string, to: string) {
			const value = files.get(from);
			if (value === undefined) throw new Error("ENOENT");
			files.set(to, value);
			files.delete(from);
		},
	};
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --import ./scripts/pi-resolve.mjs --test __tests__/chain-document.test.ts`

Expected: FAIL because `src/setup/chain-document.ts` does not exist.

- [ ] **Step 3: Implement the document functions**

Create `src/setup/chain-document.ts` with the produced signatures. Use `isModelRef` and `splitModelRef` from `src/fallback/refs.ts` for target classification. A nested alias has provider `alias`. `saveRoleChain` re-reads the file, merges, runs `parseAliasConfig` on the updated object, and only then writes the temp file and renames it. On write or rename failure, do not replace an existing map.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --import ./scripts/pi-resolve.mjs --test __tests__/chain-document.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/setup/chain-document.ts __tests__/chain-document.test.ts
git commit -m "feat: merge configured alias targets"
```

### Task 2: Chain selector

**Files:**
- Create: `src/setup/chain-selector.ts`
- Test: `__tests__/chain-selector.test.ts`

**Interfaces:**
- Consumes: `KeybindingsManager` from `@earendil-works/pi-coding-agent`, `fuzzyFilter` and `Input` from `@earendil-works/pi-tui`, and `Key` plus `matchesKey` from `@earendil-works/pi-tui`.
- Produces:
  - `createChainSelector(options: { role: string; models: readonly { provider: string; id: string; name: string }[]; checked: readonly string[]; droppedCount: number; keptAliasCount: number; keybindings: KeybindingsManager; theme: { fg(token: string, text: string): string; bold(text: string): string }; tui: { requestRender(): void }; hints?: (id: string) => string; onSave: (checked: readonly string[]) => boolean; onCancel: () => void }): Component & { focused: boolean; handleInput(data: string): void }`

- [ ] **Step 1: Write the failing test**

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { createChainSelector } from "../src/setup/chain-selector.ts";

const models = [
	{ provider: "provider", id: "a", name: "Alpha" },
	{ provider: "provider", id: "b", name: "Beta" },
	{ provider: "other", id: "c", name: "Gamma" },
];

test("toggles, reorders, filters, and saves an explicit list", () => {
	const saved: string[][] = [];
	let renders = 0;
	const selector = createChainSelector({
		role: "coder",
		models,
		checked: ["provider/a"],
		droppedCount: 2,
		keptAliasCount: 1,
		keybindings: bindings(),
		theme: { fg: (_token, text) => text, bold: (text) => text },
		tui: { requestRender: () => { renders += 1; } },
		hints: (id) => id,
		onSave: (checked) => { saved.push([...checked]); return true; },
		onCancel: () => {},
	});
	const initial = selector.render(80).join("\n");
	assert.match(initial, /Model alias: coder/);
	assert.match(initial, /→ ✓ provider\/a \[provider\]/);
	assert.match(initial, /Model Name: Alpha/);
	assert.match(initial, /1\/3 · drop 2 · keep 1/);
	assert.doesNotMatch(initial, /unsaved/);

	selector.handleInput("down");
	selector.handleInput("enter");
	assert.match(selector.render(80).join("\n"), /2\/3 · drop 2 · keep 1 \(unsaved\)/);
	selector.handleInput("up-order");
	selector.handleInput("save");
	assert.deepEqual(saved, [["provider/b", "provider/a"]]);
	assert.doesNotMatch(selector.render(80).join("\n"), /unsaved/);
	assert.equal(renders > 0, true);

	selector.handleInput("g");
	selector.handleInput("all");
	selector.handleInput("save");
	assert.deepEqual(saved.at(-1), ["provider/b", "provider/a", "other/c"]);
	selector.handleInput("clear");
	selector.handleInput("save");
	assert.deepEqual(saved.at(-1), ["provider/b", "provider/a"]);
});

test("toggles the selected provider and cancels from escape or ctrl-c", () => {
	const cancels: string[] = [];
	const selector = createChainSelector({
		role: "coder",
		models,
		checked: [],
		droppedCount: 0,
		keptAliasCount: 0,
		keybindings: bindings(),
		theme: { fg: (_token, text) => text, bold: (text) => text },
		tui: { requestRender() {} },
		hints: (id) => id,
		onSave: () => false,
		onCancel: () => cancels.push("cancel"),
	});
	selector.focused = true;
	selector.handleInput("provider");
	selector.handleInput("save");
	assert.match(selector.render(80).join("\n"), /unsaved/);
	selector.handleInput("nope");
	selector.handleInput("\x03");
	assert.deepEqual(cancels, []);
	selector.handleInput("\x03");
	selector.handleInput("\x1b");
	selector.handleInput("cancel");
	assert.deepEqual(cancels, ["cancel", "cancel", "cancel"]);
	assert.match(selector.render(80).join("\n"), /✓ provider\/a \[provider\]/);
	assert.match(selector.render(80).join("\n"), /✓ provider\/b \[provider\]/);
	assert.doesNotMatch(selector.render(80).join("\n"), /✓ other\/c/);
});

test("enables and clears the full list and ignores alias-provider rows", () => {
	const saved: string[][] = [];
	const selector = createChainSelector({
		role: "coder",
		models: [...models, { provider: "alias", id: "fallback", name: "Fallback" }],
		checked: ["provider/a"],
		droppedCount: 0,
		keptAliasCount: 0,
		keybindings: bindings(),
		theme: { fg: (_token, text) => text, bold: (text) => text },
		tui: { requestRender() {} },
		hints: (id) => id,
		onSave: (checked) => { saved.push([...checked]); return true; },
		onCancel: () => {},
	});
	selector.handleInput("up-order");
	selector.handleInput("all");
	selector.handleInput("save");
	assert.deepEqual(saved[0], ["provider/a", "provider/b", "other/c"]);
	selector.handleInput("clear");
	selector.handleInput("save");
	assert.deepEqual(saved[1], []);
	assert.doesNotMatch(selector.render(80).join("\n"), /fallback/);
});

function bindings(): KeybindingsManager {
	const byData = new Map([
		["up", "tui.select.up"],
		["down", "tui.select.down"],
		["enter", "tui.select.confirm"],
		["all", "app.models.enableAll"],
		["clear", "app.models.clearAll"],
		["provider", "app.models.toggleProvider"],
		["up-order", "app.models.reorderUp"],
		["down-order", "app.models.reorderDown"],
		["save", "app.models.save"],
		["cancel", "tui.select.cancel"],
	]);
	return { matches: (data: string, id: string) => byData.get(data) === id } as KeybindingsManager;
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --import ./scripts/pi-resolve.mjs --test __tests__/chain-selector.test.ts`

Expected: FAIL because `src/setup/chain-selector.ts` does not exist.

- [ ] **Step 3: Implement `createChainSelector`**

Search with `fuzzyFilter` over `${model.id} ${model.provider} ${model.name}`. `app.models.enableAll` and `app.models.clearAll` affect the filtered ids when search is non-empty, otherwise all models. `app.models.toggleProvider` uses the selected row's provider across all models, not just the filter. Reorder swaps within the checked list and keeps selection on that same model id. `Ctrl+C` (`matchesKey(data, Key.ctrl("c"))`) clears non-empty search; otherwise it cancels. Escape and `tui.select.cancel` cancel. A false `onSave` leaves the selector dirty. `focused` propagates to the search `Input`. Call `tui.requestRender()` after handling input. Ignore models whose provider is `alias`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `node --import ./scripts/pi-resolve.mjs --test __tests__/chain-selector.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/setup/chain-selector.ts __tests__/chain-selector.test.ts
git commit -m "feat: add alias chain selector"
```

### Task 3: Command wiring

**Files:**
- Modify: `index.ts`
- Modify: `README.md`
- Test: `__tests__/index.test.ts`

**Interfaces:**
- Consumes: `saveRoleChain`, `configuredTargets`, `initialChecked`, `droppedConcreteCount`, and `keptAliasCount` from `src/setup/chain-document.ts`; `createChainSelector` from `src/setup/chain-selector.ts`; `MAP_PATH` from `src/alias-config.ts`.
- Produces: optional `mapPath?: string` on `PiModelAliasDependencies`, and command `model-alias-chain`.

- [ ] **Step 1: Write the failing test**

Add this test to `__tests__/index.test.ts`. Extend the local `pi` mock used here so `registerCommand` stores the real `(args: string, ctx: unknown) => Promise<void>` handler. Do not change the existing registration test's assertions.

```typescript
test("edits a role from the TUI and refuses non-TUI before reading", async () => {
	const notifications: Array<{ message: string; type?: string }> = [];
	const reads: string[] = [];
	let selects = 0;
	let customs = 0;
	const files = new Map<string, string>([[
		"/map.json",
		JSON.stringify({ $comment: "keep", coder: ["provider/a", "alias/fallback"], reviewer: "other/z" }),
	]]);
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }>();
	installPiModelAlias({
		registerProvider() {},
		registerEntryRenderer() {},
		on() {},
		registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }) {
			commands.set(name, command);
		},
	} as never, {
		aliasConfig: parseAliasConfig({ coder: "provider/a" }),
		debugLog: { log() {} },
		cooldowns: cooldowns(),
		mapPath: "/map.json",
		readAliasMap: (path: string) => {
			reads.push(path);
			const value = files.get(path);
			if (value === undefined) throw new Error("ENOENT");
			return value;
		},
		writeAliasMap: (path: string, data: string) => files.set(path, data),
		renameAliasMap: (from: string, to: string) => {
			files.set(to, files.get(from)!);
			files.delete(from);
		},
	});

	const ctx = {
		mode: "tui",
		ui: {
			notify: (message: string, type?: string) => notifications.push({ message, type }),
			select: async () => { selects += 1; return undefined; },
			custom: async (factory: (tui: unknown, theme: unknown, kb: unknown, done: (result: unknown) => void) => { handleInput(data: string): void }) => {
				customs += 1;
				const component = factory({}, { fg: (_token: string, text: string) => text, bold: (text: string) => text }, bindings(), () => {});
				component.handleInput("save");
			},
		},
		modelRegistry: {
			getAll: () => [
				{ provider: "alias", id: "coder", name: "Coder" },
				{ provider: "provider", id: "a", name: "Alpha" },
				{ provider: "provider", id: "b", name: "Beta" },
			],
		},
	};
	assert.deepEqual(commands.get("model-alias-chain")?.getArgumentCompletions?.("co"), [{ value: "coder", label: "coder" }]);
	await commands.get("model-alias-chain")?.handler("", { ...ctx, mode: "print" });
	assert.deepEqual(notifications, [{ message: "/model-alias-chain requires TUI mode", type: "warning" }]);
	assert.deepEqual(reads, []);

	notifications.length = 0;
	await commands.get("model-alias-chain")?.handler("", ctx);
	assert.equal(selects, 1);
	assert.equal(customs, 0);
	assert.deepEqual(notifications, []);

	notifications.length = 0;
	await commands.get("model-alias-chain")?.handler("missing", ctx);
	assert.equal(notifications[0]?.message, 'Model alias "missing" is no longer in the map');

	notifications.length = 0;
	await commands.get("model-alias-chain")?.handler("coder", { ...ctx, modelRegistry: { getAll: () => [{ provider: "alias", id: "coder", name: "Coder" }] } });
	assert.deepEqual(notifications, [{ message: "No catalog models available", type: "warning" }]);
	assert.equal(customs, 0);

	files.set("/map.json", JSON.stringify({ $comment: "keep" }));
	notifications.length = 0;
	await commands.get("model-alias-chain")?.handler("coder", ctx);
	assert.deepEqual(notifications, [{ message: "No model aliases to edit", type: "warning" }]);

	files.set("/map.json", JSON.stringify({ $comment: "keep", coder: ["provider/a", "alias/fallback"], reviewer: "other/z" }));
	notifications.length = 0;
	await commands.get("model-alias-chain")?.handler("coder", ctx);
	assert.equal(selects, 1);
	assert.deepEqual(JSON.parse(files.get("/map.json")!), {
		$comment: "keep",
		coder: ["provider/a", "alias/fallback"],
		reviewer: "other/z",
	});
	assert.deepEqual(notifications, [{ message: "Saved coder. Run /reload to apply.", type: "info" }]);
});

function bindings(): import("@earendil-works/pi-coding-agent").KeybindingsManager {
	return { matches: (data: string, id: string) => data === "save" && id === "app.models.save" } as import("@earendil-works/pi-coding-agent").KeybindingsManager;
}
```

`cooldowns()` is the helper already in `__tests__/index.test.ts`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --import ./scripts/pi-resolve.mjs --test __tests__/index.test.ts`

Expected: FAIL because `model-alias-chain` is not registered or `mapPath` is not accepted.

- [ ] **Step 3: Register the command and document it**

Add optional `mapPath`, `readAliasMap`, `writeAliasMap`, and `renameAliasMap` to `PiModelAliasDependencies`. Register `model-alias-chain` next to the other alias commands, with role completions from the loaded keys. The handler returns before any read when `ctx.mode !== "tui"`. It re-reads the map, selects a role when the argument is empty, and returns on cancel. It builds the catalog from `ctx.modelRegistry.getAll()` excluding provider `alias`. An empty catalog notifies and does not open the selector. Otherwise it opens `createChainSelector`; `onSave` calls `saveRoleChain` with the injected filesystem and notifies using the returned message. `onCancel` finishes the custom UI.

In `README.md`, immediately after the `/model-alias-latency-report` bullet, add:

```markdown
- `/model-alias-chain [role]` edits one role's concrete fallback targets. Nested alias targets are kept. Run `/reload` after saving.
```

- [ ] **Step 4: Run the full check**

Run: `npm run check`

Expected: PASS, including the 95% coverage gate, typecheck, and package check.

- [ ] **Step 5: Commit**

```bash
git add index.ts README.md __tests__/index.test.ts
git commit -m "feat: add model-alias-chain command"
```
