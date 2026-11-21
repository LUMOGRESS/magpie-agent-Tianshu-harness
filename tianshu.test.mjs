import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { _internal, agent, connect } from "./tianshu.agent.js";

const gateway = {
  url: "http://127.0.0.1:3425",
  v1: "http://127.0.0.1:3425/v1",
  key: "magpie-tianshu",
};

// What rivet's own modelConfigSchema accepts. Anything outside this list is
// stripped by zod before it ever reaches Tianshu, so writing it would be a
// silent no-op — the failure mode this module exists to avoid.
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
]);

/** Fails with the offending keys when a written entry carries names rivet drops. */
function assertRivetShape(provider) {
  const unknownProvider = Object.keys(provider).filter((k) => !RIVET_PROVIDER_FIELDS.has(k));
  assert.deepEqual(unknownProvider, [], `provider carries keys rivet strips: ${unknownProvider.join(", ")}`);

  for (const model of provider.models ?? []) {
    const unknown = Object.keys(model).filter((k) => !RIVET_MODEL_FIELDS.has(k));
    assert.deepEqual(unknown, [], `model ${model.id} carries keys rivet strips: ${unknown.join(", ")}`);
    for (const key of Object.keys(model.pricing ?? {})) {
      assert.equal(RIVET_PRICING_FIELDS.has(key), true, `model ${model.id} pricing.${key} is not rivet's`);
    }
    for (const key of Object.keys(model.capabilities ?? {})) {
      assert.equal(RIVET_CAPABILITY_FIELDS.has(key), true, `model ${model.id} capabilities.${key} is not rivet's`);
    }
    if (model.capabilities?.effortLevels) {
      // a rung outside rivet's five-name ladder must come with a wire spelling
      // in effortCap, otherwise the picker offers a rung nothing can send
      const levels = new Set(model.capabilities.effortLevels);
      const rungs = new Set(["off", "low", "medium", "high", "max"]);
      const cap = model.capabilities.effortCap ?? {};
      for (const rung of ["max", "low"]) {
        if (rungs.has(rung) && !levels.has(rung) && cap[rung] === undefined) {
          assert.fail(`model ${model.id} offers no "${rung}" but does not say what to send instead`);
        }
      }
      assert.equal(
        Object.values(cap).every((wire) => levels.has(wire)),
        true,
        `model ${model.id} maps a rung to something it does not advertise`,
      );
    }
    if (model.capabilities?.effortFormat) {
      assert.equal(model.capabilities.effortFormat, "reasoning_effort");
    }
  }
}

test("says where Tianshu keeps its model", () => {
  assert.equal(agent.id, "tianshu");
  assert.equal(agent.config, "~/.rivet/config.json");
  assert.equal(agent.format, "json");
  assert.equal(agent.model, "agent.defaultModel");
  assert.equal(agent.prefix, "magpie:");
});

test("is detected by Tianshu's own command, not by its config folder", () => {
  // agent.dir would make magpie take ~/.rivet for an install of its own; that
  // folder is where Tianshu keeps its settings, not evidence it is here.
  assert.equal(agent.bin, "tianshu");
  assert.equal(agent.dir, undefined);
  // `rivet` is the same entry point under a second name
  assert.deepEqual(agent.aliases, ["rivet"]);
});

test("names Tianshu's requests in usage by its User-Agent", () => {
  // rivet sends "Tianshu/1.0 (terminal coding agent)" by default
  assert.deepEqual(agent.ua, ["tianshu", "rivet"]);
});

