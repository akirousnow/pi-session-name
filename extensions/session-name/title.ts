import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	CONVENTIONAL_TITLE_RE,
	formatTitleTagCatalog,
	ISO_FALLBACK_RE,
	normalizeTitle,
	resolveTitleTags,
} from "./title-utils.js";
import type { SessionNameConfig } from "./config.js";

export type TitleCandidate = {
	title: string;
	model: string;
};

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

function normalizeForComparison(value: string): string {
	return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Avoid titles like `plan: plan simple steps` after the model repeats the tag. */
export function removeRepeatedTagWord(title: string): string {
	const match = title.match(CONVENTIONAL_TITLE_RE);
	if (!match) return title;
	const tag = match[1]!.toLowerCase();
	const scope = match[2]?.trim().toLowerCase();
	const description = match[3]!.trim();
	const first = description.split(/\s+/, 1)[0]?.toLowerCase();
	if (!first || (first !== tag && first !== scope)) return title;
	const rest = description.slice(first.length).trim();
	if (!rest) return title;
	return `${tag}${scope ? `(${scope})` : ""}: ${rest}`;
}

export function buildTitleSystemPrompt(config: SessionNameConfig): string {
	const tags = resolveTitleTags({
		builtinTags: true,
		tags: config.extraTags,
	});
	const tagNames = tags.map((tag) => tag.name);
	const tagged = config.useTags && tagNames.length > 0;
	const formatRule = tagged
		? "Use `<tag>(<optional-scope>): <description>`."
		: "Output only `<description>` without a tag or scope.";
	const tagRule = tagged
		? `- Use only these tags, in preference order: ${tagNames.join(", ")}`
		: "- Do not output a tag, scope, or Conventional Commit prefix.";
	const guidance = tagged ? formatTitleTagCatalog(tags) : "";

	return `You generate concise session titles for a coding agent.
Output exactly one line: no preamble, quotes, backticks, markdown, code fences, or trailing punctuation.

Format:
${formatRule}

Rules:
- The description must be at most ${config.maxTitleLength} characters.
- Use a scope only when one lowercase alphanumeric word names a codebase area. No spaces, dashes, underscores, dots, or slashes. Max ${config.scopeMaxLength} characters.
- The description should capture the session's overall intent, not the latest tool output.
- Prefer imperative or noun-phrase style and preserve useful technical terms, filenames, numbers, and identifiers.
- Use the same natural language as the user's messages.
- If the current title is already accurate, repeat it exactly.
- Never use emojis.
- Do not repeat the tag or scope as the first word of the description.
- Never refuse, explain, or comment on the input. Always emit one title.
${tagRule}
${guidance ? `\nTag guidance:\n${guidance}` : ""}`.trim();
}

export function buildTitleUserMessage(
	currentTitle: string,
	context: string,
): string {
	const current = currentTitle.trim() || "(none)";
	return `<current-title>
${current}
</current-title>

<session-context>
${context || "(no messages yet)"}
</session-context>

Write the updated session title now. If the current title is already accurate, repeat it exactly.`;
}

export function resolveTitleModel(
	ctx: ExtensionContext,
	config: SessionNameConfig,
) {
	if (!config.titleModel || config.titleModel.trim() === "auto") {
		return { model: ctx.model, label: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "current" };
	}

	const raw = config.titleModel.trim();
	const slash = raw.indexOf("/");
	const provider = slash > 0 ? raw.slice(0, slash) : ctx.model?.provider;
	let id = slash > 0 ? raw.slice(slash + 1) : raw;
	const colon = id.lastIndexOf(":");
	if (colon > 0) {
		const suffix = id.slice(colon + 1);
		if (["minimal", "low", "medium", "high", "xhigh", "max"].includes(suffix)) {
			id = id.slice(0, colon);
		}
	}
	if (!provider || !id) return { model: undefined, label: raw };
	return {
		model: ctx.modelRegistry.find(provider, id),
		label: `${provider}/${id}`,
	};
}

export async function generateTitleCandidate(
	ctx: ExtensionContext,
	config: SessionNameConfig,
	currentTitle: string,
	context: string,
	signal: AbortSignal,
): Promise<TitleCandidate | undefined> {
	const resolved = resolveTitleModel(ctx, config);
	const model = resolved.model;
	if (!model) return undefined;

	const systemPrompt = buildTitleSystemPrompt(config);
	const userMessage = buildTitleUserMessage(currentTitle, context);

	let response;
	try {
		response = await ctx.modelRegistry.complete(
			model,
			{
				systemPrompt,
				messages: [
					{
						role: "user",
						content: userMessage,
						timestamp: Date.now(),
					},
				],
			},
			{
				signal,
				maxTokens: Math.max(160, config.maxTitleLength * 3),
				temperature: 0.3,
				cacheRetention: "none",
			},
		);
	} catch {
		return undefined;
	}

	if (response.stopReason === "aborted") return undefined;
	const raw = firstTextContent(response.content);
	if (!raw.trim()) return undefined;

	const tags = resolveTitleTags({
		builtinTags: true,
		tags: config.extraTags,
	});
	const normalized = normalizeTitle(raw, {
		maxLength: config.maxTitleLength,
		scopeMaxLength: config.scopeMaxLength,
		useTags: config.useTags,
		tags: tags.map((tag) => tag.name),
	});
	const title = removeRepeatedTagWord(normalized);

	// normalizeTitle falls back to a datetime when the model output is invalid.
	// Never replace an existing title with that fallback.
	if (!title || ISO_FALLBACK_RE.test(title)) return undefined;
	if (
		currentTitle.trim() &&
		normalizeForComparison(title) === normalizeForComparison(currentTitle)
	) {
		return undefined;
	}

	return { title, model: resolved.label };
}
