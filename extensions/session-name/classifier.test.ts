import assert from "node:assert/strict";
import {
	classifyRenameNeed,
	parseClassifierRef,
} from "./classifier.js";

assert.equal(parseClassifierRef("auto"), undefined);
assert.equal(parseClassifierRef(""), undefined);
assert.equal(parseClassifierRef("typesafe"), undefined);
assert.equal(parseClassifierRef("typesafe/"), undefined);
assert.deepEqual(parseClassifierRef("typesafe/jev-latest"), {
	provider: "typesafe",
	id: "jev-latest",
});
assert.deepEqual(parseClassifierRef(" openrouter/typesafe/jev-1.14 "), {
	provider: "openrouter",
	id: "typesafe/jev-1.14",
});

const model = { id: "jev-latest", provider: "typesafe" } as never;
const ctx = {
	modelRegistry: {
		classify: async () => ({
			stopReason: "stop",
			answers: {
				needsRename: { type: "bool", probability: 0.87 },
			},
			provider: "typesafe",
			model: "jev-latest",
			usage: { totalTokens: 42 },
		}),
	},
} as never;

const ok = await classifyRenameNeed(
	ctx,
	model,
	{ currentTitle: "fix(auth): refresh token flow" },
	new AbortController().signal,
);
assert.equal(ok.ok, true);
if (ok.ok) {
	assert.equal(ok.probability, 0.87);
	assert.equal(ok.model, "typesafe/jev-latest");
}

const failingCtx = {
	modelRegistry: {
		classify: async () => ({
			stopReason: "error",
			errorMessage: "no auth",
			answers: {},
			provider: "typesafe",
			model: "jev-latest",
		}),
	},
} as never;
const failed = await classifyRenameNeed(
	failingCtx,
	model,
	{},
	new AbortController().signal,
);
assert.deepEqual(failed, { ok: false, error: "no auth" });

const emptyCtx = {
	modelRegistry: {
		classify: async () => ({
			stopReason: "stop",
			answers: {},
			provider: "typesafe",
			model: "jev-latest",
		}),
	},
} as never;
const empty = await classifyRenameNeed(
	emptyCtx,
	model,
	{},
	new AbortController().signal,
);
assert.equal(empty.ok, false);

console.log("session-name classifier tests passed");
