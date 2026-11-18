import assert from "node:assert/strict";
import {
	getLatestAutoTitle,
	isManualOrForeignName,
} from "./state.js";

const autoEntry = (title: string) => ({
	type: "custom",
	customType: "pi-session-name.auto",
	data: { title, at: "2026-01-01T00:00:00.000Z", source: "auto" },
});
const manualEntry = {
	type: "custom",
	customType: "pi-session-name.manual",
	data: { title: "manual", source: "manual" },
};

const ctx = (entries: unknown[]) =>
	({ sessionManager: { getEntries: () => entries } }) as never;
const pi = (name: string | undefined) =>
	({ getSessionName: () => name }) as never;

assert.equal(getLatestAutoTitle(ctx([autoEntry("old")]))?.title, "old");
assert.equal(
	getLatestAutoTitle(ctx([autoEntry("old"), autoEntry("new")]))?.title,
	"new",
);

assert.equal(isManualOrForeignName(ctx([]), pi(undefined)), false);
assert.equal(isManualOrForeignName(ctx([]), pi("manual")), true);
assert.equal(
	isManualOrForeignName(ctx([autoEntry("auto")]), pi("auto")),
	false,
);
assert.equal(
	isManualOrForeignName(ctx([autoEntry("auto")]), pi("changed")),
	true,
);
assert.equal(
	isManualOrForeignName(ctx([autoEntry("auto"), manualEntry]), pi("auto")),
	true,
);
assert.equal(
	isManualOrForeignName(ctx([autoEntry("auto"), manualEntry]), pi(undefined)),
	false,
);

console.log("session-name state tests passed");
