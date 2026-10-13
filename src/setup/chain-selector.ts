import { keyText, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { fuzzyFilter, Input, Key, matchesKey, type Component } from "@earendil-works/pi-tui";

/** A catalog model offered to the selector, already keyed by `provider/model` at use. */
interface CatalogModel {
	provider: string;
	id: string;
	name: string;
}

export interface ChainSelectorOptions {
	role: string;
	models: readonly { provider: string; id: string; name: string }[];
	checked: readonly string[];
	droppedCount: number;
	keptAliasCount: number;
	keybindings: KeybindingsManager;
	theme: { fg(token: string, text: string): string; bold(text: string): string };
	tui: { requestRender(): void };
	hints?: (id: string) => string;
	onSave: (checked: readonly string[]) => boolean;
	onCancel: () => void;
}

const MAX_VISIBLE_ROWS = 8;

/**
 * Draft selector for one alias role's concrete fallback targets. It owns the
 * explicit checked list and reports it through `onSave`; a refused save leaves
 * the draft dirty. Nested alias targets and the file write stay outside.
 */
export function createChainSelector(
	options: ChainSelectorOptions,
): Component & { focused: boolean; handleInput(data: string): void } {
	const { theme, tui } = options;
	const hints = options.hints ?? ((id: string) => keyText(id as Parameters<typeof keyText>[0]));

	const models: CatalogModel[] = options.models.filter((model) => model.provider !== "alias");
	const modelsById = new Map<string, CatalogModel>();
	const catalogIds: string[] = [];
	for (const model of models) {
		const id = modelId(model);
		modelsById.set(id, model);
		catalogIds.push(id);
	}

	let checkedIds: string[] = [];
	const seenChecked = new Set<string>();
	for (const id of options.checked) {
		if (seenChecked.has(id) || !modelsById.has(id)) continue;
		seenChecked.add(id);
		checkedIds.push(id);
	}

	const searchInput = new Input();
	let selectedIndex = 0;
	let isDirty = false;

	/** Checked models first in checked order, then unchecked models in catalog order. */
	const orderedModels = (): CatalogModel[] => {
		const checkedSet = new Set(checkedIds);
		const ordered = checkedIds.flatMap((id) => {
			const model = modelsById.get(id);
			return model ? [model] : [];
		});
		for (const model of models) {
			if (!checkedSet.has(modelId(model))) ordered.push(model);
		}
		return ordered;
	};

	const visibleModels = (): CatalogModel[] => {
		const ordered = orderedModels();
		const query = searchInput.getValue();
		if (!query.trim()) return ordered;
		return fuzzyFilter(ordered, query, (model) => `${model.id} ${model.provider} ${model.name}`);
	};

	const selectedModelId = (): string | undefined => {
		const model = visibleModels()[selectedIndex];
		return model ? modelId(model) : undefined;
	};

	const clampSelection = (): void => {
		const count = visibleModels().length;
		selectedIndex = Math.min(selectedIndex, Math.max(0, count - 1));
	};

	/** Keep the selection on `id` after the visible order changes. */
	const keepSelection = (id: string | undefined): void => {
		if (id === undefined) {
			clampSelection();
			return;
		}
		const index = visibleModels().findIndex((model) => modelId(model) === id);
		selectedIndex = index >= 0 ? index : Math.min(selectedIndex, Math.max(0, visibleModels().length - 1));
	};

	const addChecked = (ids: readonly string[]): void => {
		for (const id of ids) {
			if (!modelsById.has(id) || checkedIds.includes(id)) continue;
			checkedIds.push(id);
		}
	};

	const removeChecked = (ids: readonly string[]): void => {
		const targets = new Set(ids);
		checkedIds = checkedIds.filter((id) => !targets.has(id));
	};

	const filteredIds = (): string[] => visibleModels().map(modelId);

	const scopeIds = (): readonly string[] => (searchInput.getValue().trim() ? filteredIds() : catalogIds);

	const footer = (): string => {
		const parts = [
			`${hints("tui.select.confirm")} toggle`,
			`${hints("app.models.enableAll")} all`,
			`${hints("app.models.clearAll")} clear`,
			`${hints("app.models.toggleProvider")} provider`,
			`${hints("app.models.reorderUp")}/${hints("app.models.reorderDown")} reorder`,
			`${hints("app.models.save")} save`,
			`${checkedIds.length}/${catalogIds.length} · drop ${options.droppedCount} · keep ${options.keptAliasCount}`,
		].join(" · ");
		return isDirty ? `${parts} (unsaved)` : parts;
	};

	const render = (width: number): string[] => {
		const lines: string[] = [theme.bold(theme.fg("accent", `Model alias: ${options.role}`)), ...searchInput.render(width)];
		const visible = visibleModels();
		if (visible.length === 0) {
			lines.push(theme.fg("muted", "  No matching models"));
		} else {
			const start = Math.max(0, Math.min(selectedIndex - Math.floor(MAX_VISIBLE_ROWS / 2), visible.length - MAX_VISIBLE_ROWS));
			const end = Math.min(start + MAX_VISIBLE_ROWS, visible.length);
			for (let index = start; index < end; index++) {
				const model = visible[index];
				const id = modelId(model);
				const isSelected = index === selectedIndex;
				const cursor = isSelected ? theme.fg("accent", "→ ") : "  ";
				const check = checkedIds.includes(id) ? theme.fg("success", "✓ ") : "  ";
				const label = isSelected ? theme.fg("accent", id) : id;
				lines.push(`${cursor}${check}${label}${theme.fg("muted", ` [${model.provider}]`)}`);
			}
			if (start > 0 || end < visible.length) {
				lines.push(theme.fg("muted", `  (${selectedIndex + 1}/${visible.length})`));
			}
			const selected = visible[selectedIndex];
			if (selected) lines.push(theme.fg("muted", `  Model Name: ${selected.name}`));
		}
		lines.push(theme.fg(isDirty ? "warning" : "dim", `  ${footer()}`));
		return lines;
	};

	const handleInput = (data: string): void => {
		const keybindings = options.keybindings;
		if (keybindings.matches(data, "tui.select.up")) {
			const count = visibleModels().length;
			if (count > 0) selectedIndex = selectedIndex === 0 ? count - 1 : selectedIndex - 1;
		} else if (keybindings.matches(data, "tui.select.down")) {
			const count = visibleModels().length;
			if (count > 0) selectedIndex = selectedIndex === count - 1 ? 0 : selectedIndex + 1;
		} else if (keybindings.matches(data, "app.models.reorderUp") || keybindings.matches(data, "app.models.reorderDown")) {
			const id = selectedModelId();
			if (id !== undefined && checkedIds.includes(id)) {
				const up = keybindings.matches(data, "app.models.reorderUp");
				const from = checkedIds.indexOf(id);
				const to = from + (up ? -1 : 1);
				if (to >= 0 && to < checkedIds.length) {
					const next = [...checkedIds];
					[next[from], next[to]] = [next[to], next[from]];
					checkedIds = next;
					isDirty = true;
				}
			}
			keepSelection(id);
		} else if (keybindings.matches(data, "tui.select.confirm")) {
			const id = selectedModelId();
			if (id !== undefined) {
				if (checkedIds.includes(id)) removeChecked([id]);
				else addChecked([id]);
				isDirty = true;
			}
			keepSelection(id);
		} else if (keybindings.matches(data, "app.models.enableAll")) {
			const id = selectedModelId();
			addChecked(scopeIds());
			isDirty = true;
			keepSelection(id);
		} else if (keybindings.matches(data, "app.models.clearAll")) {
			const id = selectedModelId();
			removeChecked(scopeIds());
			isDirty = true;
			keepSelection(id);
		} else if (keybindings.matches(data, "app.models.toggleProvider")) {
			const id = selectedModelId();
			const model = id === undefined ? undefined : modelsById.get(id);
			if (model) {
				const providerIds = catalogIds.filter((candidate) => modelsById.get(candidate)?.provider === model.provider);
				if (providerIds.every((candidate) => checkedIds.includes(candidate))) removeChecked(providerIds);
				else addChecked(providerIds);
				isDirty = true;
			}
			keepSelection(id);
		} else if (keybindings.matches(data, "app.models.save")) {
			if (options.onSave([...checkedIds])) isDirty = false;
			clampSelection();
		} else if (matchesKey(data, Key.ctrl("c"))) {
			if (searchInput.getValue()) searchInput.setValue("");
			else options.onCancel();
			clampSelection();
		} else if (matchesKey(data, Key.escape) || keybindings.matches(data, "tui.select.cancel")) {
			options.onCancel();
		} else {
			searchInput.handleInput(data);
			clampSelection();
		}
		tui.requestRender();
	};

	return {
		get focused(): boolean {
			return searchInput.focused;
		},
		set focused(value: boolean) {
			searchInput.focused = value;
		},
		render,
		handleInput,
		invalidate() {
			searchInput.invalidate();
		},
	};
}

function modelId(model: CatalogModel): string {
	return `${model.provider}/${model.id}`;
}
