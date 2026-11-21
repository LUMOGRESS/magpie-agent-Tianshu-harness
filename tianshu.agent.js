// Tianshu (天枢 / rivet harness) picks the model it starts on from
// ~/.rivet/config.json, in two keys together: `provider.default` names the
// provider, and `agent.defaultModel` is "<providerKey>:<modelId>", where the
// id must be one of that provider's own `models`. So magpie goes in under a
// provider of its own, "magpie", whose baseUrl is the gateway's /v1, and
// `agent.defaultModel` is that provider key plus the id this module's
// `prefix` puts in front of.
//
// Everything below is written in rivet's names, not magpie's: rivet reads
// `contextWindow` / `maxTokens` / `supportsVision`, while magpie hands over
// `context` / `output` / `images`. Prices cross over the other way round —
// magpie quotes dollars per *token*, rivet books dollars per *million*
// tokens, which is what perMillion() multiplies out. A capacity magpie does
// not know is left out rather than written as 0: rivet infers a missing size
// from the model id, but reads 0 as "no budget at all".

//
// Why this file and not one of magpie's own, as agent-kimi-desktop and
// agent-nanobot do: those agents read a config file magpie can point them at.
// Tianshu does not — `RIVET_CONFIG_PATH` exists, but only a launcher can set
// it, and magpie's agent plugins can write files, not environment. So the two
// keys Tianshu selects its model with are written where Tianshu reads them,
// in Tianshu's own schema, and every other key in that file is left alone.
// magpie's own Unwire contract is the safety net: it stashes what a field had
// before its first write and puts it back when the switch goes off
// (internal/agent/agent.go), so nothing here has to keep a copy.

const PROVIDER_KEY = "magpie";
const MODEL_PREFIX = "magpie:";

// rivet's own ladder has five rungs (off / low / medium / high / max) and a
// provider may advertise more or spell them differently. Rather than dropping
// rungs it has no name for, rivet maps a rung through "effortCap" — which is
// how Tianshu's own /models probe handles it too (src/api/model-probe-enrichment.ts):
// the provider's list goes over as-is, and the odd rungs get a wire spelling
// beside them.
//
// reasoningSplit is declared here for every reasoning model, because magpie's
// gateway answers exactly the way the split protocol expects: confirmed live
// against three upstreams (auto/glm-5.3-flash, trae-cn/qwen3.8-flash-max,
// dgemini/gemini-4-neon) — each returned `reasoning_content` (or a plain
// `content` when the model had nothing to think about) and none rejected
// `reasoning_split: true`. Without the flag rivet never reads that field, so a
// model that fills `reasoning_content` and leaves `content` empty — which
// glm-5.3-flash does, 718 chars of thinking and 0 chars of answer — reached
// Tianshu as an empty reply.
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
    reasoningSplit: true,
    ...(Object.keys(effortCap).length ? { effortCap } : {}),
  };
}

