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
