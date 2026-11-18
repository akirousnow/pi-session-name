import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
	createClassifierResolver,
	classifyRenameNeed,
} from "./classifier.js";
import {
	DEFAULT_CONFIG,
	isDebugEnabled,
	loadConfig,
	type SessionNameConfig,
} from "./config.js";
import {
	getLatestAutoTitle,
	isManualOrForeignName,
	markAutoTitle,
	markManualTitle,
} from "./state.js";
import { generateTitleCandidate, type TitleCandidate } from "./title.js";
import {
	buildClassifierState,
	buildTitleContext,
} from "./transcript.js";

const resolveClassifier = createClassifierResolver();
const TITLE_TIMEOUT_MS = 60_000;

function safeLoadConfig(cwd: string): SessionNameConfig {
	try {
		return loadConfig(cwd);
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

function log(config: SessionNameConfig, message: string): void {
	if (isDebugEnabled(config)) {
		console.warn(`[session-name] ${message}`);
	}
}

function normalized(value: string): string {
	return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenHash(value: string): string {
	return normalized(value);
}

function isUiIdle(ctx: ExtensionContext): boolean {
	try {
		return ctx.isIdle();
	} catch {
		return false;
	}
}

function hasUi(ctx: ExtensionContext): boolean {
	try {
		return ctx.hasUI;
	} catch {
		return false;
	}
}

function setTerminalTitle(ctx: ExtensionContext, title: string): void {
	try {
		if (ctx.hasUI) ctx.ui.setTitle(title);
	} catch {
		// The title bar is cosmetic; the session name is the source of truth.
	}
}

function applyTitle(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: SessionNameConfig,
	title: string,
	model: string | undefined,
	expectedCurrentTitle: string,
): boolean {
	const current = pi.getSessionName()?.trim() ?? "";
	if (current !== expectedCurrentTitle) {
		log(
			config,
			`skip apply: current title changed (${JSON.stringify(current)})`,
		);
		return false;
	}
	try {
		pi.setSessionName(title);
		markAutoTitle(pi, title, model);
		setTerminalTitle(ctx, title);
		log(config, `applied ${JSON.stringify(title)}${model ? ` from ${model}` : ""}`);
		return true;
	} catch (error) {
		log(
			config,
			`apply failed: ${error instanceof Error ? error.message : String(error)}`,
		);
		return false;
	}
}

async function askToApply(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	config: SessionNameConfig,
	candidate: TitleCandidate,
	currentTitle: string,
): Promise<"applied" | "kept" | "skipped"> {
	if (!hasUi(ctx)) return "skipped";
	if (!isUiIdle(ctx)) return "skipped";
	try {
		const choice = await ctx.ui.select(
			`Session title\n\nCurrent: ${currentTitle}\nSuggested: ${candidate.title}\n\nUpdate the session title?`,
			["Use suggested title", "Keep current title", "Edit title…"],
		);
		if (choice === "Use suggested title") {
			return applyTitle(
				pi,
				ctx,
				config,
				candidate.title,
				candidate.model,
				currentTitle,
			)
				? "applied"
				: "skipped";
		}
		if (choice === "Edit title…") {
			const edited = await ctx.ui.input("Edit session title", candidate.title);
			if (edited === undefined) return "kept";
			const title = edited.trim();
			if (!title) return "kept";
			return applyTitle(pi, ctx, config, title, "manual", currentTitle)
				? "applied"
				: "skipped";
		}
		return "kept";
	} catch {
		return "skipped";
	}
}

async function forceRefresh(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
): Promise<void> {
	const config = safeLoadConfig(ctx.cwd);
	const current = pi.getSessionName()?.trim() ?? "";
	const branch = ctx.sessionManager.getBranch();
	const context = buildTitleContext(branch, {
		maxMessages: config.titleMessages,
		maxChars: config.maxTitleContextChars,
		includeTools: config.titleIncludeTools,
	});
	const controller = new AbortController();
	const signal = AbortSignal.any([
		controller.signal,
		AbortSignal.timeout(TITLE_TIMEOUT_MS),
	]);
	const candidate = await generateTitleCandidate(
		ctx,
		config,
		current,
		context,
		signal,
	);
	if (!candidate) {
		if (hasUi(ctx)) ctx.ui.notify("Could not generate a session title", "warning");
		return;
	}
	if (!applyTitle(pi, ctx, config, candidate.title, candidate.model, current)) {
		if (hasUi(ctx)) {
			ctx.ui.notify("Session title changed while generating", "warning");
		}
		return;
	}
	if (hasUi(ctx)) ctx.ui.notify(`Session title: ${candidate.title}`, "info");
}

export default function sessionNameExtension(pi: ExtensionAPI): void {
	let active: AbortController | undefined;
	let runToken = 0;
	let userTurns = 0;
	let turnsSinceTitle = 0;
	let turnsSinceCheck = 0;
	let renames = 0;
	let prompts = 0;
	let lastDismissed = "";
	let handling = false;

	function cancelActive(): void {
		runToken++;
		active?.abort();
		active = undefined;
	}

	pi.on("session_start", () => {
		cancelActive();
		handling = false;
		userTurns = 0;
		turnsSinceTitle = 0;
		turnsSinceCheck = 0;
		renames = 0;
		prompts = 0;
		lastDismissed = "";
	});

	pi.on("session_shutdown", () => {
		cancelActive();
	});

	pi.on("before_agent_start", (event) => {
		if (event.messageType !== "user") return;
		userTurns++;
		turnsSinceTitle++;
		turnsSinceCheck++;
		cancelActive();
	});

	pi.on("agent_settled", async (event, ctx) => {
		if (event.aborted) return;
		const token = runToken;
		try {
			await handleSettled(ctx, token);
		} catch (error) {
			let config: SessionNameConfig = { ...DEFAULT_CONFIG };
			try {
				config = safeLoadConfig(ctx.cwd);
			} catch {
				// Keep defaults if the context went stale before logging.
			}
			log(
				config,
				`settled handler failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	});

	async function handleSettled(
		ctx: ExtensionContext,
		token: number,
	): Promise<void> {
		if (handling || token !== runToken) return;
		const config = safeLoadConfig(ctx.cwd);
		if (!config.enabled) return;

		let current = pi.getSessionName()?.trim() ?? "";
		const latest = getLatestAutoTitle(ctx);

		if (!current) {
			// Do not resurrect a title the user deliberately cleared, and do not
			// fight a session that already has a foreign/manual name.
			if (latest || isManualOrForeignName(ctx, pi)) return;
			handling = true;
			try {
				await generateInitialTitle(ctx, config, token);
			} finally {
				handling = false;
			}
			return;
		}

		if (!latest || current !== latest.title) return;
		if (renames >= config.maxRenames) return;
		if (turnsSinceTitle < config.minTurnsBetweenRenames) return;
		if (turnsSinceCheck < config.minTurnsBetweenChecks) return;

		handling = true;
		const controller = new AbortController();
		active = controller;
		const classifierSignal = AbortSignal.any([
			controller.signal,
			AbortSignal.timeout(config.classifierTimeoutMs),
		]);
		try {
			const lookup = await resolveClassifier(ctx, config.classifier);
			if (!lookup) {
				log(config, `classifier unavailable: ${config.classifier}`);
				return;
			}
			if (token !== runToken || !isUiIdle(ctx)) return;
			turnsSinceCheck = 0;

			const branch = ctx.sessionManager.getBranch();
			const state = buildClassifierState(branch, {
				currentTitle: current,
				userTurns,
				turnsSinceTitle,
				maxMessages: config.classifierMessages,
				maxChars: config.maxStateChars,
			});
			const payload = {
				currentTitle: state.currentTitle,
				userTurns: state.userTurns,
				turnsSinceTitle: state.turnsSinceTitle,
				recentMessages: state.recentMessages,
				...(state.firstUserMessage
					? { firstUserMessage: state.firstUserMessage }
					: {}),
			};

			const result = await classifyRenameNeed(
				ctx,
				lookup.model,
				payload,
				classifierSignal,
			);
			if (token !== runToken) return;
			if (!result.ok) {
				log(config, `classifier ${lookup.label} failed: ${result.error}`);
				return;
			}
			log(
				config,
				`classifier ${result.model} p(rename)=${result.probability.toFixed(3)}`,
			);
			if (result.probability < config.askThreshold) return;

			const context = buildTitleContext(branch, {
				maxMessages: config.titleMessages,
				maxChars: config.maxTitleContextChars,
				includeTools: config.titleIncludeTools,
			});
			const titleSignal = AbortSignal.any([
				controller.signal,
				AbortSignal.timeout(TITLE_TIMEOUT_MS),
			]);
			const candidate = await generateTitleCandidate(
				ctx,
				config,
				current,
				context,
				titleSignal,
			);
			if (!candidate || token !== runToken) return;

			// A manual rename during generation always wins.
			if ((pi.getSessionName()?.trim() ?? "") !== current) return;

			if (result.probability >= config.autoThreshold) {
				const applied = applyTitle(
					pi,
					ctx,
					config,
					candidate.title,
					candidate.model,
					current,
				);
				if (applied) {
					renames++;
					turnsSinceTitle = 0;
					turnsSinceCheck = 0;
					lastDismissed = "";
				}
				return;
			}

			if (prompts >= config.maxPrompts) return;
			if (tokenHash(candidate.title) === lastDismissed) return;
			if (!isUiIdle(ctx)) return;

			const outcome = await askToApply(
				pi,
				ctx,
				config,
				candidate,
				current,
			);
			if (token !== runToken) return;
			if (outcome === "applied") {
				renames++;
				turnsSinceTitle = 0;
				turnsSinceCheck = 0;
				lastDismissed = "";
				prompts++;
			} else if (outcome === "kept") {
				prompts++;
				lastDismissed = tokenHash(candidate.title);
				turnsSinceCheck = 0;
			}
		} catch (error) {
			log(
				config,
				`refresh failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			if (active === controller) active = undefined;
			handling = false;
		}
	}

	async function generateInitialTitle(
		ctx: ExtensionContext,
		config: SessionNameConfig,
		token: number,
	): Promise<void> {
		const controller = new AbortController();
		active = controller;
		try {
			const branch = ctx.sessionManager.getBranch();
			const context = buildTitleContext(branch, {
				maxMessages: config.titleMessages,
				maxChars: config.maxTitleContextChars,
				includeTools: config.titleIncludeTools,
			});
			const signal = AbortSignal.any([
				controller.signal,
				AbortSignal.timeout(TITLE_TIMEOUT_MS),
			]);
			const candidate = await generateTitleCandidate(
				ctx,
				config,
				"",
				context,
				signal,
			);
			if (!candidate || token !== runToken) return;
			if (applyTitle(pi, ctx, config, candidate.title, candidate.model, "")) {
				renames++;
				turnsSinceTitle = 0;
				turnsSinceCheck = 0;
			}
		} catch (error) {
			log(
				config,
				`initial title failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			if (active === controller) active = undefined;
		}
	}

	pi.registerCommand("session-name", {
		description:
			"Show or set the session name; /session-name auto regenerates it now",
		handler: async (args, ctx) => {
			const value = args.trim();
			if (!value) {
				const current = pi.getSessionName()?.trim();
				ctx.ui.notify(
					current ? `Session: ${current}` : "No session name set",
					"info",
				);
				return;
			}
			if (value.toLowerCase() === "auto") {
				cancelActive();
				await forceRefresh(pi, ctx);
				return;
			}
			cancelActive();
			pi.setSessionName(value);
			markManualTitle(pi, value);
			ctx.ui.notify(`Session name: ${value}`, "info");
		},
	});
}
