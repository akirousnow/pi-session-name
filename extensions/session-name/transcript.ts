import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export type TranscriptOptions = {
	maxMessages: number;
	maxChars: number;
	perMessageChars?: number;
	includeTools: boolean;
};

export type ClassifierState = {
	currentTitle: string;
	userTurns: number;
	turnsSinceTitle: number;
	firstUserMessage?: string;
	recentMessages: string;
};

const DEFAULT_PER_MESSAGE_CHARS = 2_000;

function firstTextContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part: unknown) => {
			if (
				part &&
				typeof part === "object" &&
				(part as { type?: string }).type === "text"
			) {
				return String((part as { text?: string }).text ?? "");
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
}

export function textifyEntry(
	entry: SessionEntry,
	includeTools: boolean,
): string | undefined {
	if (entry.type !== "message") return undefined;
	const message = entry.message;
	if (message.role === "user") return `[user] ${firstTextContent(message.content)}`;
	if (message.role === "assistant")
		return `[assistant] ${firstTextContent(message.content)}`;
	if (message.role === "toolResult" && includeTools)
		return `[tool:${message.toolName}] ${firstTextContent(message.content)}`;
	return undefined;
}

function clip(value: string, maxChars: number): string {
	const normalized = value.trim();
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function formatTranscript(
	branch: SessionEntry[],
	options: TranscriptOptions,
): string {
	const perMessageChars =
		options.perMessageChars ?? DEFAULT_PER_MESSAGE_CHARS;
	const entries = branch
		.map((entry) => textifyEntry(entry, options.includeTools))
		.filter((text): text is string => Boolean(text?.trim()))
		.slice(-Math.max(1, Math.floor(options.maxMessages)))
		.map((text) => clip(text, perMessageChars));
	const joined = entries.join("\n");
	if (joined.length <= options.maxChars) return joined;
	return `…${joined.slice(joined.length - Math.max(0, options.maxChars - 1))}`;
}

export function firstUserText(branch: SessionEntry[]): string | undefined {
	for (const entry of branch) {
		if (entry.type !== "message" || entry.message.role !== "user") continue;
		const text = firstTextContent(entry.message.content).trim();
		if (text) return clip(text, 1_000);
	}
	return undefined;
}

export function buildClassifierState(
	branch: SessionEntry[],
	args: {
		currentTitle: string;
		userTurns: number;
		turnsSinceTitle: number;
		maxMessages: number;
		maxChars: number;
		latestUserMessage?: string;
	},
): ClassifierState {
	const latestUser = args.latestUserMessage?.trim();
	const recent = formatTranscript(branch, {
		maxMessages: args.maxMessages,
		maxChars: args.maxChars,
		includeTools: false,
	});
	// before_agent_start may run before the latest user message is persisted.
	// Include it explicitly when it is not already present in the branch text.
	const recentMessages =
		latestUser && !recent.includes(latestUser)
			? `${recent ? `${recent}\n` : ""}[user] ${clip(latestUser, 1_000)}`
			: recent;
	const firstUser =
		firstUserText(branch) ??
		(latestUser ? clip(latestUser, 1_000) : undefined);

	return {
		currentTitle: args.currentTitle,
		userTurns: args.userTurns,
		turnsSinceTitle: args.turnsSinceTitle,
		firstUserMessage: firstUser,
		recentMessages,
	};
}

export function buildTitleContext(
	branch: SessionEntry[],
	args: {
		maxMessages: number;
		maxChars: number;
		includeTools: boolean;
		latestUserMessage?: string;
	},
): string {
	const parts: string[] = [];
	const first = firstUserText(branch);
	if (first) parts.push(`First user message:\n${first}`);
	const recent = formatTranscript(branch, {
		maxMessages: args.maxMessages,
		maxChars: args.maxChars,
		includeTools: args.includeTools,
	});
	if (recent) parts.push(`Recent session transcript:\n${recent}`);
	const latestUser = args.latestUserMessage?.trim();
	if (latestUser && !recent.includes(latestUser)) {
		parts.push(`Latest user message:\n${clip(latestUser, 1_000)}`);
	}
	return parts.join("\n\n");
}
