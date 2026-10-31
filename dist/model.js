export const NEXT_PROMPT_AGENT_IDS = ["next-prompt", "next_prompt"];
const TITLE_AGENT_IDS = ["title"];
const VARIANT_ORDER = ["none", "minimal", "min", "low", "medium", "high", "xhigh", "max"];
/**
 * Resolve the model used for a prediction. Every configured model (options,
 * next-prompt agent, title agent) is validated before use; an invalid title
 * model falls back to the session model with a warning instead of silently
 * breaking predictions.
 */
export function resolvePredictionModel(input) {
    const models = input.context.data.location.model.list(input.location);
    const providers = input.context.data.location.provider.list(input.location);
    const agents = input.context.data.location.agent?.list(input.location) ?? [];
    const variantDisabled = input.variant === "default";
    const configuredVariant = variantDisabled ? undefined : input.variant;
    if (input.spec) {
        const parsed = parseSpec(input.spec);
        if (!parsed.id)
            return { model: undefined, issue: "model config error: empty model id" };
        const provider = resolveProvider(parsed, input.sessionModel, agents, models);
        if (!provider.providerID)
            return { model: undefined, issue: provider.issue };
        const checked = checkModel(provider.providerID, parsed.id, models, providers);
        if (checked.issue)
            return { model: undefined, issue: checked.issue };
        const variant = resolveVariant(variantDisabled ? undefined : (configuredVariant ?? parsed.variant), checked.model, !variantDisabled);
        if (variant.issue)
            return { model: undefined, issue: variant.issue };
        return {
            model: {
                providerID: provider.providerID,
                id: checked.model?.id ?? parsed.id,
                variant: variant.variant,
                source: "options",
                model: checked.model,
            },
        };
    }
    const nextPrompt = findAgent(agents, NEXT_PROMPT_AGENT_IDS);
    if (nextPrompt?.model) {
        return resolveConfigured(nextPrompt.model, "agent:next-prompt", configuredVariant, variantDisabled, models, providers);
    }
    const title = findAgent(agents, TITLE_AGENT_IDS);
    if (title?.model) {
        const resolved = resolveConfigured(title.model, "agent:title", configuredVariant, variantDisabled, models, providers);
        if (resolved.model)
            return resolved;
        const fallback = resolveSession(input.sessionModel, configuredVariant, variantDisabled, models);
        const using = fallback.model
            ? `the session model (${fallback.model.providerID}/${fallback.model.id})`
            : "the server default";
        return {
            model: fallback.model,
            warning: `${resolved.issue ?? "title model unavailable"}; using ${using}${fallback.issue ? `; ${fallback.issue}` : ""}`,
        };
    }
    return resolveSession(input.sessionModel, configuredVariant, variantDisabled, models);
}
export function parseSpec(spec) {
    const hash = spec.indexOf("#");
    const base = hash >= 0 ? spec.slice(0, hash) : spec;
    const variant = hash >= 0 && hash < spec.length - 1 ? spec.slice(hash + 1) : undefined;
    const slash = base.indexOf("/");
    if (slash > 0 && slash < base.length - 1) {
        return { providerID: base.slice(0, slash), id: base.slice(slash + 1), variant };
    }
    return { id: base, variant };
}
function resolveConfigured(model, source, configuredVariant, variantDisabled, models, providers) {
    if (!model.providerID || !model.id)
        return { model: undefined, issue: "model config error: incomplete model reference" };
    const checked = checkModel(model.providerID, model.id, models, providers);
    if (checked.issue)
        return { model: undefined, issue: checked.issue };
    const variant = resolveVariant(variantDisabled ? undefined : (configuredVariant ?? model.variant), checked.model, !variantDisabled);
    if (variant.issue)
        return { model: undefined, issue: variant.issue };
    return {
        model: {
            providerID: model.providerID,
            id: checked.model?.id ?? model.id,
            variant: variant.variant,
            source,
            model: checked.model,
        },
    };
}
function resolveSession(model, configuredVariant, variantDisabled, models) {
    if (!model?.providerID || !model.id)
        return { model: undefined };
    const found = models?.find((item) => item.providerID === model.providerID && modelMatches(item, model.id));
    const variant = resolveVariant(variantDisabled ? undefined : configuredVariant, found, !variantDisabled);
    if (variant.issue)
        return { model: undefined, issue: variant.issue };
    return {
        model: {
            providerID: model.providerID,
            id: found?.id ?? model.id,
            variant: variant.variant,
            source: "session",
            model: found,
        },
    };
}
function resolveProvider(parsed, sessionModel, agents, models) {
    if (parsed.providerID)
        return { providerID: parsed.providerID };
    const configured = findAgent(agents, NEXT_PROMPT_AGENT_IDS) ?? findAgent(agents, TITLE_AGENT_IDS);
    const providerID = sessionModel?.providerID ?? configured?.model?.providerID;
    if (providerID)
        return { providerID };
    const matching = new Set((models ?? []).filter((item) => modelMatches(item, parsed.id)).map((item) => item.providerID));
    if (matching.size === 1)
        return { providerID: [...matching][0] };
    if (matching.size > 1) {
        return {
            issue: `model config error: model "${parsed.id}" exists on multiple providers (${[...matching].join(", ")}); specify provider/model`,
        };
    }
    return { issue: `model config error: no provider configured for model "${parsed.id}"; specify provider/model` };
}
function checkModel(providerID, id, models, providers) {
    if (providers && providers.length > 0 && !providers.some((item) => item.id === providerID)) {
        const available = providers.map((item) => item.id).join(", ");
        return {
            issue: `model config error: provider "${providerID}" not found${available ? ` (available providers: ${available})` : ""}`,
        };
    }
    if (!models)
        return {};
    const found = models.find((item) => item.providerID === providerID && modelMatches(item, id));
    if (found)
        return { model: found };
    const onProvider = models.filter((item) => item.providerID === providerID);
    const available = onProvider
        .slice(0, 10)
        .map((item) => item.id)
        .join(", ");
    return {
        issue: `model config error: model "${id}" not found on provider "${providerID}"${available ? ` (available models: ${available}${onProvider.length > 10 ? ", ..." : ""})` : ""}`,
    };
}
function resolveVariant(requested, model, auto) {
    const variants = model?.variants?.map((item) => item.id) ?? [];
    if (requested) {
        if (variants.length > 0 && !variants.includes(requested)) {
            return {
                issue: `model config error: variant "${requested}" not found on model "${model?.id}" (available variants: ${variants.join(", ")})`,
            };
        }
        return { variant: requested };
    }
    if (!auto || variants.length === 0)
        return {};
    return { variant: [...variants].sort((a, b) => variantRank(a) - variantRank(b))[0] };
}
function findAgent(agents, ids) {
    return agents.find((agent) => ids.includes(agent.id) && agent.model !== undefined);
}
function modelMatches(model, id) {
    return model.id === id || model.modelID === id || model.canonical === id;
}
function variantRank(name) {
    const index = VARIANT_ORDER.indexOf(name.toLowerCase());
    return index === -1 ? VARIANT_ORDER.length : index;
}
