import assert from "node:assert/strict";
import {
	buildClassifierState,
	buildTitleContext,
	firstUserText,
	formatTranscript,
} from "./transcript.js";

const branch = [
	{ type: "custom", customType: "ignored", data: {} },
	{ type: "message", message: { role: "user", content: "first user" } },
	{
		type: "message",
		message: {
			role: "toolResult",
			toolName: "read",
			content: "file contents",
		},
	},
	{
		type: "message",
		message: { role: "assistant", content: "assistant reply" },
	},
	{
		type: "message",
		message: {
			role: "user",
			content: [
				{ type: "thinking", thinking: "ignored" },
				{ type: "text", text: "latest user" },
			],
		},
	},
] as never[];

assert.equal(firstUserText(branch), "first user");
assert.equal(
	formatTranscript(branch, {
		maxMessages: 10,
		maxChars: 10_000,
		includeTools: false,
	}),
	["[user] first user", "[assistant] assistant reply", "[user] latest user"].join(
		"\n",
	),
);
assert.equal(
	formatTranscript(branch, {
		maxMessages: 2,
		maxChars: 10_000,
		includeTools: true,
	}),
	["[assistant] assistant reply", "[user] latest user"].join("\n"),
);
assert.equal(
	formatTranscript(branch, {
		maxMessages: 10,
		maxChars: 20,
		includeTools: false,
	}).length,
	20,
);

const state = buildClassifierState(branch, {
	currentTitle: "fix(auth): refresh token flow",
	userTurns: 7,
	turnsSinceTitle: 3,
	maxMessages: 2,
	maxChars: 100,
});
assert.equal(state.currentTitle, "fix(auth): refresh token flow");
assert.equal(state.userTurns, 7);
assert.equal(state.turnsSinceTitle, 3);
assert.equal(state.firstUserMessage, "first user");
assert.match(state.recentMessages, /latest user/);
assert.doesNotMatch(state.recentMessages, /file contents/);

const stateWithStartPrompt = buildClassifierState(branch, {
	currentTitle: "old title",
	userTurns: 2,
	turnsSinceTitle: 1,
	maxMessages: 10,
	maxChars: 10_000,
	latestUserMessage: "brand new task",
});
assert.match(stateWithStartPrompt.recentMessages, /\[user\] brand new task/);
assert.equal(stateWithStartPrompt.firstUserMessage, "first user");

const emptyState = buildClassifierState([], {
	currentTitle: "old title",
	userTurns: 1,
	turnsSinceTitle: 1,
	maxMessages: 10,
	maxChars: 10_000,
	latestUserMessage: "first visible prompt",
});
assert.equal(emptyState.firstUserMessage, "first visible prompt");
assert.equal(emptyState.recentMessages, "[user] first visible prompt");

const titleContext = buildTitleContext(branch, {
	maxMessages: 10,
	maxChars: 10_000,
	includeTools: false,
	latestUserMessage: "brand new task",
});
assert.match(titleContext, /First user message:/);
assert.match(titleContext, /Recent session transcript:/);
assert.match(titleContext, /Latest user message:\nbrand new task/);
assert.doesNotMatch(titleContext, /file contents/);

const titleContextWithTools = buildTitleContext(branch, {
	maxMessages: 10,
	maxChars: 10_000,
	includeTools: true,
});
assert.match(titleContextWithTools, /file contents/);

console.log("session-name transcript tests passed");
