import type { ClassifierApi, ClassifierModel, JsonObject } from "@earendil-works/pi-ai";
import type { ExtensionContext as PiExtensionContext } from "@earendil-works/pi-coding-agent";

// Keep the import above type-only; runtime classifier access goes through
// ctx.modelRegistry so pi can resolve request-time auth and provider config.
export type ClassifierRef = {
	provider: string;
	id: string;
};

export type ClassifierLookup = {
	model: ClassifierModel<ClassifierApi>;
	label: string;
};

export function parseClassifierRef(
	value: string | undefined,
): ClassifierRef | undefined {
	const trimmed = value?.trim();
	if (!trimmed || trimmed === "auto") return undefined;
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) return undefined;
	const provider = trimmed.slice(0, slash);
	const id = trimmed.slice(slash + 1);
	if (!provider || !id) return undefined;
	return { provider, id };
}

export function createClassifierResolver() {
	let autoCache:
		| Promise<readonly ClassifierModel<ClassifierApi>[]>
		| undefined;
	let autoLoadedAt = 0;

	return async function resolveClassifier(
		ctx: PiExtensionContext,
		classifierConfig: string,
	): Promise<ClassifierLookup | undefined> {
		const ref = parseClassifierRef(classifierConfig);
		if (ref) {
			const model = ctx.modelRegistry.findOfType(
				"classifier",
				ref.provider,
				ref.id,
			);
			return model
				? { model, label: `${ref.provider}/${ref.id}` }
				: undefined;
		}

		// auto: prefer TypeSafe Jev, then any available Jev, then any classifier.
		const now = Date.now();
		if (!autoCache || now - autoLoadedAt > 60_000) {
			autoLoadedAt = now;
			autoCache = ctx.modelRegistry.getAvailableOfType("classifier");
		}
		let models: readonly ClassifierModel<ClassifierApi>[];
		try {
			models = await autoCache;
		} catch {
			autoCache = undefined;
			return undefined;
		}
		const jev = models.find(
			(model) =>
				model.provider === "typesafe" && model.id === "jev-latest",
		);
		const anyJev = models.find((model) => model.id.toLowerCase().includes("jev"));
		const model = jev ?? anyJev ?? models[0];
		return model
			? { model, label: `${model.provider}/${model.id}` }
			: undefined;
	};
}

export type RenameNeedResult =
	| {
			ok: true;
			probability: number;
			model: string;
			usage?: unknown;
	  }
	| { ok: false; error: string };

export async function classifyRenameNeed(
	ctx: PiExtensionContext,
	model: ClassifierModel<ClassifierApi>,
	state: JsonObject,
	signal: AbortSignal,
): Promise<RenameNeedResult> {
	const result = await ctx.modelRegistry.classify(
		model,
		{
			state,
			questions: {
				needsRename: {
					type: "bool",
					instructions:
						"Given the current session title and the recent conversation, has the session's main topic or task changed enough that the title is now materially misleading, too vague, or clearly incomplete?",
					criteria: {
						true: "The session moved to a different feature, bug, component, or task, OR substantial new work makes the old title clearly misleading or incomplete.",
						false: "The conversation continues the same task, clarifies it, or only adds a minor detail or sub-step.",
					},
				},
			},
		},
		{ signal },
	);

	if (result.stopReason !== "stop") {
		return {
			ok: false,
			error:
				result.stopReason === "aborted"
					? "classifier aborted"
					: (result.errorMessage ?? "classifier failed"),
		};
	}

	const answer = result.answers.needsRename;
	if (!answer || answer.type !== "bool") {
		return { ok: false, error: "classifier returned no bool answer" };
	}

	return {
		ok: true,
		probability: Math.min(1, Math.max(0, answer.probability)),
		model: `${result.provider}/${result.model}`,
		usage: result.usage,
	};
}