// Tianshu's own app-icon.svg (Tianshu-harness/docs/brand/assets/), inlined
// so magpie draws it with no network. Declared on both the package
// (magpie.icon, the Discover card) and the hook (agent.icon, the Agents
// row) — the row reads the hook, not the package.
// prettier-ignore
const ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0ib2wiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4MT0iOTIiIHkxPSIxNjkiIHgyPSIxNTkiIHkyPSI5MyI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjOGVhM2MyIi8+PHN0b3Agb2Zmc2V0PSIwLjIiIHN0b3AtY29sb3I9IiMwYjFhMzYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwYjFhMzYiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0ib3IiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4MT0iMTAwIiB5MT0iMTgxIiB4Mj0iMjU2IiB5Mj0iMTEwIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM4ZWEzYzIiLz48c3RvcCBvZmZzZXQ9IjAuMjgiIHN0b3AtY29sb3I9IiMwYjFhMzYiLz48c3RvcCBvZmZzZXQ9IjAuNiIgc3RvcC1jb2xvcj0iIzBiMWEzNiIvPjxzdG9wIG9mZnNldD0iMC44NiIgc3RvcC1jb2xvcj0iIzRmN2ZmZiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzZmOThmZiIvPjwvbGluZWFyR3JhZGllbnQ+PGxpbmVhckdyYWRpZW50IGlkPSJzbCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIHgxPSIwIiB5MT0iNDUiIHgyPSIwIiB5Mj0iMjA4Ij48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMyYTQxNzAiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxMzIxM2YiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0ic2QiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4MT0iMCIgeTE9IjQ1IiB4Mj0iMCIgeTI9IjIwOCI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjMGIxNjMwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDYwZDFlIi8+PC9saW5lYXJHcmFkaWVudD48Y2xpcFBhdGggaWQ9InNjIj48cGF0aCBkPSJNMTYzLjYgNDUuM0MxNjUuNSA2NC44IDE2Ny40IDk1LjUgMTcwLjggMTE0LjFDMTcyIDEyMS43IDE3NC41IDEyMy4xIDE4Mi4xIDEyNC40TDIwNC4zIDEyNy42TDE4MS4zIDEzMy42QzE3Mi43IDEzNS44IDE3MSAxMzkuMiAxNjkuOCAxNDguMkwxNjMuNiAyMDcuN0wxNTcuOSAxNTEuMkMxNTYuOSAxNDEuMSAxNTQuMiAxMzguNiAxNDQuNSAxMzYuMUwxMjIuMiAxMzJMMTQ1LjYgMTI2LjRDMTU0LjYgMTI0LjIgMTU2LjcgMTIwLjcgMTU4LjIgMTA5LjhaIi8+PC9jbGlwUGF0aD48bWFzayBpZD0ieGciIG1hc2tVbml0cz0idXNlclNwYWNlT25Vc2UiIHg9Ii0xMDAwIiB5PSItMTAwMCIgd2lkdGg9IjMwMDAiIGhlaWdodD0iMzAwMCI+PHJlY3QgeD0iLTEwMDAiIHk9Ii0xMDAwIiB3aWR0aD0iMzAwMCIgaGVpZ2h0PSIzMDAwIiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTE3Ni45IDEwNy45QzIyNS41IDkxLjIgMjYwLjUgOTIgMjYyLjQgMTAzQzI2OC45IDEyOCAxODQuOCAxNzUuMyAxMjEuNCAxODMuMUMxMDcgMTg1LjMgOTkuMyAxODUgOTQuOSAxODIuMkMxMzAuMyAxODguMyAyMTguOSAxNDkuOSAyNDAuOSAxMTkuN0MyNjUgODkuMSAyMTQuMSA5NS45IDE3Ni45IDEwNy45WiIgZmlsbD0iIzAwMCIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIuOCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvbWFzaz48Y2xpcFBhdGggaWQ9InRjIj48cmVjdCB4PSI0MCIgeT0iNDAiIHdpZHRoPSI5NDQiIGhlaWdodD0iOTQ0IiByeD0iMjA4Ii8+PC9jbGlwUGF0aD48bGluZWFyR3JhZGllbnQgaWQ9InRiIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeDE9IjAiIHkxPSI0MCIgeDI9IjAiIHkyPSI5ODQiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2ZmZmZmZiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2VkZjJmYiIvPjwvbGluZWFyR3JhZGllbnQ+PHJhZGlhbEdyYWRpZW50IGlkPSJoZyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIGN4PSI0OTQuMzY1IiBjeT0iNTI1LjE3NyIgcj0iNDMwIj48c3RvcCBzdG9wLWNvbG9yPSIjYzlkYmZmIiBzdG9wLW9wYWNpdHk9IjAuOTUiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNjOWRiZmYiIHN0b3Atb3BhY2l0eT0iMCIvPjwvcmFkaWFsR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHg9IjQwIiB5PSI0MCIgd2lkdGg9Ijk0NCIgaGVpZ2h0PSI5NDQiIHJ4PSIyMDgiIGZpbGw9InVybCgjdGIpIi8+PGcgY2xpcC1wYXRoPSJ1cmwoI3RjKSI+PGNpcmNsZSBjeD0iNDk0LjM2NSIgY3k9IjUyNS4xNzciIHI9IjQzMCIgZmlsbD0idXJsKCNoZykiLz48cGF0aCBmaWxsPSIjOWZiNGRjIiBkPSJNMTcwIDE1NlExNzIuNjQgMTc1LjM2IDE5MiAxNzhRMTcyLjY0IDE4MC42NCAxNzAgMjAwUTE2Ny4zNiAxODAuNjQgMTQ4IDE3OFExNjcuMzYgMTc1LjM2IDE3MCAxNTZaIi8+PGNpcmNsZSBjeD0iMzAyIiBjeT0iMTE2IiByPSI2IiBmaWxsPSIjOWZiNGRjIiBmaWxsLW9wYWNpdHk9Ii44Ii8+PHBhdGggZmlsbD0iIzlmYjRkYyIgZD0iTTg2MCAxNDJRODYxLjkyIDE1Ni4wOCA4NzYgMTU4UTg2MS45MiAxNTkuOTIgODYwIDE3NFE4NTguMDggMTU5LjkyIDg0NCAxNThRODU4LjA4IDE1Ni4wOCA4NjAgMTQyWiIvPjxjaXJjbGUgY3g9IjkwMiIgY3k9IjQ3MCIgcj0iNiIgZmlsbD0iIzlmYjRkYyIgZmlsbC1vcGFjaXR5PSIuOCIvPjxwYXRoIGZpbGw9IiM5ZmI0ZGMiIGQ9Ik04NzggODUwUTg4MC4xNiA4NjUuODQgODk2IDg2OFE4ODAuMTYgODcwLjE2IDg3OCA4ODZRODc1Ljg0IDg3MC4xNiA4NjAgODY4UTg3NS44NCA4NjUuODQgODc4IDg1MFoiLz48Y2lyY2xlIGN4PSI3NDIiIGN5PSI5MjIiIHI9IjUiIGZpbGw9IiM5ZmI0ZGMiIGZpbGwtb3BhY2l0eT0iLjgiLz48cGF0aCBmaWxsPSIjOWZiNGRjIiBkPSJNMTUwIDg0NFExNTEuNjggODU2LjMyIDE2NCA4NThRMTUxLjY4IDg1OS42OCAxNTAgODcyUTE0OC4zMiA4NTkuNjggMTM2IDg1OFExNDguMzIgODU2LjMyIDE1MCA4NDRaIi8+PGNpcmNsZSBjeD0iMTEyIiBjeT0iNTYwIiByPSI1IiBmaWxsPSIjOWZiNGRjIiBmaWxsLW9wYWNpdHk9Ii44Ii8+PC9nPjxyZWN0IHg9IjQyIiB5PSI0MiIgd2lkdGg9Ijk0MCIgaGVpZ2h0PSI5NDAiIHJ4PSIyMDYiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2M2ZDBlMCIgc3Ryb2tlLXdpZHRoPSI0Ii8+PGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTE1OC44NzQgNi44OTcpIHNjYWxlKDMuOTkyOTEpIj48cGF0aCBmaWxsPSJ1cmwoI29sKSIgZD0iTTIxNi44IDgxLjhDMTc4LjIgODMuMSAxMjIuMSAxMDYuMiA5MC4xIDEzNC4zQzU1LjcgMTY0LjUgNzYuMiAxNzcgMTM1LjcgMTYzLjJDMTA0LjkgMTY3LjYgNzguOCAxNjYuNCA4NS45IDE0OUM5NS4zIDEyNy4xIDE2Ni43IDg3LjIgMjE2LjggODEuOFoiLz48ZyBtYXNrPSJ1cmwoI3hnKSI+PHBhdGggZmlsbD0idXJsKCNzbCkiIGQ9Ik0xNjMuNiA0NS4zQzE2NS41IDY0LjggMTY3LjQgOTUuNSAxNzAuOCAxMTQuMUMxNzIgMTIxLjcgMTc0LjUgMTIzLjEgMTgyLjEgMTI0LjRMMjA0LjMgMTI3LjZMMTgxLjMgMTMzLjZDMTcyLjcgMTM1LjggMTcxIDEzOS4yIDE2OS44IDE0OC4yTDE2My42IDIwNy43TDE1Ny45IDE1MS4yQzE1Ni45IDE0MS4xIDE1NC4yIDEzOC42IDE0NC41IDEzNi4xTDEyMi4yIDEzMkwxNDUuNiAxMjYuNEMxNTQuNiAxMjQuMiAxNTYuNyAxMjAuNyAxNTguMiAxMDkuOFoiLz48cGF0aCBmaWxsPSJ1cmwoI3NkKSIgY2xpcC1wYXRoPSJ1cmwoI3NjKSIgZD0iTTE2My42IDEyOS44TDE2My42IC0yNzAuMkw0NzEuNDI1IC0xMjUuNjI5WiBNMTYzLjYgMTI5LjhMNTYzLjAxNyAxMDguMjFMNDU4LjQ2MiA0MDAuMDlMMTYzLjYgNTI5LjhaIE0xNjMuNiAxMjkuOEwtMTAwLjcyNSA0MzAuMDIxTC0yMzUuODM2IDE1MS4wMjZaIi8+PC9nPjxwYXRoIGZpbGw9InVybCgjb3IpIiBkPSJNMTc2LjkgMTA3LjlDMjI1LjUgOTEuMiAyNjAuNSA5MiAyNjIuNCAxMDNDMjY4LjkgMTI4IDE4NC44IDE3NS4zIDEyMS40IDE4My4xQzEwNyAxODUuMyA5OS4zIDE4NSA5NC45IDE4Mi4yQzEzMC4zIDE4OC4zIDIxOC45IDE0OS45IDI0MC45IDExOS43QzI2NSA4OS4xIDIxNC4xIDk1LjkgMTc2LjkgMTA3LjlaIi8+PHBhdGggZmlsbD0iIzBiMWEzNiIgZD0iTTExMy44IDE0MC42QzExNC43IDE0OC44IDExNi4yIDE1MC4yIDEyMi40IDE1MS4zQzExNi41IDE1Mi42IDExNSAxNTQgMTEzLjcgMTYwLjhDMTEyLjcgMTU0LjIgMTExLjIgMTUzLjEgMTA1LjcgMTUxLjlDMTExLjcgMTUwLjYgMTEzLjMgMTQ5LjEgMTEzLjggMTQwLjZaTTIyMy43IDEwNy41QzIyNC41IDExNC42IDIyNiAxMTYgMjMxLjYgMTE3LjJDMjI1LjkgMTE4LjUgMjI0LjkgMTIwLjEgMjIzLjggMTI2LjhDMjIyLjUgMTIwLjMgMjIxLjYgMTE4LjggMjE1LjYgMTE3LjdDMjIxLjcgMTE2LjUgMjIzIDExNC45IDIyMy43IDEwNy41WiIvPjwvZz48L3N2Zz4K";

