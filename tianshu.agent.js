// Tianshu (天枢 / rivet harness 4.1.54+) agent descriptor for Magpie.
//
// This module runs inside Magpie's moejs sandbox: no Node APIs, no external
// imports. Why it writes a neutral control JSON instead of editing
// ~/.rivet/config.json directly:
//
// 1. Tianshu 4.1.54+ does NOT store its config at ~/.rivet/config.json on
//    Windows. Its resolution order is:
//      RIVET_CONFIG_PATH / RIVET_HOME
//      > Desktop portable mode (<installDir>/TianshuData/.rivet)
//      > Desktop launcher.json (rivetHome)
//      > Platform default (%LOCALAPPDATA%\.rivet on Windows, ~/.rivet on Unix)
//    A static moejs path string cannot discover Desktop portable dirs,
//    launcher.json, or synchronize both Desktop and CLI roots.
//
// 2. Tianshu 4.1.54+ freezes a provider's model pool into provider-keys.json
//    on first loadConfig() and reads contractModels() from provider-keys.json
//    thereafter, ignoring subsequent changes to provider.models in config.json.
//    The companion Bun bridge (index.mjs / bridge.mjs) keeps both config.json
//    and provider-keys.json synchronized across every active Tianshu root.
//
// 3. Declaring `model: "model"` with no static `prefix` in this control file
//    keeps Magpie's Agents-page model picker and `magpie tianshu <model>`
//    working while letting the companion bridge split providers cleanly by
//    subscription software (<software>-magpie / auto-magpie).

export const CONTROL_DIR = "~/.config/magpie-tianshu";
export const CONTROL_FILE = "~/.config/magpie-tianshu/connection.json";