test("the package declares this module as its agent and carries the Tianshu icon", async () => {
  const pkg = await readFile(new URL("./package.json", import.meta.url), "utf8").then(JSON.parse);
  assert.equal(pkg.magpie.agent, "./tianshu.agent.js");
  // a folder plugin has no npm name for the market to look it up by, so the
  // icon has to come from the package itself
  assert.match(pkg.magpie.icon, /^data:image\/svg\+xml;base64,/);

  // the icon must be Tianshu's, not a placeholder: decode it and check it is
  // the app icon from Tianshu-harness/docs/brand/assets/app-icon.svg
  const svg = Buffer.from(pkg.magpie.icon.split(",", 2)[1], "base64").toString("utf8");
  assert.match(svg, /<svg[^>]+viewBox="0 0 1024 1024"/);
  assert.match(svg, /<rect x="40" y="40" width="944" height="944" rx="208"/);
  // and it must be self-contained: magpie draws it straight from the data URI
  assert.deepEqual([...svg.matchAll(/(?:href|src)="[^"]*"/g)].map((m) => m[0]), []);
  assert.equal(/url\(['"]?(?:http|https)/.test(svg), false);

  // the name and summary have size limits magpie silently enforces
  assert.equal(Buffer.byteLength(pkg.magpie.name, "utf8") <= 80, true);
  for (const lang of ["en", "zh"]) {
    assert.equal(Buffer.byteLength(pkg.magpie.summary[lang], "utf8") <= 300, true);
  }

  // the Agent row reads the hook's own icon; declaring it there is what put
  // Tianshu's plate in magpie's Agents list instead of the generic cube
  assert.equal(agent.icon, pkg.magpie.icon, "agent.icon must be the same picture as magpie.icon");

  // the agent entry is a moejs module: no main, nothing to install
  assert.equal(pkg.main, undefined);
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.exports, undefined);
  assert.deepEqual(pkg.files.filter((f) => /\.m?js$/.test(f)), ["tianshu.agent.js"]);
});

test("points Tianshu at magpie as an OpenAI-compatible provider", () => {
  assert.deepEqual(connect({ gateway, models: [] }), {
    "provider.default": "magpie",
    "provider.providers.magpie": {
      name: "magpie",
      baseUrl: "http://127.0.0.1:3425/v1",
      protocol: "openai",
      apiKey: "magpie-tianshu",
    },
  });
});

test("a provider with no models says so by having no list, not an empty one", () => {
  // rivet reads an empty `models` as a provider that can serve nothing
  const provider = connect({ gateway, models: [] })["provider.providers.magpie"];
  assert.equal("models" in provider, false);
  assert.equal(provider.models, undefined);
});

test("keeps a model's capacity under rivet's names for it", () => {
  const provider = connect({
    gateway,
    models: [{ id: "rylive/deepseek-flash", name: "DeepSeek Flash", context: 1000000, output: 393216, images: true }],
  })["provider.providers.magpie"];
  assert.deepEqual(provider.models, [
    { id: "rylive/deepseek-flash", contextWindow: 1000000, maxTokens: 393216, supportsVision: true },
  ]);
});

test("writes no capacity it does not know", () => {
  const provider = connect({ gateway, models: [{ id: "opaque/model" }] })["provider.providers.magpie"];
  assert.deepEqual(provider.models, [{ id: "opaque/model" }]);
});

test("a capacity magpie gives as zero is not written as zero", () => {
  // magpie fills a model it knows nothing about with 0, and rivet reads 0 as
  // no budget at all; a missing field lets rivet infer a size instead
  const provider = connect({
    gateway,
    models: [{ id: "rylive/deepseek-flash", context: 0, output: 0, images: false }],
  })["provider.providers.magpie"];
  assert.deepEqual(provider.models, [{ id: "rylive/deepseek-flash" }]);
});

test("leaves out a model that is not one", () => {
  const provider = connect({
    gateway,
    models: [null, {}, { id: "" }, { id: 42 }, { id: "a/one", context: 1000 }],
  })["provider.providers.magpie"];
  assert.deepEqual(provider.models, [{ id: "a/one", contextWindow: 1000 }]);
});

test("lists every model magpie offers again, since the provider is written whole", () => {
  const provider = connect({
    gateway,
    models: [
      { id: "a/one", context: 1000, output: 100 },
      { id: "b/two", context: 2000, output: 200 },
    ],
  })["provider.providers.magpie"];
  assert.deepEqual(provider.models.map((m) => m.id), ["a/one", "b/two"]);
});

test("carries a model's reasoning rungs over as the model spells them", () => {
  const provider = connect({
    gateway,
    models: [{ id: "auto/gpt-6.1-terra", efforts: ["none", "low", "medium", "high", "xhigh", "max", "ultra"] }],
  })["provider.providers.magpie"];
  const capabilities = provider.models[0].capabilities;
  assert.equal(capabilities.effortFormat, "reasoning_effort");
  assert.deepEqual(capabilities.effortLevels, ["none", "low", "medium", "high", "xhigh", "max", "ultra"]);
  // this model does offer rivet's "max", so "xhigh" needs no wire spelling
  assert.equal("effortCap" in capabilities, false);
});

test("a rung rivet has no name for says what to send instead", () => {
  // gemini's ladder stops at xhigh: rivet's "max" goes out as "xhigh"
  assert.deepEqual(_internal.reasoningCapabilities(["low", "medium", "high", "xhigh"]), {
    effortFormat: "reasoning_effort",
    effortLevels: ["low", "medium", "high", "xhigh"],
    effortCap: { max: "xhigh" },
  });
  // a ladder with no "low" sends "low" as "minimal", as Tianshu's own probe does
  assert.deepEqual(_internal.reasoningCapabilities(["minimal", "medium"]).effortCap, { low: "minimal" });
});

test("a model with no reasoning rungs gets no capabilities at all", () => {
  const provider = connect({
    gateway,
    models: [{ id: "rylive/eliroot-v4.1-flash", efforts: [] }],
  })["provider.providers.magpie"];
  assert.equal("capabilities" in provider.models[0], false);
});

test("prices a model per million tokens, in rivet's names", () => {
  const model = _internal.modelEntry({
    id: "auto/gpt-6.1-terra",
    pricing: {
      prompt: "0.000001",
      completion: "0.000005",
      input_cache_read: "0.00000005",
      input_cache_write: "0.00000125",
    },
  });
  // magpie prices one token; rivet prices a million of them
  assert.deepEqual(model.pricing, { input: 1, output: 5, cacheRead: 0.05, cacheWrite: 1.25 });
});

test("the million-token conversion does not carry float noise", () => {
  // 0.000001 * 1e6 is 1.0000000000000002 in binary floating point; the cents
  // magpie sent must survive, not that artefact
  assert.equal(_internal.perMillion("0.000001"), 1);
  assert.equal(_internal.perMillion(0), 0);
  assert.equal(_internal.perMillion("0.00000007"), 0.07);
});

test("writes no price it does not know", () => {
  // magpie omits pricing for a subscription plan; rivet must not be told 0
  const model = _internal.modelEntry({ id: "zcode/GLM-5.3-Flash" });
  assert.equal("pricing" in model, false);

  const partial = _internal.modelEntry({ id: "x/y", pricing: { prompt: "0.000002" } });
  assert.deepEqual(partial.pricing, { input: 2 });
});

test("does not pass magpie's own fields through to rivet", () => {
  // the real payload carries names rivet has never heard of
  const model = _internal.modelEntry({
    id: "group/gemini",
    name: "Gemini智能",
    magpie_label: "Gemini智能 · routing group",
    owned_by: "dgemini",
    tool_call: true,
    native_endpoints: ["/v1/chat/completions"],
    service_tiers: [{ id: "priority", name: "Fast" }],
    supported_parameters: ["tools", "tool_choice", "reasoning"],
  });
  assert.deepEqual(model, { id: "group/gemini" });
});

test("flags a model magpie has retired rather than offering it silently", () => {
  const model = _internal.modelEntry({ id: "old/model", status: "deprecated", deprecationNote: "use new/model" });
  assert.equal(model.deprecated, true);
  assert.equal(model.deprecationNote, "use new/model");
});

test("writes the same thing twice, since magpie calls connect again on every change", () => {
  const models = [
    { id: "a/one", context: 1000, output: 100, images: true, efforts: ["low", "high"], pricing: { prompt: "0.000001" } },
    { id: "b/two", context: 2000, output: 200, efforts: ["xhigh"] },
  ];
  const first = connect({ gateway, models });
  const second = connect({ gateway, models });
  assert.deepEqual(second, first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first, "the result must survive magpie's JSON hand-off");
});

test("refuses to point Tianshu at a gateway it was given no address or key for", () => {
  assert.throws(() => connect({ gateway: { key: "k" }, models: [] }), /no \/v1 address/);
  assert.throws(() => connect({ gateway: { v1: "http://127.0.0.1:3425/v1" }, models: [] }), /no key/);
  assert.throws(() => connect({}), /no \/v1 address/);
  assert.throws(() => connect(), /no \/v1 address/);
});

test("every shape it writes is one rivet keeps", () => {
  const provider = connect({
    gateway,
    models: [
      {
        id: "auto/gpt-6.1-terra",
        context: 922000,
        output: 128000,
        images: true,
        efforts: ["none", "low", "medium", "high", "xhigh", "max", "ultra"],
        pricing: { prompt: "0.000001", completion: "0.000005", input_cache_read: "0.00000005" },
      },
      { id: "opaque/model" },
      { id: "old/model", status: "deprecated", deprecationNote: "gone" },
    ],
  })["provider.providers.magpie"];
  assertRivetShape(provider);
});
