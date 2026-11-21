// Tianshu (天枢 / rivet harness) picks the model it starts on from
// ~/.rivet/config.json, in two keys together: `provider.default` names the
// provider, and `agent.defaultModel` is "<providerKey>:<modelId>", where the
// id must be one of that provider's own `models`. So magpie goes in under a
// provider of its own, "magpie", whose baseUrl is the gateway's /v1, and
// `agent.defaultModel` is that provider key plus the id this module's
// `prefix` puts in front of.
//
// Everything below is written in rivet's names, not magpie's: rivet reads
// `contextWindow` / `maxTokens` / `supportsVision` and prices per *million*
// tokens, while magpie hands over `context` / `output` / `images` and prices
// per *token*. A capacity magpie does not know is left out rather than
// written as 0 — rivet infers a missing size from the model id, but reads 0
// as "no budget at all".

const PROVIDER_KEY = "magpie";
const MODEL_PREFIX = "magpie:";

// rivet's own ladder has five rungs (off / low / medium / high / max) and a
// provider may advertise more or spell them differently. Rather than dropping
// rungs it has no name for, rivet maps a rung through "effortCap" — which is
// how Tianshu's own /models probe handles it too (src/api/model-probe-enrichment.ts):
// the provider's list goes over as-is, and the odd rungs get a wire spelling
// beside them.
function reasoningCapabilities(efforts) {
  if (!Array.isArray(efforts)) return undefined;
  const levels = [...new Set(efforts.filter((e) => typeof e === "string" && e))];
  if (!levels.length) return undefined;
  const effortCap = {};
  if (levels.includes("xhigh") && !levels.includes("max")) effortCap.max = "xhigh";
  if (levels.includes("minimal") && !levels.includes("low")) effortCap.low = "minimal";
  return {
    // an OpenAI-compatible endpoint carries the rung in reasoning_effort
    effortFormat: "reasoning_effort",
    effortLevels: levels,
    ...(Object.keys(effortCap).length ? { effortCap } : {}),
  };
}

export const agent = {
  id: "tianshu",
  name: "天枢 Tianshu",
  // Tianshu's own command: tianshu-harness puts `tianshu` (and `rivet`, the
  // same entry point) on PATH. `agent.dir` stays unset on purpose —
  // ~/.rivet is where Tianshu keeps its settings, which is evidence of its
  // config, not evidence that the agent is installed.
  bin: "tianshu",
  aliases: ["rivet"],
  config: "~/.rivet/config.json",
  format: "json",
  // magpie writes this module's prefix plus its model id, as rivet spells it.
  model: "agent.defaultModel",
  prefix: MODEL_PREFIX,
  // rivet sends "Tianshu/1.0 (terminal coding agent)" by default; usage
  // groups Tianshu's requests by these words of that User-Agent.
  ua: ["tianshu", "rivet"],
  notice:
    "天枢在新的会话读取配置：重启天枢或新开一个会话后生效。 / Tianshu reads its config when a session starts: restart Tianshu or open a new session.",
};

/** A token count magpie actually knows; 0 and non-integers mean "unknown". */
function tokens(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** magpie's dollars per token as rivet's dollars per million tokens. */
function perMillion(value) {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n) || n < 0) return undefined;
  // 0.000001 * 1e6 lands on 1.0000000000000002; toPrecision keeps the cents
  // magpie actually sent instead of that artefact.
  return Number((n * 1e6).toPrecision(12));
}

/** One of magpie's models, as a rivet model entry — or undefined if it has no id. */
function modelEntry(model) {
  if (!model || typeof model.id !== "string" || !model.id) return undefined;

  const entry = { id: model.id };

  const context = tokens(model.context);
  if (context !== undefined) entry.contextWindow = context;
  const output = tokens(model.output);
  if (output !== undefined) entry.maxTokens = output;
  // rivet declares image input per model, and only on an explicit yes.
  if (model.images === true) entry.supportsVision = true;

  // rivet's ladder is five rungs; rungs past it go over with a wire spelling beside them
  const capabilities = reasoningCapabilities(model.efforts);
  if (capabilities) entry.capabilities = capabilities;

  // rivet keeps prices per million tokens under its own, shorter names; each
  // one magpie knows goes over, and the ones it does not stay absent.
  if (model.pricing && typeof model.pricing === "object") {
    const pricing = {};
    const input = perMillion(model.pricing.prompt);
    if (input !== undefined) pricing.input = input;
    const out = perMillion(model.pricing.completion);
    if (out !== undefined) pricing.output = out;
    const cacheRead = perMillion(model.pricing.input_cache_read);
    if (cacheRead !== undefined) pricing.cacheRead = cacheRead;
    const cacheWrite = perMillion(model.pricing.input_cache_write);
    if (cacheWrite !== undefined) pricing.cacheWrite = cacheWrite;
    if (Object.keys(pricing).length) entry.pricing = pricing;
  }

  // a model magpie has retired is flagged rather than silently offered
  if (model.status === "deprecated") {
    entry.deprecated = true;
    if (typeof model.deprecationNote === "string" && model.deprecationNote) {
      entry.deprecationNote = model.deprecationNote;
    }
  }

  return entry;
}

export function connect({ gateway, models } = {}) {
  // A gateway missing either half wires Tianshu to nothing while leaving its
  // config pointing somewhere: fail before writing, not after.
  if (!gateway || typeof gateway.v1 !== "string" || !gateway.v1) {
    throw new Error("Magpie's gateway gave Tianshu no /v1 address to send requests to.");
  }
  if (typeof gateway.key !== "string" || !gateway.key) {
    throw new Error("Magpie's gateway gave Tianshu no key to send requests with.");
  }

  // The provider is written whole, so every model magpie offers is listed
  // again: a model picked in Tianshu since is one of magpie's own.
  const list = (Array.isArray(models) ? models : []).map(modelEntry).filter(Boolean);

  const provider = {
    name: "magpie",
    baseUrl: gateway.v1,
    protocol: "openai",
    apiKey: gateway.key,
  };
  // no models rather than an empty list, which rivet reads as a provider
  // that can serve nothing
  if (list.length) provider.models = list;

  return {
    "provider.default": PROVIDER_KEY,
    [`provider.providers.${PROVIDER_KEY}`]: provider,
  };
}

// Tests reach these without the host ever running them.
export const _internal = { modelEntry, perMillion, reasoningCapabilities };
