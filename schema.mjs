// Pure schema and channel-mapping helpers for Tianshu (rivet harness) 4.1.54+.
//
// Invariants verified against Tianshu-harness v4.1.54:
// - `provider.name` MUST equal the provider map key in `provider.providers`:
//   `stripProviderKeys()` indexes `provider-keys.json` by `provider.name`,
//   while `injectProviderKeys()` reads by map key, and `resolveCredentials()`
//   compares `ctx.provider?.name === providerKey`.
// - Loopback / private network endpoints require `endpointNetworkPolicy` with
//   `origin === new URL(baseUrl).origin` and `allowPrivateNetwork: true`
//   (src/config/endpoint-network-schema.ts, src/tools/net/endpoint-policy.ts).
// - Models are split by subscription prefix (`<software>/<model>`) into
//   `<software>-magpie` channels (`auto/<model>` and bare ids -> `auto-magpie`),
//   never claiming the literal `"magpie"` key so existing manual providers are
//   never overwritten or shadowed.

import crypto from "node:crypto";
import net from "node:net";

export const AUTO_CHANNEL = "auto-magpie";
export const CHANNEL_SUFFIX = "-magpie";
export const ROUTING_PREFIX = "auto";

const MANAGED_KEY_RE = /^[a-z0-9][a-z0-9-]*-magpie$/;

