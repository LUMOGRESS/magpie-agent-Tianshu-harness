import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  AUTO_CHANNEL,
  buildTianshuDesired,
  buildTianshuModel,
  channelKeyFor,
  endpointNetworkPolicyFor,
  isManagedChannelKey,
  perMillion,
  reasoningCapabilities,
} from "./schema.mjs";
import { _internal, agent, connect, CONTROL_DIR, CONTROL_FILE } from "./tianshu.agent.js";

const gateway = {
  url: "http://127.0.0.1:4321",
  v1: "http://127.0.0.1:4321/v1",
  key: "magpie-tianshu",
};

// Verified against Tianshu-harness v4.1.54 src/config/schema.ts.
// Anything outside these sets is stripped by zod on loadConfig().
const RIVET_MODEL_FIELDS = new Set([
  "id",
  "description",
  "contextWindow",
  "maxTokens",
  "reasoningEffort",
  "supportsVision",
  "supportsVideo",
  "supportsImageGen",
  "imageGen",
  "pricing",
  "tier",
  "deprecated",
  "deprecationNote",
  "capabilities",
]);
const RIVET_PRICING_FIELDS = new Set(["input", "output", "cacheRead", "cacheWrite", "reasoning", "free"]);
const RIVET_CAPABILITY_FIELDS = new Set([
  "thinkingBlock",
  "effortFormat",
  "effortCap",
  "effortLevels",
  "reasoningSplit",
  "thinkingBudgetField",
  "preservedThinkingProtocol",
]);
const RIVET_PROVIDER_FIELDS = new Set([
  "name",
  "apiKey",
  "apiKeyEnv",
  "keyRef",
  "baseUrl",
  "endpointNetworkPolicy",
  "protocol",
  "auth",
  "capabilities",
  "fallback",
  "fallbackModel",
  "allowProFallback",
  "models",
  "keys",
  "userSaved",
  "thinking",
  "maxTokens",
  "unsupported",
]);

function assertRivet4154Shape(mapKey, provider) {
  // 4.1.54 stripProviderKeys indexes provider-keys.json by provider.name while
  // injectProviderKeys reads by map key; they MUST be identical.
  assert.equal(provider.name, mapKey, `provider.name (${provider.name}) must equal map key (${mapKey})`);
  assert.equal(provider.userSaved, true, `provider ${mapKey} should declare userSaved: true`);

  const unknownProvider = Object.keys(provider).filter((k) => !RIVET_PROVIDER_FIELDS.has(k));
  assert.deepEqual(unknownProvider, [], `provider ${mapKey} carries unknown keys: ${unknownProvider.join(", ")}`);

  if (provider.endpointNetworkPolicy) {
    assert.equal(
      provider.endpointNetworkPolicy.origin,
      new URL(provider.baseUrl).origin,
      "endpointNetworkPolicy.origin must strictly equal new URL(baseUrl).origin",
    );
    assert.equal(provider.endpointNetworkPolicy.allowPrivateNetwork, true);
  }

  for (const model of provider.models ?? []) {
    const unknown = Object.keys(model).filter((k) => !RIVET_MODEL_FIELDS.has(k));
    assert.deepEqual(unknown, [], `model ${model.id} carries unknown keys: ${unknown.join(", ")}`);
    if (model.contextWindow !== undefined && model.maxTokens !== undefined) {
      assert.equal(model.maxTokens <= model.contextWindow, true, `model ${model.id} maxTokens exceeds contextWindow`);
    }
    for (const key of Object.keys(model.pricing ?? {})) {
      assert.equal(RIVET_PRICING_FIELDS.has(key), true, `model ${model.id} pricing.${key} is not rivet's`);
    }
    for (const key of Object.keys(model.capabilities ?? {})) {
      assert.equal(RIVET_CAPABILITY_FIELDS.has(key), true, `model ${model.id} capabilities.${key} is not rivet's`);
    }
    if (model.capabilities?.effortLevels) {
      const levels = new Set(model.capabilities.effortLevels);
      const cap = model.capabilities.effortCap ?? {};
      assert.equal(
        Object.values(cap).every((wire) => levels.has(wire)),
        true,
        `model ${model.id} maps a rung to something it does not advertise`,
      );
      assert.equal(model.capabilities.effortFormat, "reasoning_effort");
    }
  }
}

