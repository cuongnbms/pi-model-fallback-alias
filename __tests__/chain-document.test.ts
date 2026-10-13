import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	assert.deepEqual(configuredTargets(["provider/a", 7]), ["provider/a"]);
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

test("keeps configured order for aliases that share an anchor", () => {
	assert.deepEqual(
		mergeChain(["provider/a", "alias/x", "alias/y", "provider/b"], ["provider/a", "provider/b"], catalog),
		["provider/a", "alias/x", "alias/y", "provider/b"],
	);
	assert.deepEqual(mergeChain(["provider/a", "alias/x", "provider/b", "alias/y"], [], catalog), ["alias/x", "alias/y"]);
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

test("writes through the default filesystem with a same-directory temp file", () => {
	const directory = mkdtempSync(join(tmpdir(), "chain-document-"));
	try {
		const path = join(directory, "model-alias.json");
		writeFileSync(path, JSON.stringify({ coder: "provider/a" }), "utf8");
		assert.deepEqual(saveRoleChain({ path, role: "coder", checked: ["provider/b"], catalog }), { ok: true });
		assert.equal(readFileSync(path, "utf8"), `${JSON.stringify({ coder: "provider/b" }, null, 2)}\n`);
		assert.deepEqual(readdirSync(directory), ["model-alias.json"]);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
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
