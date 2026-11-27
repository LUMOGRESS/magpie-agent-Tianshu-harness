import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { inspectBridge, pathsFor, restoreBridge, syncBridge } from "./bridge.mjs";
import TianshuBridgePlugin from "./index.mjs";
import * as indexModule from "./index.mjs";
import {
  defaultRivetHome,
  discoverTargets,
  isProgramFilesPath,
  launcherConfigPath,
  parseWindowsUninstallOutput,
} from "./targets.mjs";
import { connect } from "./tianshu.agent.js";

const gateway = {
  url: "http://127.0.0.1:4321",
  v1: "http://127.0.0.1:4321/v1",
  key: "sk-magpie-secret-v1",
};

function makeTempDir(prefix = "magpie-tianshu-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/**
 * Simulates Tianshu 4.1.54's `loadConfig()` side effects on disk:
 * 1. `migrateInlineApiKeys`: moves plaintext `apiKey` to encrypted secrets.json
 *    and replaces it with `keyRef: <providerKey>`.
 * 2. Zod defaults: adds `thinking`, `maxTokens`, `unsupported`, and model defaults.
 * 3. `injectProviderKeys`: writes provider's `keys[0]` snapshot into `provider-keys.json`
 *    if absent, or shadows `provider.keys` from existing `provider-keys.json`.
 */
function simulateTianshu4154LoadConfig(rivetHome) {
  const configPath = path.join(rivetHome, "config.json");
  const pkPath = path.join(rivetHome, "provider-keys.json");
  const cfg = readJson(configPath);
  const pk = fs.existsSync(pkPath) ? readJson(pkPath) : { version: 1, providers: {} };
  let cfgChanged = false;
  let pkChanged = false;

  for (const [key, prov] of Object.entries(cfg.provider?.providers ?? {})) {
    if (!prov || typeof prov !== "object") continue;
    if (typeof prov.apiKey === "string" && prov.apiKey && !prov.keyRef) {
      delete prov.apiKey;
      prov.keyRef = key;
      cfgChanged = true;
    }
    if (!prov.thinking) {
      prov.thinking = "enabled";
      cfgChanged = true;
    }
    if (!prov.maxTokens) {
      prov.maxTokens = 64000;
      cfgChanged = true;
    }
    if (!prov.unsupported) {
      prov.unsupported = [];
      cfgChanged = true;
    }

    const models = (prov.models ?? []).map((m) => ({
      ...m,
      contextWindow: m.contextWindow ?? 524288,
      maxTokens: Math.min(m.maxTokens ?? 65536, m.contextWindow ?? 524288),
    }));

    if (prov.keyRef && !pk.providers[key]) {
      pk.providers[key] = [
        {
          id: "default",
          label: "default",
          keyRef: prov.keyRef,
          models,
        },
      ];
      pkChanged = true;
    }
  }

  if (cfgChanged) writeJson(configPath, cfg);
  if (pkChanged) writeJson(pkPath, pk);

  // Return effective contractModels view (identical to Tianshu 4.1.54 contractModels()).
  const effectiveModels = {};
  for (const [key, prov] of Object.entries(cfg.provider?.providers ?? {})) {
    if (!prov || typeof prov !== "object") continue;
    if (Array.isArray(pk.providers[key]) && pk.providers[key].length > 0) {
      effectiveModels[key] = pk.providers[key].flatMap((k) => k.models).map((m) => m.id);
    } else {
      effectiveModels[key] = (prov.models ?? []).map((m) => m.id);
    }
  }
  return { cfg, pk, effectiveModels };
}

test("targets.mjs mirrors Tianshu 4.1.54+ Windows/macOS/Linux resolution rules", () => {
  assert.equal(
    defaultRivetHome({ platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local" }, home: "C:\\Users\\Alice" }),
    "C:\\Users\\Alice\\AppData\\Local\\.rivet",
  );
  assert.equal(
    defaultRivetHome({ platform: "darwin", env: {}, home: "/Users/alice" }),
    "/Users/alice/.rivet",
  );
  assert.equal(
    launcherConfigPath({ platform: "win32", env: { APPDATA: "C:\\Users\\Alice\\AppData\\Roaming" }, home: "C:\\Users\\Alice" }),
    "C:\\Users\\Alice\\AppData\\Roaming\\app.tianshu.desktop\\launcher.json",
  );
  assert.equal(
    launcherConfigPath({ platform: "darwin", env: {}, home: "/Users/alice" }),
    "/Users/alice/Library/Application Support/app.tianshu.desktop/launcher.json",
  );
  assert.equal(
    launcherConfigPath({ platform: "linux", env: { XDG_CONFIG_HOME: "/home/alice/.cfg" }, home: "/home/alice" }),
    "/home/alice/.cfg/app.tianshu.desktop/launcher.json",
  );

  assert.equal(isProgramFilesPath("C:\\Program Files\\Tianshu", {}), true);
  assert.equal(isProgramFilesPath("C:\\Users\\Alice\\AppData\\Local\\Tianshu", {}), false);

  const regOut = `
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Tianshu
    DisplayName    REG_SZ    Tianshu
    DisplayVersion    REG_SZ    4.1.54
    InstallLocation    REG_SZ    "D:\\Apps\\Tianshu"
`;
  assert.deepEqual(parseWindowsUninstallOutput(regOut), ["D:\\Apps\\Tianshu"]);
});

test("discoverTargets finds Windows portable TianshuData + custom registry + launcher.json + platform default without ~/.rivet", () => {
  const existing = new Set([
    "c:\\users\\alice\\appdata\\local\\tianshu\\tianshudata\\.rivet",
    "d:\\tools\\tianshu\\tianshudata\\.rivet",
    "c:\\users\\alice\\appdata\\local\\.rivet",
  ]);
  const res = discoverTargets({
    platform: "win32",
    home: "C:\\Users\\Alice",
    env: {
      LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local",
      APPDATA: "C:\\Users\\Alice\\AppData\\Roaming",
    },
    exists: (p) => existing.has(p.toLowerCase()),
    readText: (p) => {
      if (p.toLowerCase().endsWith("launcher.json")) {
        return JSON.stringify({ rivetHome: "E:\\RivetStorage\\.rivet" });
      }
      throw new Error("ENOENT");
    },
    queryWindowsInstallDirs: () => ["D:\\Tools\\Tianshu"],
    hasCliBin: () => false,
  });

  assert.equal(res.detected, true);
  assert.deepEqual(
    res.targets.map((t) => [t.source, t.configPath]),
    [
      ["desktop-portable", "C:\\Users\\Alice\\AppData\\Local\\Tianshu\\TianshuData\\.rivet\\config.json"],
      ["desktop-portable", "D:\\Tools\\Tianshu\\TianshuData\\.rivet\\config.json"],
      ["launcher.json", "E:\\RivetStorage\\.rivet\\config.json"],
      ["platform-default", "C:\\Users\\Alice\\AppData\\Local\\.rivet\\config.json"],
    ],
  );
  // Must NEVER target legacy %USERPROFILE%\.rivet on Windows
  assert.equal(
    res.targets.some((t) => t.configPath.toLowerCase() === "c:\\users\\alice\\.rivet\\config.json"),
    false,
  );
});

test("syncBridge does not create files when Tianshu is not installed", () => {
  const tmp = makeTempDir();
  try {
    const p = pathsFor({ stateDir: path.join(tmp, "magpie-tianshu") });
    const res = syncBridge(p, {
      platform: "linux",
      home: tmp,
      env: {},
      exists: () => false,
      readText: () => {
        throw new Error("ENOENT");
      },
      hasCliBin: () => false,
    });
    assert.equal(res.state, "not_installed");
    assert.equal(res.detected, false);
    assert.equal(fs.existsSync(p.dir), false, "must not create control dir when Tianshu is absent");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("full 4.1.54 multi-root lifecycle: connect, Tianshu migration convergence, catalog update, provider-keys sync, and lossless restore", () => {
  const tmp = makeTempDir();
  try {
    const stateDir = path.join(tmp, "magpie-tianshu");
    const desktopHome = path.join(tmp, "Tianshu", "TianshuData", ".rivet");
    const cliHome = path.join(tmp, "LocalAppData", ".rivet");

    // Seed Desktop 4.1.54 with realistic user config: manual "magpie", "custom-api",
    // null preset tombstones, MCP servers, and an existing provider-keys.json.
    const initialDesktopCfg = {
      provider: {
        default: "magpie",
        providers: {
          "custom-api": {
            name: "custom-api",
            keyRef: "custom-api",
            baseUrl: "https://api.example.com/v1",
            protocol: "openai",
            models: [{ id: "custom-chat", contextWindow: 1000000, maxTokens: 256000 }],
            userSaved: true,
          },
          magpie: {
            name: "magpie",
            keyRef: "magpie",
            baseUrl: "http://127.0.0.1:4321/v1",
            endpointNetworkPolicy: { origin: "http://127.0.0.1:4321", allowPrivateNetwork: true },
            protocol: "openai",
            models: [{ id: "old/manual-model", contextWindow: 128000, maxTokens: 32000 }],
            userSaved: true,
          },
          "preset-a": null,
          "preset-b": null,
        },
      },
      agent: { mode: "code", maxTurns: 200 },
      mcp: { enabled: true, servers: { github: { command: "gh-mcp" } } },
    };
    const initialDesktopPk = {
      version: 1,
      providers: {
        "custom-api": [{ id: "default", label: "default", keyRef: "custom-api", models: [{ id: "custom-chat" }] }],
        magpie: [{ id: "default", label: "default", keyRef: "magpie", models: [{ id: "old/manual-model" }] }],
      },
    };
    writeJson(path.join(desktopHome, "config.json"), initialDesktopCfg);
    writeJson(path.join(desktopHome, "provider-keys.json"), initialDesktopPk);
    fs.mkdirSync(cliHome, { recursive: true });

    const p = pathsFor({ stateDir });
    const discoverOpts = {
      env: { MAGPIE_TIANSHU_HOMES: [desktopHome, cliHome].join(path.delimiter) },
    };

    // Step 1: Magpie writes connection.json with two subscriptions + routing group.
    writeJson(p.control, {
      ...connect({
        gateway,
        model: { id: "provider-a/model-pro", context: 1000000, output: 65536, images: true },
        models: [
          { id: "auto/default", context: 1048576, output: 65536, efforts: ["low", "high"] },
          { id: "provider-a/model-pro", context: 1000000, output: 65536, images: true, efforts: ["low", "high"] },
          { id: "provider-b/model-fast", context: 200000, output: 65536 },
        ],
      }),
      model: "provider-a/model-pro",
    });

    const first = syncBridge(p, discoverOpts);
    assert.equal(first.state, "connected");
    assert.equal(first.targets.length, 2);
    assert.deepEqual(first.channels, ["auto-magpie", "provider-a-magpie", "provider-b-magpie"]);

    const dCfg1 = readJson(path.join(desktopHome, "config.json"));
    assert.equal(dCfg1.provider.default, "provider-a-magpie");
    assert.equal(dCfg1.agent.defaultModel, "provider-a-magpie:provider-a/model-pro");
    assert.equal(dCfg1.provider.providers["provider-a-magpie"].name, "provider-a-magpie");
    assert.deepEqual(dCfg1.provider.providers["provider-a-magpie"].endpointNetworkPolicy, {
      origin: "http://127.0.0.1:4321",
      allowPrivateNetwork: true,
    });
    // Preserves user's manual providers, null tombstones, and MCP!
    assert.equal(dCfg1.provider.providers.magpie.models[0].id, "old/manual-model");
    assert.equal(dCfg1.provider.providers["preset-a"], null);
    assert.equal(dCfg1.provider.providers["preset-b"], null);
    assert.deepEqual(dCfg1.mcp, initialDesktopCfg.mcp);

    // CLI root synced simultaneously!
    const cCfg1 = readJson(path.join(cliHome, "config.json"));
    assert.equal(cCfg1.provider.default, "provider-a-magpie");
    assert.equal(cCfg1.agent.defaultModel, "provider-a-magpie:provider-a/model-pro");

    // Step 2: Tianshu 4.1.54 boots and migrates apiKey -> keyRef and writes provider-keys.json.
    const loaded1 = simulateTianshu4154LoadConfig(desktopHome);
    assert.equal(loaded1.cfg.provider.providers["provider-a-magpie"].apiKey, undefined);
    assert.equal(loaded1.cfg.provider.providers["provider-a-magpie"].keyRef, "provider-a-magpie");
    assert.deepEqual(loaded1.effectiveModels["provider-a-magpie"], ["provider-a/model-pro"]);

    // Step 3: Next bridge sync MUST converge with zero rewrite (no infinite loop!).
    const cfgBeforeConverge = fs.readFileSync(path.join(desktopHome, "config.json"), "utf8");
    const pkBeforeConverge = fs.readFileSync(path.join(desktopHome, "provider-keys.json"), "utf8");
    const converged = syncBridge(p, discoverOpts);
    assert.equal(converged.targets[0].status, "up_to_date");
    assert.equal(fs.readFileSync(path.join(desktopHome, "config.json"), "utf8"), cfgBeforeConverge);
    assert.equal(fs.readFileSync(path.join(desktopHome, "provider-keys.json"), "utf8"), pkBeforeConverge);

    // Step 4: Magpie catalog updates (adds a new provider-a model, drops provider-b, rotates key).
    writeJson(p.control, {
      ...connect({
        gateway: { ...gateway, key: "sk-magpie-secret-v2" },
        model: { id: "provider-a/model-next", context: 1000000, output: 128000 },
        models: [
          { id: "auto/default", context: 1048576, output: 65536, efforts: ["low", "high"] },
          { id: "provider-a/model-pro", context: 1000000, output: 65536, images: true, efforts: ["low", "high"] },
          { id: "provider-a/model-next", context: 1000000, output: 128000 },
        ],
      }),
      model: "provider-a/model-next",
    });

    const updated = syncBridge(p, discoverOpts);
    assert.equal(updated.state, "connected");
    assert.equal(updated.targets[0].status, "synced");

    const dCfg2 = readJson(path.join(desktopHome, "config.json"));
    const dPk2 = readJson(path.join(desktopHome, "provider-keys.json"));
    // provider-b-magpie removed from BOTH config.json and provider-keys.json!
    assert.equal("provider-b-magpie" in dCfg2.provider.providers, false);
    assert.equal("provider-b-magpie" in dPk2.providers, false);
    // provider-a-magpie cleared from provider-keys.json and given fresh inline apiKey without stale keyRef!
    assert.equal("provider-a-magpie" in dPk2.providers, false);
    assert.equal(dCfg2.provider.providers["provider-a-magpie"].apiKey, "sk-magpie-secret-v2");
    assert.equal("keyRef" in dCfg2.provider.providers["provider-a-magpie"], false);
    // User's own providers in provider-keys.json stay completely untouched!
    assert.deepEqual(dPk2.providers["custom-api"], initialDesktopPk.providers["custom-api"]);
    assert.deepEqual(dPk2.providers.magpie, initialDesktopPk.providers.magpie);

    // Tianshu 4.1.54 reloads -> IMMEDIATELY sees the new model (not shadowed by old provider-keys.json)!
    const loaded2 = simulateTianshu4154LoadConfig(desktopHome);
    assert.deepEqual(loaded2.effectiveModels["provider-a-magpie"], [
      "provider-a/model-pro",
      "provider-a/model-next",
    ]);

    // Step 5: If provider-keys.json gets stale for a managed channel, bridge detects & repairs it!
    const poisonedPk = readJson(path.join(desktopHome, "provider-keys.json"));
    poisonedPk.providers["provider-a-magpie"][0].models = [{ id: "provider-a/stale-removed-model" }];
    writeJson(path.join(desktopHome, "provider-keys.json"), poisonedPk);
    const repaired = syncBridge(p, discoverOpts);
    assert.equal(repaired.targets[0].status, "synced");
    assert.equal("provider-a-magpie" in readJson(path.join(desktopHome, "provider-keys.json")).providers, false);

    // Step 6: Status file NEVER leaks gateway keys.
    const statusText = fs.readFileSync(p.status, "utf8");
    assert.equal(statusText.includes("sk-magpie-secret"), false, "status.json must never contain gatewayKey");

    // Step 7: Disconnect (Magpie clears connection.json) -> lossless restore across all roots!
    writeJson(p.control, {});
    const disconnected = syncBridge(p, discoverOpts);
    assert.equal(disconnected.state, "disconnected");

    const restoredDesktopCfg = readJson(path.join(desktopHome, "config.json"));
    const restoredDesktopPk = readJson(path.join(desktopHome, "provider-keys.json"));
    assert.equal(restoredDesktopCfg.provider.default, "magpie");
    assert.equal("defaultModel" in restoredDesktopCfg.agent, false, "originally absent agent.defaultModel must be removed");
    assert.equal("auto-magpie" in restoredDesktopCfg.provider.providers, false);
    assert.equal("provider-a-magpie" in restoredDesktopCfg.provider.providers, false);
    assert.equal("auto-magpie" in restoredDesktopPk.providers, false);
    assert.equal("provider-a-magpie" in restoredDesktopPk.providers, false);
    assert.equal(restoredDesktopCfg.provider.providers["preset-a"], null);
    assert.equal(restoredDesktopCfg.provider.providers["preset-b"], null);
    assert.deepEqual(restoredDesktopCfg.mcp, initialDesktopCfg.mcp);
    assert.equal(fs.existsSync(p.state), false, "state.json should be removed once fully disconnected");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("catalog-only refresh respects user's manual model switch inside Tianshu, and disconnect respects it too", () => {
  const tmp = makeTempDir();
  try {
    const stateDir = path.join(tmp, "magpie-tianshu");
    const rivetHome = path.join(tmp, "rivet");
    writeJson(path.join(rivetHome, "config.json"), {
      provider: {
        default: "custom-api",
        providers: {
          "custom-api": {
            name: "custom-api",
            baseUrl: "https://api.example.com/v1",
            protocol: "openai",
            models: [{ id: "custom-chat" }],
            userSaved: true,
          },
        },
      },
      agent: { defaultModel: "custom-api:custom-chat" },
    });

    const p = pathsFor({ stateDir });
    const discoverOpts = { env: { MAGPIE_TIANSHU_HOMES: rivetHome } };

    // Connect with provider-a/m1 selected
    writeJson(p.control, {
      ...connect({
        gateway,
        model: { id: "provider-a/m1" },
        models: [{ id: "provider-a/m1" }],
      }),
      model: "provider-a/m1",
    });
    syncBridge(p, discoverOpts);

    // User manually switches back to custom-api inside Tianshu while keeping Magpie channels around
    const edited = readJson(path.join(rivetHome, "config.json"));
    edited.provider.default = "custom-api";
    edited.agent.defaultModel = "custom-api:custom-chat";
    writeJson(path.join(rivetHome, "config.json"), edited);

    // Magpie background catalog refresh adds provider-a/m2 (same selected model provider-a/m1)
    writeJson(p.control, {
      ...connect({
        gateway,
        model: { id: "provider-a/m1" },
        models: [{ id: "provider-a/m1" }, { id: "provider-a/m2" }],
      }),
      model: "provider-a/m1",
    });
    syncBridge(p, discoverOpts);

    const afterRefresh = readJson(path.join(rivetHome, "config.json"));
    assert.equal(afterRefresh.provider.default, "custom-api");
    assert.equal(afterRefresh.agent.defaultModel, "custom-api:custom-chat");
    assert.deepEqual(
      afterRefresh.provider.providers["provider-a-magpie"].models.map((m) => m.id),
      ["provider-a/m1", "provider-a/m2"],
    );

    // Manual restoreBridge cleans managed channels while leaving custom-api intact
    const res = restoreBridge(p, discoverOpts);
    assert.equal(res.state, "disconnected");
    const afterRestore = readJson(path.join(rivetHome, "config.json"));
    assert.equal("provider-a-magpie" in afterRestore.provider.providers, false);
    assert.equal(afterRestore.provider.default, "custom-api");
    assert.equal(afterRestore.agent.defaultModel, "custom-api:custom-chat");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("inspectBridge is read-only and reports discovered targets accurately", () => {
  const tmp = makeTempDir();
  try {
    const stateDir = path.join(tmp, "magpie-tianshu");
    const rivetHome = path.join(tmp, "rivet");
    writeJson(path.join(rivetHome, "config.json"), { provider: { default: "custom-api", providers: {} } });
    const p = pathsFor({ stateDir });
    const info = inspectBridge(p, { env: { MAGPIE_TIANSHU_HOMES: rivetHome } });
    assert.equal(info.detected, true);
    assert.equal(info.controlConnected, false);
    assert.equal(info.targets.length, 1);
    assert.equal(info.targets[0].configExists, true);
    assert.equal(fs.existsSync(stateDir), false, "inspectBridge must not create state files");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("index.mjs exports only the default plugin function (no stray exports for Magpie host)", () => {
  assert.deepEqual(Object.keys(indexModule), ["default"]);
  assert.equal(typeof TianshuBridgePlugin, "function");
});

test("pending journal recovers cleanly after an interrupted commit", () => {
  const tmp = makeTempDir();
  try {
    const stateDir = path.join(tmp, "state");
    const rivetHome = path.join(tmp, "rivet");
    const configPath = path.join(rivetHome, "config.json");
    const before = JSON.stringify({ provider: { default: "custom-api", providers: {} } }, null, 2) + "\n";
    const after = JSON.stringify({ provider: { default: "auto-magpie", providers: {} } }, null, 2) + "\n";
    fs.mkdirSync(rivetHome, { recursive: true });
    fs.writeFileSync(configPath, before, "utf8");

    const p = pathsFor({ stateDir });
    writeJson(p.pending, {
      version: 1,
      changes: [{ file: configPath, before, after }],
      nextState: null,
    });

    const res = syncBridge(p, { env: { MAGPIE_TIANSHU_HOMES: rivetHome } });
    assert.equal(res.state, "disconnected");
    assert.equal(fs.readFileSync(configPath, "utf8"), after);
    assert.equal(fs.existsSync(p.pending), false, "pending journal must be removed after recovery");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("reclaims stale dead-PID lock and reclaim guard without deadlocking", () => {
  const tmp = makeTempDir();
  try {
    const stateDir = path.join(tmp, "state");
    const rivetHome = path.join(tmp, "rivet");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(rivetHome, { recursive: true });
    const p = pathsFor({ stateDir });
    writeJson(p.lock, { pid: 999999, token: "dead-lock" });
    writeJson(`${p.lock}.reclaim`, { pid: 999999, token: "dead-guard" });
    const res = syncBridge(p, { env: { MAGPIE_TIANSHU_HOMES: rivetHome } });
    assert.equal(res.state, "disconnected");
    assert.equal(fs.existsSync(p.lock), false);
    assert.equal(fs.existsSync(`${p.lock}.reclaim`), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("refuses symlinked/junction target directories cleanly", () => {
  const tmp = makeTempDir();
  try {
    const realDir = path.join(tmp, "real-rivet");
    const linkDir = path.join(tmp, "link-rivet");
    const stateDir = path.join(tmp, "state");
    fs.mkdirSync(realDir, { recursive: true });
    fs.symlinkSync(realDir, linkDir, process.platform === "win32" ? "junction" : "dir");
    const p = pathsFor({ stateDir });
    writeJson(p.control, {
      ...connect({ gateway, model: { id: "auto/m1" }, models: [{ id: "auto/m1" }] }),
      model: "auto/m1",
    });
    const res = syncBridge(p, { env: { MAGPIE_TIANSHU_HOMES: linkDir } });
    assert.equal(res.state, "partial_error");
    assert.equal(res.targets[0].status, "error");
    assert.match(res.targets[0].error, /symlink/i);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("fails fast with LOCKED when current PID holds bridge.lock", () => {
  const tmp = makeTempDir();
  try {
    const stateDir = path.join(tmp, "state");
    const rivetHome = path.join(tmp, "rivet");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(rivetHome, { recursive: true });
    const p = pathsFor({ stateDir });
    writeJson(p.lock, { pid: process.pid, token: "self-held" });
    const started = Date.now();
    assert.throws(
      () => syncBridge(p, { env: { MAGPIE_TIANSHU_HOMES: rivetHome } }),
      (err) => err?.code === "LOCKED",
    );
    assert.ok(Date.now() - started < 200, "same-PID lock should fail fast without sleeping");
    assert.equal(fs.existsSync(`${p.lock}.reclaim`), false, "live lock contention must not leave .reclaim");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("waits briefly and succeeds when another live process releases bridge.lock", async () => {
  const tmp = makeTempDir();
  try {
    const stateDir = path.join(tmp, "state");
    const rivetHome = path.join(tmp, "rivet");
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(rivetHome, { recursive: true });
    const p = pathsFor({ stateDir });
    const child = spawn(
      process.execPath,
      [
        "-e",
        "const fs=require('node:fs'); const f=process.argv[1]; fs.writeFileSync(f, JSON.stringify({pid:process.pid,token:'peer'})); setTimeout(()=>{ try{fs.unlinkSync(f);}catch{} }, 120);",
        p.lock,
      ],
      { stdio: "ignore" },
    );
    const deadline = Date.now() + 2000;
    while (!fs.existsSync(p.lock) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(fs.existsSync(p.lock), true, "child process should create bridge.lock");
    const res = syncBridge(p, { env: { MAGPIE_TIANSHU_HOMES: rivetHome } });
    assert.equal(res.state, "disconnected");
    await new Promise((resolve) => child.once("exit", resolve));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