export const agent = {
  id: "tianshu",
  name: "天枢 Tianshu",
  // Tianshu is a harness, not a bare CLI: `tianshu-harness` puts `tianshu`
  // (the TUI/desktop/VS Code entry point) and `rivet` (the same binary under
  // its older name) on PATH. `dir` is the second signal magpie accepts, and
  // 19 of the 20 agent packages in this community ship one — deepzora (the
  // closest relative, a harness with its own desktop app) declares
  // "~/.deepzora" beside its bin. Tianshu's folder is ~/.rivet on Unix and
  // %LOCALAPPDATA%\.rivet on Windows; the Unix spelling is the one magpie
  // expands, and Windows resolves the same way for both.
  bin: "tianshu",
  dir: "~/.rivet",
  aliases: ["rivet"],
  config: "~/.rivet/config.json",
  format: "json",
  // magpie writes this module's prefix plus its model id, as rivet spells it.
  model: "agent.defaultModel",
  prefix: MODEL_PREFIX,
  icon: ICON,
  // rivet sends "Tianshu/1.0 (terminal coding agent)" by default; usage
  // groups Tianshu's requests by these words of that User-Agent.
  ua: ["tianshu", "rivet"],
  // agent-kilo's notice is the pattern: name the action, then the remedy.
  // Tianshu reads ~/.rivet/config.json when a session starts, so a running
  // session keeps the model it began on.
  notice:
    "Tianshu reads its settings when a session starts: restart it, or open a new session, to use the new model. 天枢在新会话开始时才读取设置：重启天枢或新开一个会话后生效。",
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
  // `models` absent is fine (a gateway with none yet); `models` present but
  // not a list means magpie changed the hand-off, and writing a provider with
  // no models would leave Tianshu with an empty picker and no explanation.
  if (models !== undefined && models !== null && !Array.isArray(models)) {
    throw new Error("Magpie handed Tianshu's connect() a model list that is not a list; nothing was written.");
  }

  // The provider is written whole, so every model magpie offers is listed
  // again: a model picked in Tianshu since is one of magpie's own.
  const list = (models ?? []).map(modelEntry).filter(Boolean);

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
