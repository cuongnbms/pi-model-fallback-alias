import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Model, Provider } from "@earendil-works/pi-ai";
import { installPiModelAlias } from "../index.ts";
import { parseAliasConfig } from "../src/fallback/index.ts";
import { ALIAS_TARGETS_ENTRY, LATENCY_REPORT_ENTRY, RESET_ENTRY } from "../src/status/transcript.ts";

test("registers aliases and handles commands through the extension API", async () => {
	const commands = new Map<string, { handler: (args?: string) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }>();
	const listeners = new Map<string, (...args: never[]) => unknown>();
	const entries: Array<{ type: string; data: unknown }> = [];
	const target = targetModel();
	const provider = targetProvider();
	const registry = {
		find(providerId: string, modelId: string) {
			return providerId === "provider" && modelId === "target" ? target : undefined;
		},
		getProvider(providerId: string) {
			return providerId === "provider" ? provider : undefined;
		},
	};
	const pi = {
		appendEntry(type: string, data: unknown) { entries.push({ type, data }); },
		registerEntryRenderer() {},
		registerProvider() {},
		on(event: string, handler: (...args: never[]) => unknown) { listeners.set(event, handler); },
		registerCommand(name: string, command: { handler: (args?: string) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }) { commands.set(name, command); },
	};

	installPiModelAlias(pi as never, {
		aliasConfig: parseAliasConfig({ coder: "provider/target" }),
		debugLog: { log() {} },
		cooldowns: cooldowns(),
	});

	assert.deepEqual(commands.get("model-alias-targets")?.getArgumentCompletions?.("co"), [{ value: "coder", label: "coder" }]);
	await listeners.get("session_start")?.({} as never, { model: { id: "coder", provider: "alias" }, modelRegistry: registry, hasUI: false } as never);
	await commands.get("model-alias-targets")?.handler("coder");
	await commands.get("model-alias-latency-report")?.handler("");
	await commands.get("model-alias-reset-cooldown")?.handler();

	assert.deepEqual(entries.map((entry) => entry.type), [ALIAS_TARGETS_ENTRY, LATENCY_REPORT_ENTRY, RESET_ENTRY]);
});

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
	assert.equal(notifications.length, 0);

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

test("refuses an unreadable map, an invalid root, an empty chain, and cancel", async () => {
	const notifications: Array<{ message: string; type?: string }> = [];
	const files = new Map<string, string>();
	const { pi, commands } = chainPi();
	installPiModelAlias(pi as never, {
		aliasConfig: parseAliasConfig({ coder: "provider/a" }),
		debugLog: { log() {} },
		cooldowns: cooldowns(),
		mapPath: "/map.json",
		readAliasMap: (path: string) => {
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
	let selects = 0;
	let input = "save";
	const ctx = {
		mode: "tui",
		ui: {
			notify: (message: string, type?: string) => notifications.push({ message, type }),
			select: async () => { selects += 1; return "coder"; },
			custom: async (factory: (tui: unknown, theme: unknown, kb: unknown, done: (result: unknown) => void) => { handleInput(data: string): void }) => {
				const component = factory({ requestRender() {} }, { fg: (_token: string, text: string) => text, bold: (text: string) => text }, bindings(), () => {});
				component.handleInput(input);
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
	const run = async (args: string) => {
		notifications.length = 0;
		await commands.get("model-alias-chain")?.handler(args, ctx);
	};

	await run("coder");
	assert.deepEqual(notifications, [{ message: "Could not read model-alias map: ENOENT", type: "warning" }]);

	files.set("/map.json", "[]");
	await run("coder");
	assert.deepEqual(notifications, [{ message: "Could not read model-alias map: expected a JSON object", type: "warning" }]);

	files.set("/map.json", JSON.stringify({ $comment: "keep", coder: [] }));
	await run("coder");
	assert.deepEqual(notifications, [{ message: "Refusing to save an empty alias chain", type: "warning" }]);

	files.set("/map.json", JSON.stringify({ $comment: "keep", coder: ["provider/a", "alias/fallback"] }));
	input = "\x1b";
	await run("");
	assert.equal(selects, 1);
	assert.deepEqual(notifications, []);
	assert.deepEqual(JSON.parse(files.get("/map.json")!), { $comment: "keep", coder: ["provider/a", "alias/fallback"] });
});

test("saves through the default map filesystem", async () => {
	const directory = mkdtempSync(join(tmpdir(), "pi-model-alias-chain-"));
	const path = join(directory, "model-alias.json");
	writeFileSync(path, `${JSON.stringify({ $comment: "keep", coder: ["provider/a", "alias/fallback"] }, null, 2)}\n`, "utf8");
	try {
		const notifications: Array<{ message: string; type?: string }> = [];
		const { pi, commands } = chainPi();
		installPiModelAlias(pi as never, {
			aliasConfig: parseAliasConfig({ coder: "provider/a" }),
			debugLog: { log() {} },
			cooldowns: cooldowns(),
			mapPath: path,
		});
		const ctx = {
			mode: "tui",
			ui: {
				notify: (message: string, type?: string) => notifications.push({ message, type }),
				select: async () => undefined,
				custom: async (factory: (tui: unknown, theme: unknown, kb: unknown, done: (result: unknown) => void) => { handleInput(data: string): void }) => {
					const component = factory({ requestRender() {} }, { fg: (_token: string, text: string) => text, bold: (text: string) => text }, bindings(), () => {});
					component.handleInput("save");
				},
			},
			modelRegistry: {
				getAll: () => [
					{ provider: "provider", id: "a", name: "Alpha" },
					{ provider: "provider", id: "b", name: "Beta" },
				],
			},
		};
		await commands.get("model-alias-chain")?.handler("coder", ctx);
		assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { $comment: "keep", coder: ["provider/a", "alias/fallback"] });
		assert.deepEqual(notifications, [{ message: "Saved coder. Run /reload to apply.", type: "info" }]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

function chainPi() {
	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }>();
	const pi = {
		registerProvider() {},
		registerEntryRenderer() {},
		on() {},
		registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => Promise<void>; getArgumentCompletions?: (prefix: string) => unknown }) {
			commands.set(name, command);
		},
	};
	return { pi, commands };
}

function targetModel(): Model<"test"> {
	return {
		id: "target", name: "Target", api: "test", provider: "provider", baseUrl: "https://target.invalid",
		reasoning: false, input: ["text"], cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
		contextWindow: 100, maxTokens: 20,
	};
}

function targetProvider(): Provider {
	return {
		id: "provider",
		name: "Provider",
		stream() { return { async *[Symbol.asyncIterator]() { yield { type: "done" }; } }; },
		streamSimple() { return { async *[Symbol.asyncIterator]() { yield { type: "done" }; } }; },
	} as unknown as Provider;
}

function bindings(): import("@earendil-works/pi-coding-agent").KeybindingsManager {
	return { matches: (data: string, id: string) => data === "save" && id === "app.models.save" } as import("@earendil-works/pi-coding-agent").KeybindingsManager;
}

function cooldowns() {
	return {
		clearAll: () => 0,
		state: () => undefined,
		isActive: () => false,
		recordFailure: () => ({ failCount: 1, nextRetryAt: 0, durationMs: 0 }),
		recordSuccess() {},
		resetSuccesses() {},
	};
}
