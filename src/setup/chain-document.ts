import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { describeFailure, parseAliasConfig } from "../fallback/index.ts";
import { isModelRef, isRecord, splitModelRef } from "../fallback/refs.ts";

interface ChainDocumentFs {
	readFileSync(path: string, encoding: "utf8"): string;
	writeFileSync(path: string, data: string, encoding: "utf8"): void;
	renameSync(from: string, to: string): void;
}

const defaultFs: ChainDocumentFs = { readFileSync, renameSync, writeFileSync };

/** A role's configured targets in file order, before nested aliases are flattened. */
export function configuredTargets(value: unknown): readonly string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((target): target is string => typeof target === "string");
	if (isRecord(value)) return configuredTargets(value.targets);
	return [];
}

/** Concrete configured targets present in the catalog, in configured order, deduped. */
export function initialChecked(targets: readonly string[], catalog: ReadonlySet<string>): string[] {
	const checked: string[] = [];
	const seen = new Set<string>();
	for (const target of targets) {
		if (seen.has(target) || !catalog.has(target)) continue;
		seen.add(target);
		checked.push(target);
	}
	return checked;
}

/** Distinct concrete configured targets that the merge drops because they are absent from the catalog. */
export function droppedConcreteCount(targets: readonly string[], catalog: ReadonlySet<string>): number {
	const dropped = new Set<string>();
	for (const target of targets) {
		if (isAliasTarget(target) || catalog.has(target)) continue;
		dropped.add(target);
	}
	return dropped.size;
}

/** Distinct nested alias targets the merge keeps, first configured occurrence wins. */
export function keptAliasCount(targets: readonly string[]): number {
	const kept = new Set<string>();
	for (const target of targets) {
		if (isAliasTarget(target)) kept.add(target);
	}
	return kept.size;
}

/**
 * Merge the explicitly checked catalog models with the nested aliases configured on a role.
 * Checked models lead in checked order; each kept alias follows its nearest preceding kept
 * anchor, or is start- or end-anchored when no anchor remains.
 */
export function mergeChain(
	original: readonly string[],
	checked: readonly string[],
	catalog: ReadonlySet<string>,
): string[] {
	const selected: string[] = [];
	const selectedSet = new Set<string>();
	for (const target of checked) {
		if (selectedSet.has(target) || isAliasTarget(target) || !catalog.has(target)) continue;
		selectedSet.add(target);
		selected.push(target);
	}

	const selectedIndex = new Map<string, number>();
	selected.forEach((target, index) => selectedIndex.set(target, index));
	const aliasesAfterAnchor: string[][] = selected.map(() => []);
	const leadingAliases: string[] = [];
	const trailingAliases: string[] = [];
	const keptAliases = new Set<string>();

	for (let index = 0; index < original.length; index++) {
		const target = original[index];
		if (!isAliasTarget(target) || keptAliases.has(target)) continue;
		keptAliases.add(target);
		const preceding = original.slice(0, index);
		const anchor = findCheckedAnchor(preceding, selectedSet);
		if (anchor !== undefined) {
			aliasesAfterAnchor[selectedIndex.get(anchor)!].push(target);
		} else if (preceding.some(isConcreteTarget)) {
			trailingAliases.push(target);
		} else {
			leadingAliases.push(target);
		}
	}

	const merged = [...leadingAliases];
	selected.forEach((target, index) => {
		merged.push(target, ...aliasesAfterAnchor[index]);
	});
	return merged.concat(trailingAliases);
}

/**
 * Atomically replace one role's targets in the map file. The role's other keys, the
 * remaining roles, and `$` metadata keys are preserved. Nothing is written when the
 * file, the role, the merged chain, or the parsed map is invalid.
 */
export function saveRoleChain(options: {
	path: string;
	role: string;
	checked: readonly string[];
	catalog: ReadonlySet<string>;
	fs?: ChainDocumentFs;
}): { ok: true } | { ok: false; message: string } {
	const { path, role, checked, catalog } = options;
	const fs: ChainDocumentFs = { ...defaultFs, ...options.fs };

	let root: unknown;
	try {
		root = JSON.parse(fs.readFileSync(path, "utf8")) as unknown;
		if (!isRecord(root)) throw new Error("expected a JSON object");
	} catch (error) {
		return { ok: false, message: `Could not read model-alias map: ${describeFailure(error)}` };
	}

	if (!Object.prototype.hasOwnProperty.call(root, role)) {
		return { ok: false, message: `Model alias "${role}" is no longer in the map` };
	}

	const targets = mergeChain(configuredTargets(root[role]), checked, catalog);
	if (targets.length === 0) return { ok: false, message: "Refusing to save an empty alias chain" };

	const current = root[role];
	const chain = targets.length === 1 ? targets[0] : targets;
	const value = isRecord(current) ? { ...current, targets: chain } : chain;
	const updated = { ...root, [role]: value };
	try {
		parseAliasConfig(updated);
	} catch (error) {
		return { ok: false, message: `Refusing to save an invalid model-alias map: ${describeFailure(error)}` };
	}

	const tempPath = `${path}.${process.pid}.tmp`;
	try {
		fs.writeFileSync(tempPath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
		fs.renameSync(tempPath, path);
	} catch (error) {
		return { ok: false, message: `Could not save model-alias map: ${describeFailure(error)}` };
	}
	return { ok: true };
}

function isAliasTarget(target: string): boolean {
	return isModelRef(target) && splitModelRef(target)[0] === "alias";
}

function isConcreteTarget(target: string): boolean {
	return !isAliasTarget(target);
}

/** The nearest preceding concrete target that is still checked and present in the catalog. */
function findCheckedAnchor(preceding: readonly string[], selected: ReadonlySet<string>): string | undefined {
	for (let index = preceding.length - 1; index >= 0; index--) {
		const candidate = preceding[index];
		if (!isAliasTarget(candidate) && selected.has(candidate)) return candidate;
	}
	return undefined;
}
