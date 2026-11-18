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

const titleContext = buildTitleContext(branch, {
	maxMessages: 10,
	maxChars: 10_000,
	includeTools: false,
});
assert.match(titleContext, /First user message:/);
assert.match(titleContext, /Recent session transcript:/);
assert.doesNotMatch(titleContext, /file contents/);

const titleContextWithTools = buildTitleContext(branch, {
	maxMessages: 10,
	maxChars: 10_000,
	includeTools: true,
});
assert.match(titleContextWithTools, /file contents/);

console.log("session-name transcript tests passed");