/** Maps a Magpie model id to its Tianshu provider key (`<software>-magpie` or `auto-magpie`). */
export function channelKeyFor(modelId) {
  if (typeof modelId !== "string") return AUTO_CHANNEL;
  const trimmed = modelId.trim();
  const at = trimmed.indexOf("/");
  if (at <= 0 || at === trimmed.length - 1) return AUTO_CHANNEL;
  const software = trimmed.slice(0, at);
  if (software.toLowerCase() === ROUTING_PREFIX) return AUTO_CHANNEL;
  const slug = software
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}${CHANNEL_SUFFIX}` : AUTO_CHANNEL;
}

/** Reports whether a provider key belongs to this plugin's managed namespace. */
export function isManagedChannelKey(key) {
  return typeof key === "string" && key.length > CHANNEL_SUFFIX.length && MANAGED_KEY_RE.test(key);
}

/** Validates an HTTP(S) gateway base URL and returns a parsed URL instance. */
export function parseGatewayUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("Invalid Magpie gateway URL: missing baseURL.");
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("Invalid Magpie gateway URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Invalid Magpie gateway URL: must be plain http(s) without credentials, query, or hash.");
  }
  return url;
}

const PRIVATE_NETS = new net.BlockList();
PRIVATE_NETS.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE_NETS.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE_NETS.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE_NETS.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE_NETS.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE_NETS.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE_NETS.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE_NETS.addSubnet("::1", 128, "ipv6");
PRIVATE_NETS.addSubnet("::", 128, "ipv6");
PRIVATE_NETS.addSubnet("fc00::", 7, "ipv6");
PRIVATE_NETS.addSubnet("fe80::", 10, "ipv6");

function extractMappedIPv4(ipv6) {
  const dotted = ipv6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted && net.isIP(dotted[1]) === 4) return dotted[1];
  // WHATWG URL normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1 (two hex 16-bit groups)
  const hex = ipv6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  const family = net.isIP(host);
  if (family === 4) return PRIVATE_NETS.check(host, "ipv4");
  if (family === 6) {
    const mapped = extractMappedIPv4(host);
    if (mapped) return PRIVATE_NETS.check(mapped, "ipv4");
    return PRIVATE_NETS.check(host, "ipv6");
  }
  return false;
}

/**
 * Returns Tianshu 4.1.54's `endpointNetworkPolicy` for local/private gateways,
 * bound strictly to `url.origin`, or undefined for public endpoints.
 */
export function endpointNetworkPolicyFor(baseUrl) {
  const url = parseGatewayUrl(baseUrl);
  if (!isPrivateHost(url.hostname)) return undefined;
  return {
    origin: url.origin,
    allowPrivateNetwork: true,
  };
}

/** Positive integer token count; 0 or non-integers mean unknown. */
export function positiveInt(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Converts Magpie's dollars-per-token to Tianshu's dollars-per-million-tokens without float noise. */
export function perMillion(value) {
  if (value === null || value === undefined || typeof value === "boolean") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return undefined;
  return Number((n * 1e6).toPrecision(12));
}

/** Builds Tianshu 4.1.54 `modelCapabilitiesSchema` for a reasoning model. */
export function reasoningCapabilities(efforts) {
  if (!Array.isArray(efforts)) return undefined;
  const levels = [...new Set(efforts.filter((e) => typeof e === "string" && e.trim()).map((e) => e.trim()))];
  if (!levels.length) return undefined;
  const effortCap = {};
  if (levels.includes("xhigh") && !levels.includes("max")) effortCap.max = "xhigh";
  if (levels.includes("minimal") && !levels.includes("low")) effortCap.low = "minimal";
  return {
    effortFormat: "reasoning_effort",
    effortLevels: levels,
    reasoningSplit: true,
    ...(Object.keys(effortCap).length ? { effortCap } : {}),
  };
}

/** Maps one Magpie model entry strictly into Tianshu 4.1.54 `modelConfigSchema`. */
export function buildTianshuModel(model) {
  if (!model || typeof model !== "object" || typeof model.id !== "string" || !model.id.trim()) {
    return undefined;
  }

  const entry = { id: model.id.trim() };

  const context = positiveInt(model.context);
  if (context !== undefined) entry.contextWindow = context;

  const output = positiveInt(model.output);
  if (output !== undefined) {
    entry.maxTokens = context !== undefined ? Math.min(output, context) : output;
  }

  if (model.images === true) entry.supportsVision = true;

  const capabilities = reasoningCapabilities(model.efforts);
  if (capabilities) entry.capabilities = capabilities;

  if (model.pricing && typeof model.pricing === "object" && !Array.isArray(model.pricing)) {
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

  if (model.status === "deprecated") {
    entry.deprecated = true;
    if (typeof model.deprecationNote === "string" && model.deprecationNote.trim()) {
      entry.deprecationNote = model.deprecationNote.trim();
    }
  }

  return entry;
}

/** Deterministic JSON stringification with sorted object keys. */
export function canonicalJSON(value) {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted = {};
      for (const k of Object.keys(v).sort()) {
        if (v[k] !== undefined) sorted[k] = v[k];
      }
      return sorted;
    }
    return v;
  });
}

/**
 * Translates Magpie's `connection.json` control payload into the desired
 * Tianshu 4.1.54+ provider map and default model selection.
 *
 * Returns `null` when disconnected (neither gatewayKey nor baseURL present).
 */
export function buildTianshuDesired(control) {
  if (!control || typeof control !== "object" || Array.isArray(control)) return null;

  const hasGateway = typeof control.gatewayKey === "string" && control.gatewayKey.trim().length > 0;
  const hasBase = typeof control.baseURL === "string" && control.baseURL.trim().length > 0;
  const hasModel = typeof control.model === "string" && control.model.trim().length > 0;

  if (!hasGateway && !hasBase) {
    if (hasModel) {
      throw new Error("Incomplete Magpie connection: model is set without gateway baseURL/gatewayKey.");
    }
    return null;
  }
  if (!hasGateway || !hasBase) {
    throw new Error("Incomplete Magpie connection: both baseURL and gatewayKey are required.");
  }

  const baseUrl = parseGatewayUrl(control.baseURL).href.replace(/\/+$/, "");
  const gatewayKey = control.gatewayKey;
  if (/[\r\n]/.test(gatewayKey)) {
    throw new Error("Invalid Magpie gateway key: contains line breaks.");
  }

  const networkPolicy = endpointNetworkPolicyFor(baseUrl);

  const order = [];
  const buckets = new Map();
  const seenPerChannel = new Map();

  const addModel = (rawModel) => {
    const entry = buildTianshuModel(rawModel);
    if (!entry) return;
    const key = channelKeyFor(entry.id);
    if (!buckets.has(key)) {
      buckets.set(key, []);
      seenPerChannel.set(key, new Set());
      order.push(key);
    }
    const seen = seenPerChannel.get(key);
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    buckets.get(key).push(entry);
  };

  if (control.models !== undefined && control.models !== null && !Array.isArray(control.models)) {
    throw new Error("Invalid Magpie control file: models must be a list.");
  }
  for (const m of control.models ?? []) addModel(m);

  // Ensure the explicitly picked model always exists in its channel so
  // `provider.default` and `agent.defaultModel` satisfy assertDefaultModelRef.
  // Only reuse `control.modelInfo` when it actually belongs to `selectedId`
  // (or carries no id); never copy another model's limits/pricing onto it.
  const selectedId = hasModel ? control.model.trim() : "";
  if (selectedId) {
    const key = channelKeyFor(selectedId);
    const already = seenPerChannel.get(key)?.has(selectedId);
    if (!already) {
      const hasRawInfo = control.modelInfo && typeof control.modelInfo === "object" && !Array.isArray(control.modelInfo);
      const infoMatches =
        hasRawInfo && (control.modelInfo.id === undefined || control.modelInfo.id === "" || control.modelInfo.id === selectedId);
      const info = infoMatches ? { ...control.modelInfo, id: selectedId } : { id: selectedId };
      addModel(info);
    }
  }

  const providersByKey = {};
  for (const key of order) {
    const models = buckets.get(key);
    const hasReasoning = models.some((m) => m.capabilities?.effortFormat === "reasoning_effort");
    const provider = {
      // Must match map key: 4.1.54 stripProviderKeys / resolveCredentials rely on it.
      name: key,
      baseUrl,
      ...(networkPolicy ? { endpointNetworkPolicy: networkPolicy } : {}),
      protocol: "openai",
      apiKey: gatewayKey,
      ...(hasReasoning ? { capabilities: { effortFormat: "reasoning_effort", reasoningSplit: true } } : {}),
      ...(models.length ? { models } : {}),
      userSaved: true,
    };
    providersByKey[key] = provider;
  }

  if (order.length === 0) {
    providersByKey[AUTO_CHANNEL] = {
      name: AUTO_CHANNEL,
      baseUrl,
      ...(networkPolicy ? { endpointNetworkPolicy: networkPolicy } : {}),
      protocol: "openai",
      apiKey: gatewayKey,
      userSaved: true,
    };
    order.push(AUTO_CHANNEL);
  }

  let defaultProvider;
  let defaultModel;
  if (selectedId) {
    defaultProvider = channelKeyFor(selectedId);
    defaultModel = `${defaultProvider}:${selectedId}`;
  } else {
    const firstWithModels = order.find((k) => Array.isArray(providersByKey[k].models) && providersByKey[k].models.length > 0);
    defaultProvider = firstWithModels ?? order[0];
    if (firstWithModels) {
      defaultModel = `${firstWithModels}:${providersByKey[firstWithModels].models[0].id}`;
    }
  }

  const hash = crypto
    .createHash("sha256")
    .update(canonicalJSON({ baseUrl, gatewayKey, providersByKey, defaultProvider, defaultModel }))
    .digest("hex");

  return {
    baseUrl,
    gatewayKey,
    providersByKey,
    channelKeys: order,
    defaultProvider,
    defaultModel,
    hash,
  };
}

// Tianshu 4.1.54 schema defaults applied by `modelConfigSchema.transform(...)`
// when loading and saving models into `provider-keys.json`.
const DEFAULT_CONTEXT_WINDOW = 524_288;
const DEFAULT_MAX_TOKENS = 65_536;

export function inferModelContextWindow(modelId) {
  const match = String(modelId).toLowerCase().match(/(\d+)\s*([km])(?=$|[-_.\s@:])/);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0 || n > 4096) return undefined;
  return match[2] === "k" ? n * 1024 : n * 1024 * 1024;
}

/** Projects a model entry to Tianshu's post-Zod transformed shape for convergence comparison. */
export function normalizeModelForCompare(model) {
  if (!model || typeof model !== "object" || typeof model.id !== "string") return null;
  const contextWindow =
    positiveInt(model.contextWindow) ?? inferModelContextWindow(model.id) ?? DEFAULT_CONTEXT_WINDOW;
  const rawMax = positiveInt(model.maxTokens) ?? DEFAULT_MAX_TOKENS;
  const maxTokens = Math.min(rawMax, contextWindow);
  const out = { id: model.id, contextWindow, maxTokens };
  if (model.supportsVision === true) out.supportsVision = true;
  if (model.deprecated === true) out.deprecated = true;
  if (typeof model.deprecationNote === "string" && model.deprecationNote) {
    out.deprecationNote = model.deprecationNote;
  }
  if (model.pricing && typeof model.pricing === "object") {
    const pricing = {};
    for (const k of ["input", "output", "cacheRead", "cacheWrite", "reasoning", "free"]) {
      if (model.pricing[k] !== undefined) pricing[k] = model.pricing[k];
    }
    if (Object.keys(pricing).length) out.pricing = pricing;
  }
  if (model.capabilities && typeof model.capabilities === "object") {
    const caps = {};
    for (const k of [
      "thinkingBlock",
      "effortFormat",
      "effortCap",
      "effortLevels",
      "reasoningSplit",
      "thinkingBudgetField",
      "preservedThinkingProtocol",
    ]) {
      if (model.capabilities[k] !== undefined) caps[k] = model.capabilities[k];
    }
    if (Object.keys(caps).length) out.capabilities = caps;
  }
  return out;
}

/** Checks whether a live model list matches our desired model list after Tianshu 4.1.54 schema defaults. */
export function modelsEquivalent(liveModels, desiredModels) {
  const live = Array.isArray(liveModels) ? liveModels : [];
  const want = Array.isArray(desiredModels) ? desiredModels : [];
  if (live.length !== want.length) return false;
  for (let i = 0; i < want.length; i++) {
    if (canonicalJSON(normalizeModelForCompare(live[i])) !== canonicalJSON(normalizeModelForCompare(want[i]))) {
      return false;
    }
  }
  return true;
}

/**
 * Checks whether a live provider entry in Tianshu's `config.json` already
 * satisfies our desired provider (accounting for Tianshu 4.1.54 migrating
 * inline `apiKey` -> `keyRef: <providerKey>` and adding schema defaults).
 */
export function providerEquivalent(key, live, want, { allowKeyRef = false } = {}) {
  if (!live || typeof live !== "object" || Array.isArray(live)) return false;
  if (live.name !== want.name) return false;
  if (live.baseUrl !== want.baseUrl) return false;
  if ((live.protocol ?? "openai") !== want.protocol) return false;

  const livePolicy = live.endpointNetworkPolicy ?? null;
  const wantPolicy = want.endpointNetworkPolicy ?? null;
  if (canonicalJSON(livePolicy) !== canonicalJSON(wantPolicy)) return false;

  const hasInlineKey =
    typeof live.apiKey === "string" &&
    live.apiKey === want.apiKey &&
    !live.keyRef &&
    !live.apiKeyEnv;
  const hasMigratedKeyRef = allowKeyRef && live.keyRef === key && !live.apiKey && !live.apiKeyEnv;
  if (!hasInlineKey && !hasMigratedKeyRef) return false;

  if (want.capabilities) {
    const liveCaps = live.capabilities && typeof live.capabilities === "object" ? live.capabilities : {};
    for (const [ck, cv] of Object.entries(want.capabilities)) {
      if (canonicalJSON(liveCaps[ck]) !== canonicalJSON(cv)) return false;
    }
  }

  return modelsEquivalent(live.models, want.models);
}