// Tianshu's own app-icon.svg (Tianshu-harness/docs/brand/assets/), inlined
// so magpie draws it with no network. Declared on both the package
// (magpie.icon, the Discover card) and the hook (agent.icon, the Agents
// row) — the row reads the hook, not the package.
// prettier-ignore
const ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiPjxkZWZzPjxsaW5lYXJHcmFkaWVudCBpZD0ib2wiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4MT0iOTIiIHkxPSIxNjkiIHgyPSIxNTkiIHkyPSI5MyI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjOGVhM2MyIi8+PHN0b3Agb2Zmc2V0PSIwLjIiIHN0b3AtY29sb3I9IiMwYjFhMzYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMwYjFhMzYiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0ib3IiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4MT0iMTAwIiB5MT0iMTgxIiB4Mj0iMjU2IiB5Mj0iMTEwIj48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiM4ZWEzYzIiLz48c3RvcCBvZmZzZXQ9IjAuMjgiIHN0b3AtY29sb3I9IiMwYjFhMzYiLz48c3RvcCBvZmZzZXQ9IjAuNiIgc3RvcC1jb2xvcj0iIzBiMWEzNiIvPjxzdG9wIG9mZnNldD0iMC44NiIgc3RvcC1jb2xvcj0iIzRmN2ZmZiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzZmOThmZiIvPjwvbGluZWFyR3JhZGllbnQ+PGxpbmVhckdyYWRpZW50IGlkPSJzbCIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIHgxPSIwIiB5MT0iNDUiIHgyPSIwIiB5Mj0iMjA4Ij48c3RvcCBvZmZzZXQ9IjAiIHN0b3AtY29sb3I9IiMyYTQxNzAiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxMzIxM2YiLz48L2xpbmVhckdyYWRpZW50PjxsaW5lYXJHcmFkaWVudCBpZD0ic2QiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIiB4MT0iMCIgeTE9IjQ1IiB4Mj0iMCIgeTI9IjIwOCI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjMGIxNjMwIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjMDYwZDFlIi8+PC9saW5lYXJHcmFkaWVudD48Y2xpcFBhdGggaWQ9InNjIj48cGF0aCBkPSJNMTYzLjYgNDUuM0MxNjUuNSA2NC44IDE2Ny40IDk1LjUgMTcwLjggMTE0LjFDMTcyIDEyMS43IDE3NC41IDEyMy4xIDE4Mi4xIDEyNC40TDIwNC4zIDEyNy42TDE4MS4zIDEzMy42QzE3Mi43IDEzNS44IDE3MSAxMzkuMiAxNjkuOCAxNDguMkwxNjMuNiAyMDcuN0wxNTcuOSAxNTEuMkMxNTYuOSAxNDEuMSAxNTQuMiAxMzguNiAxNDQuNSAxMzYuMUwxMjIuMiAxMzJMMTQ1LjYgMTI2LjRDMTU0LjYgMTI0LjIgMTU2LjcgMTIwLjcgMTU4LjIgMTA5LjhaIi8+PC9jbGlwUGF0aD48bWFzayBpZD0ieGciIG1hc2tVbml0cz0idXNlclNwYWNlT25Vc2UiIHg9Ii0xMDAwIiB5PSItMTAwMCIgd2lkdGg9IjMwMDAiIGhlaWdodD0iMzAwMCI+PHJlY3QgeD0iLTEwMDAiIHk9Ii0xMDAwIiB3aWR0aD0iMzAwMCIgaGVpZ2h0PSIzMDAwIiBmaWxsPSIjZmZmIi8+PHBhdGggZD0iTTE3Ni45IDEwNy45QzIyNS41IDkxLjIgMjYwLjUgOTIgMjYyLjQgMTAzQzI2OC45IDEyOCAxODQuOCAxNzUuMyAxMjEuNCAxODMuMUMxMDcgMTg1LjMgOTkuMyAxODUgOTQuOSAxODIuMkMxMzAuMyAxODguMyAyMTguOSAxNDkuOSAyNDAuOSAxMTkuN0MyNjUgODkuMSAyMTQuMSA5NS45IDE3Ni45IDEwNy45WiIgZmlsbD0iIzAwMCIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIuOCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvbWFzaz48Y2xpcFBhdGggaWQ9InRjIj48cmVjdCB4PSI0MCIgeT0iNDAiIHdpZHRoPSI5NDQiIGhlaWdodD0iOTQ0IiByeD0iMjA4Ii8+PC9jbGlwUGF0aD48bGluZWFyR3JhZGllbnQgaWQ9InRiIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgeDE9IjAiIHkxPSI0MCIgeDI9IjAiIHkyPSI5ODQiPjxzdG9wIG9mZnNldD0iMCIgc3RvcC1jb2xvcj0iI2ZmZmZmZiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI2VkZjJmYiIvPjwvbGluZWFyR3JhZGllbnQ+PHJhZGlhbEdyYWRpZW50IGlkPSJoZyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIGN4PSI0OTQuMzY1IiBjeT0iNTI1LjE3NyIgcj0iNDMwIj48c3RvcCBzdG9wLWNvbG9yPSIjYzlkYmZmIiBzdG9wLW9wYWNpdHk9IjAuOTUiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNjOWRiZmYiIHN0b3Atb3BhY2l0eT0iMCIvPjwvcmFkaWFsR3JhZGllbnQ+PC9kZWZzPjxyZWN0IHg9IjQwIiB5PSI0MCIgd2lkdGg9Ijk0NCIgaGVpZ2h0PSI5NDQiIHJ4PSIyMDgiIGZpbGw9InVybCgjdGIpIi8+PGcgY2xpcC1wYXRoPSJ1cmwoI3RjKSI+PGNpcmNsZSBjeD0iNDk0LjM2NSIgY3k9IjUyNS4xNzciIHI9IjQzMCIgZmlsbD0idXJsKCNoZykiLz48cGF0aCBmaWxsPSIjOWZiNGRjIiBkPSJNMTcwIDE1NlExNzIuNjQgMTc1LjM2IDE5MiAxNzhRMTcyLjY0IDE4MC42NCAxNzAgMjAwUTE2Ny4zNiAxODAuNjQgMTQ4IDE3OFExNjcuMzYgMTc1LjM2IDE3MCAxNTZaIi8+PGNpcmNsZSBjeD0iMzAyIiBjeT0iMTE2IiByPSI2IiBmaWxsPSIjOWZiNGRjIiBmaWxsLW9wYWNpdHk9Ii44Ii8+PHBhdGggZmlsbD0iIzlmYjRkYyIgZD0iTTg2MCAxNDJRODYxLjkyIDE1Ni4wOCA4NzYgMTU4UTg2MS45MiAxNTkuOTIgODYwIDE3NFE4NTguMDggMTU5LjkyIDg0NCAxNThRODU4LjA4IDE1Ni4wOCA4NjAgMTQyWiIvPjxjaXJjbGUgY3g9IjkwMiIgY3k9IjQ3MCIgcj0iNiIgZmlsbD0iIzlmYjRkYyIgZmlsbC1vcGFjaXR5PSIuOCIvPjxwYXRoIGZpbGw9IiM5ZmI0ZGMiIGQ9Ik04NzggODUwUTg4MC4xNiA4NjUuODQgODk2IDg2OFE4ODAuMTYgODcwLjE2IDg3OCA4ODZRODc1Ljg0IDg3MC4xNiA4NjAgODY4UTg3NS44NCA4NjUuODQgODc4IDg1MFoiLz48Y2lyY2xlIGN4PSI3NDIiIGN5PSI5MjIiIHI9IjUiIGZpbGw9IiM5ZmI0ZGMiIGZpbGwtb3BhY2l0eT0iLjgiLz48cGF0aCBmaWxsPSIjOWZiNGRjIiBkPSJNMTUwIDg0NFExNTEuNjggODU2LjMyIDE2NCA4NThRMTUxLjY4IDg1OS42OCAxNTAgODcyUTE0OC4zMiA4NTkuNjggMTM2IDg1OFExNDguMzIgODU2LjMyIDE1MCA4NDRaIi8+PGNpcmNsZSBjeD0iMTEyIiBjeT0iNTYwIiByPSI1IiBmaWxsPSIjOWZiNGRjIiBmaWxsLW9wYWNpdHk9Ii44Ii8+PC9nPjxyZWN0IHg9IjQyIiB5PSI0MiIgd2lkdGg9Ijk0MCIgaGVpZ2h0PSI5NDAiIHJ4PSIyMDYiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2M2ZDBlMCIgc3Ryb2tlLXdpZHRoPSI0Ii8+PGcgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTE1OC44NzQgNi44OTcpIHNjYWxlKDMuOTkyOTEpIj48cGF0aCBmaWxsPSJ1cmwoI29sKSIgZD0iTTIxNi44IDgxLjhDMTc4LjIgODMuMSAxMjIuMSAxMDYuMiA5MC4xIDEzNC4zQzU1LjcgMTY0LjUgNzYuMiAxNzcgMTM1LjcgMTYzLjJDMTA0LjkgMTY3LjYgNzguOCAxNjYuNCA4NS45IDE0OUM5NS4zIDEyNy4xIDE2Ni43IDg3LjIgMjE2LjggODEuOFoiLz48ZyBtYXNrPSJ1cmwoI3hnKSI+PHBhdGggZmlsbD0idXJsKCNzbCkiIGQ9Ik0xNjMuNiA0NS4zQzE2NS41IDY0LjggMTY3LjQgOTUuNSAxNzAuOCAxMTQuMUMxNzIgMTIxLjcgMTc0LjUgMTIzLjEgMTgyLjEgMTI0LjRMMjA0LjMgMTI3LjZMMTgxLjMgMTMzLjZDMTcyLjcgMTM1LjggMTcxIDEzOS4yIDE2OS44IDE0OC4yTDE2My42IDIwNy43TDE1Ny45IDE1MS4yQzE1Ni45IDE0MS4xIDE1NC4yIDEzOC42IDE0NC41IDEzNi4xTDEyMi4yIDEzMkwxNDUuNiAxMjYuNEMxNTQuNiAxMjQuMiAxNTYuNyAxMjAuNyAxNTguMiAxMDkuOFoiLz48cGF0aCBmaWxsPSJ1cmwoI3NkKSIgY2xpcC1wYXRoPSJ1cmwoI3NjKSIgZD0iTTE2My42IDEyOS44TDE2My42IC0yNzAuMkw0NzEuNDI1IC0xMjUuNjI5WiBNMTYzLjYgMTI5LjhMNTYzLjAxNyAxMDguMjFMNDU4LjQ2MiA0MDAuMDlMMTYzLjYgNTI5LjhaIE0xNjMuNiAxMjkuOEwtMTAwLjcyNSA0MzAuMDIxTC0yMzUuODM2IDE1MS4wMjZaIi8+PC9nPjxwYXRoIGZpbGw9InVybCgjb3IpIiBkPSJNMTc2LjkgMTA3LjlDMjI1LjUgOTEuMiAyNjAuNSA5MiAyNjIuNCAxMDNDMjY4LjkgMTI4IDE4NC44IDE3NS4zIDEyMS40IDE4My4xQzEwNyAxODUuMyA5OS4zIDE4NSA5NC45IDE4Mi4yQzEzMC4zIDE4OC4zIDIxOC45IDE0OS45IDI0MC45IDExOS43QzI2NSA4OS4xIDIxNC4xIDk1LjkgMTc2LjkgMTA3LjlaIi8+PHBhdGggZmlsbD0iIzBiMWEzNiIgZD0iTTExMy44IDE0MC42QzExNC43IDE0OC44IDExNi4yIDE1MC4yIDEyMi40IDE1MS4zQzExNi41IDE1Mi42IDExNSAxNTQgMTEzLjcgMTYwLjhDMTEyLjcgMTU0LjIgMTExLjIgMTUzLjEgMTA1LjcgMTUxLjlDMTExLjcgMTUwLjYgMTEzLjMgMTQ5LjEgMTEzLjggMTQwLjZaTTIyMy43IDEwNy41QzIyNC41IDExNC42IDIyNiAxMTYgMjMxLjYgMTE3LjJDMjI1LjkgMTE4LjUgMjI0LjkgMTIwLjEgMjIzLjggMTI2LjhDMjIyLjUgMTIwLjMgMjIxLjYgMTE4LjggMjE1LjYgMTE3LjdDMjIxLjcgMTE2LjUgMjIzIDExNC45IDIyMy43IDEwNy41WiIvPjwvZz48L3N2Zz4K";

