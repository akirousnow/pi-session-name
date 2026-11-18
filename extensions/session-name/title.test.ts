import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "./config.js";
import {
	buildTitleSystemPrompt,
	buildTitleUserMessage,
	generateTitleCandidate,
	removeRepeatedTagWord,
} from "./title.js";

const prompt = buildTitleSystemPrompt({
	...DEFAULT_CONFIG,
	maxTitleLength: 52,
	extraTags: ["cook"],
});
assert.match(prompt, /at most 52/);
assert.match(prompt, /cook/);
assert.match(prompt, /fix/);
assert.match(prompt, /Never use emojis/);
assert.match(prompt, /Do not repeat the tag or scope/);

const userMessage = buildTitleUserMessage("fix(auth): old title", "recent");
assert.match(userMessage, /<current-title>/);
assert.match(userMessage, /fix\(auth\): old title/);
assert.match(userMessage, /<session-context>/);
assert.match(userMessage, /repeat it exactly/);

function mockCtx(text: string) {
	return {
		model: { provider: "mock", id: "title-model" },
		modelRegistry: {
			complete: async () => ({
				stopReason: "stop",
				content: [{ type: "text", text }],
			}),
		},
	} as never;
}

assert.equal(
	removeRepeatedTagWord("plan: plan simple lasagna recipe"),
	"plan: simple lasagna recipe",
);
assert.equal(
	removeRepeatedTagWord("fix(auth): auth token refresh"),
	"fix(auth): token refresh",
);
assert.equal(
	removeRepeatedTagWord("fix(auth): refresh token flow"),
	"fix(auth): refresh token flow",
);

const generated = await generateTitleCandidate(
	mockCtx("fix(auth): refresh token expiry"),
	DEFAULT_CONFIG,
	"",
	"context",
	new AbortController().signal,
);
assert.deepEqual(generated, {
	title: "fix(auth): refresh token expiry",
	model: "mock/title-model",
});

const unchanged = await generateTitleCandidate(
	mockCtx("fix(auth): refresh token expiry"),
	DEFAULT_CONFIG,
	"fix(auth): refresh token expiry",
	"context",
	new AbortController().signal,
);
assert.equal(unchanged, undefined);

const invalid = await generateTitleCandidate(
	mockCtx("2026-11-18T07:17+08:00"),
	DEFAULT_CONFIG,
	"",
	"context",
	new AbortController().signal,
);
assert.equal(invalid, undefined);

const tooLong = await generateTitleCandidate(
	mockCtx(`fix(auth): ${"x".repeat(DEFAULT_CONFIG.maxTitleLength + 1)}`),
	DEFAULT_CONFIG,
	"",
	"context",
	new AbortController().signal,
);
assert.equal(tooLong, undefined);

console.log("session-name title tests passed");
