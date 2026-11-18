import assert from "node:assert/strict";
import { DEFAULT_CONFIG, normalizeConfig } from "./config.js";

assert.deepEqual(normalizeConfig({}), DEFAULT_CONFIG);

const normalized = normalizeConfig({
	enabled: false,
	classifier: " openrouter/typesafe/jev-1.14 ",
	titleModel: "anthropic/claude-haiku-4-5:low",
	askThreshold: 0.8,
	autoThreshold: 0.4, // must not be below askThreshold
	minTurnsBetweenChecks: 3,
	minTurnsBetweenRenames: 1, // must be raised to checks
	maxPrompts: -2,
	classifierMessages: 0,
	titleMessages: 2.9,
	maxTitleLength: "bad",
	useTags: false,
	extraTags: [" Cook ", "bad tag", 7],
	debug: true,
});

assert.equal(normalized.enabled, false);
assert.equal(normalized.classifier, "openrouter/typesafe/jev-1.14");
assert.equal(normalized.titleModel, "anthropic/claude-haiku-4-5:low");
assert.equal(normalized.askThreshold, 0.8);
assert.equal(normalized.autoThreshold, 0.8);
assert.equal(normalized.minTurnsBetweenChecks, 3);
assert.equal(normalized.minTurnsBetweenRenames, 3);
assert.equal(normalized.maxPrompts, 0);
assert.equal(normalized.classifierMessages, 1);
assert.equal(normalized.titleMessages, 2);
assert.equal(normalized.maxTitleLength, DEFAULT_CONFIG.maxTitleLength);
assert.equal(normalized.useTags, false);
assert.deepEqual(normalized.extraTags, ["cook", "bad tag"]);
assert.equal(normalized.debug, true);

const clamped = normalizeConfig({
	askThreshold: -1,
	autoThreshold: 5,
	minTurnsBetweenChecks: 0,
	maxStateChars: 1,
	maxTitleContextChars: 10,
});
assert.equal(clamped.askThreshold, 0);
assert.equal(clamped.autoThreshold, 1);
assert.equal(clamped.minTurnsBetweenChecks, 1);
assert.equal(clamped.maxStateChars, 500);
assert.equal(clamped.maxTitleContextChars, 1_000);

console.log("session-name config tests passed");