test("agent descriptor points to Magpie control JSON while preserving model picker", () => {
  assert.equal(agent.id, "tianshu");
  assert.equal(agent.bin, "tianshu");
  assert.equal(agent.dir, CONTROL_DIR);
  assert.deepEqual(agent.aliases, ["rivet"]);
  assert.equal(agent.config, CONTROL_FILE);
  assert.equal(agent.format, "json");
  assert.equal(agent.model, "model");
  assert.equal(agent.prefix, undefined);
  assert.deepEqual(agent.ua, ["tianshu", "rivet"]);
});

test("tianshu.agent.js stays pure moejs (no imports, no Node APIs)", async () => {
  const source = await readFile(new URL("./tianshu.agent.js", import.meta.url), "utf8");
  assert.equal(/^\s*import\s+/m.test(source), false, "tianshu.agent.js must not import modules");
  assert.equal(/\brequire\s*\(/.test(source), false, "tianshu.agent.js must not call require()");
  assert.equal(/\bprocess\./.test(source), false, "tianshu.agent.js must not access Node process");
  assert.equal(/node:/.test(source), false, "tianshu.agent.js must not reference node: builtins");
});

test("package.json declares both moejs agent and Bun companion main cleanly", async () => {
  const pkg = await readFile(new URL("./package.json", import.meta.url), "utf8").then(JSON.parse);
  assert.equal(pkg.magpie.agent, "./tianshu.agent.js");
  assert.equal(pkg.main, "./index.mjs");
  assert.equal(pkg.bin["magpie-tianshu"], "cli.mjs");
  assert.equal(pkg.dependencies, undefined);

  assert.match(pkg.magpie.icon, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(pkg.magpie.icon.split(",", 2)[1], "base64").toString("utf8");
  assert.match(svg, /<svg[^>]+viewBox="0 0 1024 1024"/);
  assert.match(svg, /<rect x="40" y="40" width="944" height="944" rx="208"/);
  assert.deepEqual([...svg.matchAll(/(?:href|src)="[^"]*"/g)].map((m) => m[0]), []);
  assert.equal(/url\(['"]?(?:http|https)/.test(svg), false);
  assert.equal(agent.icon, pkg.magpie.icon);

  assert.equal(Buffer.byteLength(pkg.magpie.name, "utf8") <= 80, true);
  for (const lang of ["en", "zh"]) {
    assert.equal(Buffer.byteLength(pkg.magpie.summary[lang], "utf8") <= 300, true);
  }

  for (const required of ["tianshu.agent.js", "index.mjs", "bridge.mjs", "targets.mjs", "schema.mjs", "proc.mjs", "cli.mjs"]) {
    assert.equal(pkg.files.includes(required), true, `files[] must include ${required}`);
  }
});

test("connect() emits clean control payload with top-level gatewayKey for Magpie wiring mark", () => {
  const out = connect({
    gateway,
    model: { id: "provider-a/model-pro", context: 128000, output: 16384, images: true },
    models: [
      {
        id: "provider-a/model-pro",
        name: "Model Pro",
        magpie_label: "noisy",
        context: 128000,
        output: 16384,
        images: true,
        efforts: ["low", "high", "low"],
        pricing: { prompt: "0.000001", completion: "0.000005" },
      },
      { id: "provider-a/model-pro", context: 999 }, // duplicate ignored
      null,
      {},
      { id: "" },
    ],
  });

  assert.equal(out.baseURL, gateway.v1);
  assert.equal(out.gatewayKey, gateway.key);
  assert.equal(out.models.length, 1);
  assert.deepEqual(out.models[0], {
    id: "provider-a/model-pro",
    context: 128000,
    output: 16384,
    images: true,
    efforts: ["low", "high"],
    pricing: { prompt: "0.000001", completion: "0.000005" },
  });
  assert.deepEqual(out.modelInfo, {
    id: "provider-a/model-pro",
    context: 128000,
    output: 16384,
    images: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

test("connect() validates gateway and models list before writing", () => {
  assert.throws(() => connect({ gateway: { key: "k" }, models: [] }), /no \/v1 address/);
  assert.throws(() => connect({ gateway: { v1: gateway.v1 }, models: [] }), /no key/);
  assert.throws(() => connect({}), /no \/v1 address/);
  assert.throws(() => connect(), /no \/v1 address/);
  for (const bad of ["not-a-list", 42, {}, true]) {
    assert.throws(() => connect({ gateway, models: bad }), /not a list/);
  }
  assert.doesNotThrow(() => connect({ gateway, models: undefined }));
  assert.doesNotThrow(() => connect({ gateway, models: null }));
});

test("channelKeyFor splits models by subscription software and never uses literal 'magpie'", () => {
  assert.equal(channelKeyFor("provider-a/model-pro"), "provider-a-magpie");
  assert.equal(channelKeyFor("provider-b/model-fast"), "provider-b-magpie");
  assert.equal(channelKeyFor("group/model-1"), "group-magpie");
  assert.equal(channelKeyFor("auto/default"), AUTO_CHANNEL);
  assert.equal(channelKeyFor("AUTO/fast"), AUTO_CHANNEL);
  assert.equal(channelKeyFor("bare-model"), AUTO_CHANNEL);
  assert.equal(channelKeyFor("Team_Hub/model-1"), "team-hub-magpie");
  assert.equal(channelKeyFor("magpie/foo"), "magpie-magpie");
  assert.notEqual(channelKeyFor("magpie/foo"), "magpie");
  assert.equal(isManagedChannelKey("provider-a-magpie"), true);
  assert.equal(isManagedChannelKey("auto-magpie"), true);
  assert.equal(isManagedChannelKey("magpie"), false);
  assert.equal(isManagedChannelKey("-magpie"), false);
});

test("endpointNetworkPolicyFor authorizes loopback and private LAN gateways but not public URLs", () => {
  assert.deepEqual(endpointNetworkPolicyFor("http://127.0.0.1:4321/v1"), {
    origin: "http://127.0.0.1:4321",
    allowPrivateNetwork: true,
  });
  assert.deepEqual(endpointNetworkPolicyFor("http://localhost:4321/v1"), {
    origin: "http://localhost:4321",
    allowPrivateNetwork: true,
  });
  assert.deepEqual(endpointNetworkPolicyFor("http://[::1]:4321/v1"), {
    origin: "http://[::1]:4321",
    allowPrivateNetwork: true,
  });
  assert.deepEqual(endpointNetworkPolicyFor("http://[::ffff:127.0.0.1]:4321/v1"), {
    origin: "http://[::ffff:7f00:1]:4321",
    allowPrivateNetwork: true,
  });
  assert.deepEqual(endpointNetworkPolicyFor("http://192.168.1.20:4321/v1"), {
    origin: "http://192.168.1.20:4321",
    allowPrivateNetwork: true,
  });
  // fc0::1 is 0fc0::1 (NOT fc00::/7); must not be misclassified as private
  assert.equal(endpointNetworkPolicyFor("http://[fc0::1]:4321/v1"), undefined);
  assert.equal(endpointNetworkPolicyFor("https://gateway.example.com/v1"), undefined);
});

test("buildTianshuModel maps capacities, clamps maxTokens, converts prices, and handles reasoning rungs", () => {
  const model = buildTianshuModel({
    id: "provider-c/model-vision",
    context: 100000,
    output: 200000, // exceeds context -> must clamp
    images: true,
    efforts: ["low", "medium", "high", "xhigh"],
    pricing: {
      prompt: "0.000001",
      completion: "0.000005",
      input_cache_read: "0.00000007",
      input_cache_write: "0.00000125",
    },
    status: "deprecated",
    deprecationNote: "use newer model",
  });

  assert.deepEqual(model, {
    id: "provider-c/model-vision",
    contextWindow: 100000,
    maxTokens: 100000,
    supportsVision: true,
    capabilities: {
      effortFormat: "reasoning_effort",
      effortLevels: ["low", "medium", "high", "xhigh"],
      reasoningSplit: true,
      effortCap: { max: "xhigh" },
    },
    pricing: {
      input: 1,
      output: 5,
      cacheRead: 0.07,
      cacheWrite: 1.25,
    },
    deprecated: true,
    deprecationNote: "use newer model",
  });

  assert.deepEqual(reasoningCapabilities(["minimal", "medium"]).effortCap, { low: "minimal" });
  assert.equal(perMillion("0.000001"), 1);
  assert.equal(perMillion(0), 0);
  assert.equal(perMillion(""), undefined);
  assert.equal(perMillion("   "), undefined);
  assert.equal(perMillion(null), undefined);
  assert.equal(perMillion(false), undefined);
  assert.equal(
    "pricing" in _internal.normalizeModel({ id: "x/y", pricing: { prompt: "", completion: "  ", input_cache_read: null } }),
    false,
  );
  assert.deepEqual(buildTianshuModel({ id: "opaque/model", context: 0, output: 0, images: false }), {
    id: "opaque/model",
  });
});

test("buildTianshuDesired splits channels cleanly and preserves exact selected model & 4.1.54 contract", () => {
  const control = {
    ...connect({
      gateway,
      model: { id: "provider-b/model-fast", context: 200000, output: 65536 },
      models: [
        {
          id: "auto/model-large",
          context: 922000,
          output: 128000,
          images: true,
          efforts: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
          pricing: { prompt: "0.000001", completion: "0.000005" },
        },
        { id: "provider-a/model-pro", context: 1000000, output: 65536, efforts: ["low", "high"] },
        { id: "provider-b/model-fast", context: 200000, output: 65536 },
      ],
    }),
    model: "provider-b/model-fast",
  };

  const desired = buildTianshuDesired(control);
  assert.deepEqual(desired.channelKeys, ["auto-magpie", "provider-a-magpie", "provider-b-magpie"]);
  assert.equal(desired.defaultProvider, "provider-b-magpie");
  assert.equal(desired.defaultModel, "provider-b-magpie:provider-b/model-fast");

  for (const [key, provider] of Object.entries(desired.providersByKey)) {
    assertRivet4154Shape(key, provider);
  }
  assert.deepEqual(desired.providersByKey["provider-a-magpie"].capabilities, {
    effortFormat: "reasoning_effort",
    reasoningSplit: true,
  });
  assert.equal("capabilities" in desired.providersByKey["provider-b-magpie"], false);
});

test("buildTianshuDesired synthesizes selected model absent from catalog without copying unrelated modelInfo", () => {
  const desired = buildTianshuDesired({
    baseURL: gateway.v1,
    gatewayKey: gateway.key,
    model: "custom/my-route",
    modelInfo: { id: "custom/my-route", context: 128000 },
    models: [{ id: "auto/default" }],
  });

  assert.equal(desired.defaultProvider, "custom-magpie");
  assert.equal(desired.defaultModel, "custom-magpie:custom/my-route");
  assert.deepEqual(desired.providersByKey["custom-magpie"].models, [
    { id: "custom/my-route", contextWindow: 128000 },
  ]);
  assertRivet4154Shape("custom-magpie", desired.providersByKey["custom-magpie"]);

  // Stale modelInfo belonging to a DIFFERENT model must NOT bleed onto selected model
  const isolated = buildTianshuDesired({
    baseURL: gateway.v1,
    gatewayKey: gateway.key,
    model: "custom/fresh-route",
    modelInfo: { id: "other/old-model", context: 999999, images: true },
    models: [{ id: "auto/default" }],
  });
  assert.deepEqual(isolated.providersByKey["custom-magpie"].models, [{ id: "custom/fresh-route" }]);
});

test("notice mentions both languages and sync/session behavior", () => {
  assert.match(agent.notice, /Tianshu 4\.1\.54\+/);
  assert.match(agent.notice, /session/i);
  assert.match(agent.notice, /天枢 4\.1\.54\+/);
  assert.match(agent.notice, /新开会话/);
});

test("_internal.positiveInt handles edge cases cleanly", () => {
  assert.equal(_internal.positiveInt(128000), 128000);
  assert.equal(_internal.positiveInt(0), undefined);
  assert.equal(_internal.positiveInt(-1), undefined);
  assert.equal(_internal.positiveInt(1.5), undefined);
});
