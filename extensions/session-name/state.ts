import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export const AUTO_TITLE_ENTRY = "pi-session-name.auto";
export const MANUAL_TITLE_ENTRY = "pi-session-name.manual";

export type AutoTitleState = {
	title: string;
	at: string;
	source: "auto";
	model?: string;
};

type EntryLike = {
	type?: string;
	customType?: string;
	data?: unknown;
};

function isAutoTitleState(value: unknown): value is AutoTitleState {
	if (typeof value !== "object" || value === null) return false;
	const state = value as Partial<AutoTitleState>;
	return typeof state.title === "string" && state.title.length > 0;
}

export function getLatestAutoTitle(
	ctx: ExtensionContext,
): AutoTitleState | undefined {
	let latest: AutoTitleState | undefined;
	for (const entry of ctx.sessionManager.getEntries() as EntryLike[]) {
		if (entry.type !== "custom" || entry.customType !== AUTO_TITLE_ENTRY)
			continue;
		if (isAutoTitleState(entry.data)) latest = entry.data;
	}
	return latest;
}

export function hasManualTitleMarker(ctx: ExtensionContext): boolean {
	return (ctx.sessionManager.getEntries() as EntryLike[]).some(
		(entry) =>
			entry.type === "custom" && entry.customType === MANUAL_TITLE_ENTRY,
	);
}

/**
 * True when the current session name is not the title this extension last
 * applied. That covers Pi's builtin `/name`, `--name`, other extensions, and
 * our own manual rename command. Never auto-refresh those.
 */
export function isManualOrForeignName(
	ctx: ExtensionContext,
	pi: ExtensionAPI,
): boolean {
	const current = pi.getSessionName()?.trim();
	if (!current) return false;
	if (hasManualTitleMarker(ctx)) return true;
	const latest = getLatestAutoTitle(ctx);
	if (!latest) return true;
	return current !== latest.title;
}

export function markAutoTitle(
	pi: ExtensionAPI,
	title: string,
	model: string | undefined,
): void {
	const state: AutoTitleState = {
		title,
		at: new Date().toISOString(),
		source: "auto",
		...(model ? { model } : {}),
	};
	pi.appendEntry(AUTO_TITLE_ENTRY, state);
}

export function markManualTitle(pi: ExtensionAPI, title: string): void {
	pi.appendEntry(MANUAL_TITLE_ENTRY, {
		title,
		at: new Date().toISOString(),
		source: "manual",
	});
}
