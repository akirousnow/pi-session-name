import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

export type SessionNameConfig = {
	enabled: boolean;
	classifier: string;
	titleModel: string;
	autoThreshold: number;
	minTurnsBetweenChecks: number;
	minTurnsBetweenRenames: number;
	maxRenames: number;
	classifierMessages: number;
	titleMessages: number;
	maxStateChars: number;
	maxTitleContextChars: number;
	maxTitleLength: number;
	scopeMaxLength: number;
	useTags: boolean;
	extraTags: string[];
	titleIncludeTools: boolean;
	classifierTimeoutMs: number;
	debug: boolean;
};

export const DEFAULT_CONFIG: SessionNameConfig = {
	enabled: true,
	classifier: "typesafe/jev-latest",
	titleModel: "auto",
	autoThreshold: 0.9,
	minTurnsBetweenChecks: 2,
	minTurnsBetweenRenames: 4,
	maxRenames: 8,
	classifierMessages: 6,
	titleMessages: 20,
	maxStateChars: 6_000,
	maxTitleContextChars: 12_000,
	maxTitleLength: 52,
	scopeMaxLength: 12,
	useTags: true,
	extraTags: [],
	titleIncludeTools: false,
	classifierTimeoutMs: 20_000,
	debug: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
	return isRecord(value) ? value : {};
}

function asString(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asInt(value: unknown, fallback: number, minimum = 0): number {
	return Math.max(minimum, Math.floor(asNumber(value, fallback)));
}

function asThreshold(value: unknown, fallback: number): number {
	return Math.min(1, Math.max(0, asNumber(value, fallback)));
}

export function normalizeConfig(raw: Record<string, unknown>): SessionNameConfig {
	const autoThreshold = asThreshold(
		raw.autoThreshold,
		DEFAULT_CONFIG.autoThreshold,
	);
	const minTurnsBetweenChecks = asInt(
		raw.minTurnsBetweenChecks,
		DEFAULT_CONFIG.minTurnsBetweenChecks,
		1,
	);
	const minTurnsBetweenRenames = Math.max(
		minTurnsBetweenChecks,
		asInt(raw.minTurnsBetweenRenames, DEFAULT_CONFIG.minTurnsBetweenRenames, 1),
	);
	const extraTags = Array.isArray(raw.extraTags)
		? raw.extraTags
				.filter((tag): tag is string => typeof tag === "string")
				.map((tag) => tag.trim().toLowerCase())
				.filter(Boolean)
				.slice(0, 100)
		: DEFAULT_CONFIG.extraTags;

	return {
		enabled: asBoolean(raw.enabled, DEFAULT_CONFIG.enabled),
		classifier: asString(raw.classifier, DEFAULT_CONFIG.classifier),
		titleModel: asString(raw.titleModel, DEFAULT_CONFIG.titleModel),
		autoThreshold,
		minTurnsBetweenChecks,
		minTurnsBetweenRenames,
		maxRenames: asInt(raw.maxRenames, DEFAULT_CONFIG.maxRenames),
		classifierMessages: asInt(
			raw.classifierMessages,
			DEFAULT_CONFIG.classifierMessages,
			1,
		),
		titleMessages: asInt(raw.titleMessages, DEFAULT_CONFIG.titleMessages, 1),
		maxStateChars: asInt(
			raw.maxStateChars,
			DEFAULT_CONFIG.maxStateChars,
			500,
		),
		maxTitleContextChars: asInt(
			raw.maxTitleContextChars,
			DEFAULT_CONFIG.maxTitleContextChars,
			1_000,
		),
		maxTitleLength: asInt(raw.maxTitleLength, DEFAULT_CONFIG.maxTitleLength, 8),
		scopeMaxLength: asInt(
			raw.scopeMaxLength,
			DEFAULT_CONFIG.scopeMaxLength,
			1,
		),
		useTags: asBoolean(raw.useTags, DEFAULT_CONFIG.useTags),
		extraTags,
		titleIncludeTools: asBoolean(
			raw.titleIncludeTools,
			DEFAULT_CONFIG.titleIncludeTools,
		),
		classifierTimeoutMs: asInt(
			raw.classifierTimeoutMs,
			DEFAULT_CONFIG.classifierTimeoutMs,
			1_000,
		),
		debug: asBoolean(raw.debug, DEFAULT_CONFIG.debug),
	};
}

export function loadConfig(cwd: string): SessionNameConfig {
	try {
		const manager = SettingsManager.create(cwd, getAgentDir());
		const globalSettings = asRecord(manager.getGlobalSettings());
		const projectSettings = asRecord(manager.getProjectSettings());
		const raw = {
			...asRecord(globalSettings.sessionName),
			...asRecord(projectSettings.sessionName),
		};
		return normalizeConfig(raw);
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function isDebugEnabled(config: SessionNameConfig): boolean {
	return config.debug || Boolean(process.env.PI_DEBUG_SESSION_NAME);
}