export const agent = {
  id: "tianshu",
  name: "天枢 Tianshu",
  // `bin` detects Tianshu CLI on PATH; `dir` receives a presence file from
  // the Bun companion bridge whenever Tianshu Desktop 4.1.54+ or CLI is
  // installed, so Desktop-only Windows installs are also detected cleanly.
  bin: "tianshu",
  dir: CONTROL_DIR,
  aliases: ["rivet"],
  config: CONTROL_FILE,
  format: "json",
  model: "model",
  icon: ICON,
  // rivet sends "Tianshu/1.0 (terminal coding agent)" by default
  ua: ["tianshu", "rivet"],
  notice:
    "Keep Magpie running so the bridge syncs Tianshu 4.1.54+ (Desktop & CLI). Reopen Tianshu's model picker or start a new session to apply changes. 保持 Magpie 运行以便同步天枢 4.1.54+（桌面端与 CLI）；重新打开模型列表或新开会话后生效。",
};

/** Positive integer token limit; 0 and non-integers mean unknown. */
function positiveInt(value) {
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Keeps only the Magpie model fields the companion bridge consumes. */
function normalizeModel(model) {
  if (!model || typeof model !== "object" || typeof model.id !== "string" || !model.id.trim()) {
    return undefined;
  }

  const out = { id: model.id.trim() };

  const context = positiveInt(model.context);
  if (context !== undefined) out.context = context;
  const output = positiveInt(model.output);
  if (output !== undefined) out.output = output;
  if (model.images === true) out.images = true;

  if (Array.isArray(model.efforts)) {
    const efforts = [...new Set(model.efforts.filter((e) => typeof e === "string" && e.trim()).map((e) => e.trim()))];
    if (efforts.length) out.efforts = efforts;
  }

  if (model.pricing && typeof model.pricing === "object" && !Array.isArray(model.pricing)) {
    const pricing = {};
    for (const key of ["prompt", "completion", "input_cache_read", "input_cache_write"]) {
      const raw = model.pricing[key];
      if (raw === null || raw === undefined || typeof raw === "boolean") continue;
      if (typeof raw === "string" && raw.trim() === "") continue;
      const n = typeof raw === "string" ? Number(raw.trim()) : raw;
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) pricing[key] = raw;
    }
    if (Object.keys(pricing).length) out.pricing = pricing;
  }

  if (model.status === "deprecated") {
    out.status = "deprecated";
    if (typeof model.deprecationNote === "string" && model.deprecationNote.trim()) {
      out.deprecationNote = model.deprecationNote.trim();
    }
  }

  return out;
}

export function connect({ gateway, model, models } = {}) {
  if (!gateway || typeof gateway.v1 !== "string" || !gateway.v1.trim()) {
    throw new Error("Magpie's gateway gave Tianshu no /v1 address to send requests to.");
  }
  if (typeof gateway.key !== "string" || !gateway.key.trim()) {
    throw new Error("Magpie's gateway gave Tianshu no key to send requests with.");
  }
  if (models !== undefined && models !== null && !Array.isArray(models)) {
    throw new Error("Magpie handed Tianshu's connect() a model list that is not a list; nothing was written.");
  }

  const seen = new Set();
  const normalizedModels = [];
  for (const item of models ?? []) {
    const entry = normalizeModel(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    normalizedModels.push(entry);
  }

  const out = {
    schemaVersion: 1,
    baseURL: gateway.v1.trim(),
    // Top-level string equal to gateway.key so Magpie's plugged.go records
    // `st.Mark = "gatewayKey"` and tracks wiring status accurately.
    gatewayKey: gateway.key,
    models: normalizedModels,
  };

  const selected = normalizeModel(model);
  if (selected) out.modelInfo = selected;

  return out;
}

export const _internal = { normalizeModel, positiveInt };
