// Reversible, atomic multi-root bridge syncing Magpie's control JSON into
// every active Tianshu (rivet harness) 4.1.54+ installation (Desktop & CLI).
//
// Responsibilities:
// - Discover all Tianshu 4.1.54+ roots via targets.mjs (portable TianshuData,
//   launcher.json, RIVET_HOME / RIVET_CONFIG_PATH, platform defaults).
// - Translate Magpie's connection.json into per-software `<software>-magpie`
//   channels strictly matching 4.1.54 schemas (`provider.name === key`,
//   `endpointNetworkPolicy` for local/private gateways, `userSaved: true`,
//   reasoning capabilities, per-million pricing).
// - Keep sibling `provider-keys.json` in lockstep so Tianshu 4.1.54 never
//   shadows model updates with stale snapshots, while converging cleanly with
//   Tianshu's own `apiKey -> keyRef` secrets migration (zero rewrite loops).
// - Preserve all user providers, `null` preset tombstones, MCP/UI/agent config,
//   and restore original values cleanly on disconnect.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { processExists } from "./proc.mjs";
import {
  buildTianshuDesired,
  canonicalJSON,
  modelsEquivalent,
  providerEquivalent,
} from "./schema.mjs";
import { canonicalTargetKey, discoverTargets } from "./targets.mjs";
import { CONTROL_FILE } from "./tianshu.agent.js";

const STATE_VERSION = 1;
const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const activeBridges = new Map();

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = (v) => structuredClone(v);
const absent = () => ({ exists: false });
const present = (value) => ({ exists: true, value: clone(value) });

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // fallback wait if SharedArrayBuffer is unavailable
    }
  }
}

/** Resolves all control and state paths for the bridge. */
export function pathsFor({ home = os.homedir(), stateDir } = {}) {
  const control = stateDir
    ? path.join(path.resolve(stateDir), "connection.json")
    : path.resolve(CONTROL_FILE.replace(/^~(?=\/|$)/, home));
  const dir = path.dirname(control);
  return {
    dir,
    control,
    state: path.join(dir, "state.json"),
    pending: path.join(dir, "state.json.pending"),
    lock: path.join(dir, "bridge.lock"),
    status: path.join(dir, "status.json"),
  };
}

function assertNotSymlink(file, isDir = false) {
  const absolute = path.resolve(file);
  try {
    const parent = path.dirname(absolute);
    // Resolve only the parent so a live symlink or NTFS junction at the leaf
    // (file OR directory) is still seen as a symlink by lstatSync.
    let target = absolute;
    if (parent !== absolute) {
      const resolvedParent = fs.existsSync(parent) ? fs.realpathSync(parent) : parent;
      target = path.join(resolvedParent, path.basename(absolute));
    }
    const st = fs.lstatSync(target);
    if (st.isSymbolicLink()) throw Object.assign(new Error(`Refusing symlink: ${file}`), { code: "SYMLINK_REFUSED" });
    if (isDir ? !st.isDirectory() : !st.isFile()) {
      throw Object.assign(new Error(`Unexpected file type: ${file}`), { code: "NOT_REGULAR_FILE" });
    }
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

function readTextSafe(file) {
  if (!assertNotSymlink(file, false)) return null;
  return fs.readFileSync(file, "utf8");
}

function readJsonSafe(file) {
  const raw = readTextSafe(file);
  if (raw === null) return null;
  const cleaned = raw.replace(/^\uFEFF/, "");
  const trimmed = cleaned.trim();
  if (!trimmed) return { text: raw, data: {} };
  let data;
  try {
    data = JSON.parse(cleaned);
  } catch {
    throw Object.assign(new Error(`Invalid JSON in ${path.basename(file)}`), { code: "INVALID_JSON" });
  }
  if (!isPlainObject(data)) {
    throw Object.assign(new Error(`Expected JSON object in ${path.basename(file)}`), { code: "JSON_OBJECT_REQUIRED" });
  }
  return { text: raw, data };
}

function unlinkWithRetry(file) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.unlinkSync(file);
      return;
    } catch (err) {
      if (err?.code === "ENOENT") return;
      if (process.platform === "win32" && RETRY_CODES.has(err?.code) && attempt < 5) {
        sleepSync(15 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

function renameAtomic(temp, dest) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      fs.renameSync(temp, dest);
      return;
    } catch (err) {
      if (process.platform === "win32" && RETRY_CODES.has(err?.code) && attempt < 5) {
        sleepSync(15 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

function writeTextAtomic(file, text) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertNotSymlink(dir, true);
  if (text === null) {
    if (assertNotSymlink(file, false)) unlinkWithRetry(file);
    return;
  }
  assertNotSymlink(file, false);
  const temp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, text, { flag: "wx", mode: 0o600 });
    assertNotSymlink(file, false);
    renameAtomic(temp, file);
  } finally {
    try {
      if (fs.existsSync(temp)) unlinkWithRetry(temp);
    } catch {
      // ignore temp cleanup failure
    }
  }
}

function formatJson(obj) {
  return `${JSON.stringify(obj, null, 2)}\n`;
}

const STALE_CORRUPT_LOCK_MS = 10_000;
const LOCK_RETRY_DELAYS = [25, 35, 50, 65, 80, 100, 120, 150];

function inspectLockFile(file) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (err) {
    if (err?.code === "ENOENT") return { state: "absent", samePid: false };
    throw err;
  }
  if (st.isSymbolicLink()) throw Object.assign(new Error(`Refusing symlink: ${file}`), { code: "SYMLINK_REFUSED" });
  try {
    const held = readJsonSafe(file)?.data;
    if (held && Number.isSafeInteger(held.pid) && held.pid > 0 && typeof held.token === "string") {
      if (!processExists(held.pid)) return { state: "stale", samePid: false };
      return { state: "held", samePid: held.pid === process.pid };
    }
  } catch {
    // Truncated / half-written lock file from an interrupted crash: reclaim once stale.
  }
  return Date.now() - st.mtimeMs >= STALE_CORRUPT_LOCK_MS
    ? { state: "stale", samePid: false }
    : { state: "held", samePid: false };
}

function tryAcquireLockOnce(lockFile) {
  const dir = path.dirname(lockFile);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertNotSymlink(dir, true);

  const token = crypto.randomUUID();
  const payload = JSON.stringify({ pid: process.pid, token });
  const create = () => fs.writeFileSync(lockFile, payload, { flag: "wx", mode: 0o600 });
  const release = () => {
    try {
      const held = readJsonSafe(lockFile);
      if (held?.data?.token === token) unlinkWithRetry(lockFile);
    } catch {
      // ignore release failure
    }
  };

  assertNotSymlink(lockFile, false);
  try {
    create();
    return release;
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
  }

  // Peek before touching .reclaim so normal cross-process contention avoids guard churn.
  const peek = inspectLockFile(lockFile);
  if (peek.state === "held") {
    throw Object.assign(new Error("Another bridge sync is running"), { code: "LOCKED", samePid: peek.samePid });
  }
  if (peek.state === "absent") {
    try {
      create();
      return release;
    } catch (err) {
      if (err?.code === "EEXIST") {
        throw Object.assign(new Error("Another bridge sync took the lock"), { code: "LOCKED", samePid: false });
      }
      throw err;
    }
  }

  // Reclaim stale lock safely behind a short-lived exclusive guard.
  // If a prior reclaimer crashed leaving a stale guard behind, clean it up once.
  const guard = `${lockFile}.reclaim`;
  assertNotSymlink(guard, false);
  try {
    fs.writeFileSync(guard, payload, { flag: "wx", mode: 0o600 });
  } catch (err) {
    if (err?.code !== "EEXIST") throw err;
    const guardInfo = inspectLockFile(guard);
    if (guardInfo.state === "held") {
      throw Object.assign(new Error("Bridge lock reclaim in progress"), {
        code: "LOCKED",
        samePid: guardInfo.samePid,
      });
    }
    try {
      if (guardInfo.state === "stale") unlinkWithRetry(guard);
      fs.writeFileSync(guard, payload, { flag: "wx", mode: 0o600 });
    } catch {
      throw Object.assign(new Error("Bridge lock reclaim in progress"), { code: "LOCKED", samePid: false });
    }
  }
  try {
    const info = inspectLockFile(lockFile);
    if (info.state === "held") {
      throw Object.assign(new Error("Another bridge sync is running"), { code: "LOCKED", samePid: info.samePid });
    }
    if (info.state === "stale" && assertNotSymlink(lockFile, false)) {
      unlinkWithRetry(lockFile);
    }
    try {
      create();
    } catch (err) {
      if (err?.code === "EEXIST") {
        throw Object.assign(new Error("Another bridge sync took the lock"), { code: "LOCKED", samePid: false });
      }
      throw err;
    }
    return release;
  } finally {
    try {
      const g = readJsonSafe(guard);
      if (g?.data?.token === token) unlinkWithRetry(guard);
    } catch {
      // ignore guard cleanup error
    }
  }
}

function acquireLock(lockFile) {
  for (let attempt = 0; ; attempt++) {
    try {
      return tryAcquireLockOnce(lockFile);
    } catch (err) {
      if (err?.code === "LOCKED" && !err.samePid && attempt < LOCK_RETRY_DELAYS.length) {
        sleepSync(LOCK_RETRY_DELAYS[attempt]);
        continue;
      }
      throw err;
    }
  }
}

/** Recovers any interrupted multi-file commit recorded in `state.json.pending`. */
function recoverPending(p) {
  const journal = readJsonSafe(p.pending)?.data;
  if (!journal) return;
  if (!Array.isArray(journal.changes)) {
    throw Object.assign(new Error("Corrupt bridge pending journal"), { code: "INVALID_JOURNAL" });
  }
  for (const change of journal.changes) {
    if (!change || typeof change.file !== "string") {
      throw Object.assign(new Error("Invalid bridge journal entry"), { code: "INVALID_JOURNAL" });
    }
    const current = readTextSafe(change.file);
    if (current !== change.before && current !== change.after) {
      throw Object.assign(
        new Error(`Bridge recovery paused: ${path.basename(change.file)} changed concurrently`),
        { code: "RECOVERY_CONFLICT" },
      );
    }
  }
  for (const change of journal.changes) {
    if (readTextSafe(change.file) !== change.after) {
      writeTextAtomic(change.file, change.after);
    }
  }
  if (journal.nextState === null) {
    writeTextAtomic(p.state, null);
  } else {
    writeTextAtomic(p.state, formatJson(journal.nextState));
  }
  writeTextAtomic(p.pending, null);
}

function commitChanges(p, changes, nextState) {
  for (const change of changes) {
    if (readTextSafe(change.file) !== change.before) {
      throw Object.assign(
        new Error(`Target ${path.basename(change.file)} changed during bridge commit`),
        { code: "CONCURRENT_EDIT" },
      );
    }
  }
  writeTextAtomic(p.pending, formatJson({ version: STATE_VERSION, changes, nextState }));
  recoverPending(p);
}

function emptyState() {
  return { version: STATE_VERSION, targets: {} };
}

function readBridgeState(p) {
  const parsed = readJsonSafe(p.state)?.data;
  if (!parsed) return emptyState();
  if (parsed.version !== STATE_VERSION || !isPlainObject(parsed.targets)) {
    return emptyState();
  }
  return parsed;
}

/** Extracts the effective union of models for a provider inside `provider-keys.json`. */
function poolModelsFromKeysDoc(pkDoc, providerKey) {
  const entries = pkDoc?.providers?.[providerKey];
  if (!Array.isArray(entries) || entries.length === 0) return null;
  const seen = new Set();
  const out = [];
  for (const keyEntry of entries) {
    if (!isPlainObject(keyEntry) || !Array.isArray(keyEntry.models)) continue;
    for (const m of keyEntry.models) {
      if (!isPlainObject(m) || typeof m.id !== "string" || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push(m);
    }
  }
  return out;
}

/**
 * Checks whether a target root already satisfies `want`, accounting for
 * Tianshu 4.1.54's legitimate post-load migrations (`apiKey -> keyRef`,
 * Zod model defaults, and generated `provider-keys.json`).
 */
function isTargetConverged(cfg, pkDoc, targetState, want) {
  if (!targetState || targetState.lastControlHash !== want.hash) return false;
  if (!isPlainObject(cfg?.provider) || !isPlainObject(cfg.provider.providers)) return false;

  const liveProviders = cfg.provider.providers;
  const wantKeys = new Set(want.channelKeys);

  // Every previously managed provider no longer in `want` must already be gone.
  for (const oldKey of targetState.managedProviders ?? []) {
    if (wantKeys.has(oldKey)) continue;
    if (hasOwn(liveProviders, oldKey)) return false;
    if (pkDoc?.providers && hasOwn(pkDoc.providers, oldKey)) return false;
  }

  // Every desired channel must match in config.json AND not be shadowed by stale provider-keys.json.
  for (const key of want.channelKeys) {
    const wantP = want.providersByKey[key];
    const liveP = liveProviders[key];
    if (!providerEquivalent(key, liveP, wantP, { allowKeyRef: true })) return false;

    const pkEntries = pkDoc?.providers?.[key];
    if (Array.isArray(pkEntries) && pkEntries.length > 0) {
      const credsOk = pkEntries.every((entry) => {
        if (!isPlainObject(entry)) return false;
        const okKeyRef = entry.keyRef === key && !entry.apiKey && !entry.apiKeyEnv;
        const okInline = entry.apiKey === wantP.apiKey && !entry.keyRef && !entry.apiKeyEnv;
        return okKeyRef || okInline;
      });
      if (!credsOk) return false;
      const poolModels = poolModelsFromKeysDoc(pkDoc, key);
      if (poolModels !== null && !modelsEquivalent(poolModels, wantP.models)) {
        return false;
      }
    }
  }

  return true;
}

function applyConnectToTarget(target, targetState, want) {
  assertNotSymlink(path.dirname(target.configPath), true);
  const cfgRead = readJsonSafe(target.configPath);
  const beforeCfgText = cfgRead ? cfgRead.text : null;
  const cfg = cfgRead ? clone(cfgRead.data) : {};

  const pkRead = readJsonSafe(target.providerKeysPath);
  const beforePkText = pkRead ? pkRead.text : null;
  const pkDoc = pkRead ? clone(pkRead.data) : null;

  if (isTargetConverged(cfg, pkDoc, targetState, want)) {
    return {
      changed: false,
      changes: [],
      nextTargetState: targetState,
    };
  }

  // Ensure structure while preserving every unrelated key and null tombstone.
  if (!isPlainObject(cfg.provider)) cfg.provider = {};
  if (!isPlainObject(cfg.provider.providers)) cfg.provider.providers = {};

  const prevState = targetState
    ? clone(targetState)
    : {
        configPath: target.configPath,
        providerKeysPath: target.providerKeysPath,
        lastControlHash: null,
        managedProviders: [],
        beforeDefault: hasOwn(cfg.provider, "default") ? present(cfg.provider.default) : absent(),
        beforeDefaultModel:
          isPlainObject(cfg.agent) && hasOwn(cfg.agent, "defaultModel")
            ? present(cfg.agent.defaultModel)
            : absent(),
        createdAgentSection: !hasOwn(cfg, "agent"),
        beforeProviders: {},
        beforeProviderKeys: {},
        appliedDefault: null,
        appliedDefaultModel: null,
      };

  const wantKeys = new Set(want.channelKeys);
  const prevManaged = new Set(prevState.managedProviders ?? []);
  let pkModified = false;

  // 1. Remove channels that disappeared from Magpie's catalog.
  for (const oldKey of prevManaged) {
    if (wantKeys.has(oldKey)) continue;
    const savedBefore = prevState.beforeProviders?.[oldKey];
    if (savedBefore?.exists) {
      cfg.provider.providers[oldKey] = clone(savedBefore.value);
    } else {
      delete cfg.provider.providers[oldKey];
    }
    delete prevState.beforeProviders[oldKey];

    if (pkDoc && isPlainObject(pkDoc.providers)) {
      const savedPk = prevState.beforeProviderKeys?.[oldKey];
      if (savedPk?.exists) {
        pkDoc.providers[oldKey] = clone(savedPk.value);
        pkModified = true;
      } else if (hasOwn(pkDoc.providers, oldKey)) {
        delete pkDoc.providers[oldKey];
        pkModified = true;
      }
    }
    delete prevState.beforeProviderKeys[oldKey];
  }

  // 2. Write each active channel cleanly (inline apiKey, no stale keyRef,
  //    name === key, endpointNetworkPolicy, userSaved: true, fresh models).
  for (const key of want.channelKeys) {
    if (!hasOwn(prevState.beforeProviders, key)) {
      prevState.beforeProviders[key] = hasOwn(cfg.provider.providers, key)
        ? present(cfg.provider.providers[key])
        : absent();
    }
    if (!hasOwn(prevState.beforeProviderKeys, key)) {
      const hasPkEntry = pkDoc && isPlainObject(pkDoc.providers) && hasOwn(pkDoc.providers, key);
      prevState.beforeProviderKeys[key] = hasPkEntry ? present(pkDoc.providers[key]) : absent();
    }

    cfg.provider.providers[key] = clone(want.providersByKey[key]);

    // Clear managed channel entry from provider-keys.json so Tianshu 4.1.54's
    // next loadConfig() migrates the fresh apiKey into secrets.json and rebuilds
    // provider-keys.json from our fresh models without shadowing.
    if (pkDoc && isPlainObject(pkDoc.providers) && hasOwn(pkDoc.providers, key)) {
      delete pkDoc.providers[key];
      pkModified = true;
    }
  }

  // 3. Point provider.default & agent.defaultModel at the chosen Magpie model.
  //    On initial connect or whenever the user picks a new model in Magpie,
  //    update both keys. On background catalog-only refreshes (same selection),
  //    preserve any manual model switch the user made inside Tianshu unless it
  //    now points at a removed Magpie channel/model.
  const isInitialConnect = !targetState;
  const selectionChanged =
    isInitialConnect ||
    prevState.appliedDefault !== want.defaultProvider ||
    (prevState.appliedDefaultModel ?? null) !== (want.defaultModel ?? null);

  const curDefaultProvider = cfg.provider.default;
  const defaultProviderBroken =
    typeof curDefaultProvider !== "string" ||
    !curDefaultProvider ||
    (prevManaged.has(curDefaultProvider) && !wantKeys.has(curDefaultProvider));

  const curDefaultModel = isPlainObject(cfg.agent) ? cfg.agent.defaultModel : undefined;
  let defaultModelBroken = false;
  if (typeof curDefaultModel === "string") {
    const colon = curDefaultModel.indexOf(":");
    if (colon > 0) {
      const provKey = curDefaultModel.slice(0, colon);
      const modelId = curDefaultModel.slice(colon + 1);
      if (prevManaged.has(provKey) || wantKeys.has(provKey)) {
        const listed = want.providersByKey[provKey]?.models ?? [];
        defaultModelBroken = !listed.some((m) => m.id === modelId);
      }
    }
  }

  if (selectionChanged || defaultProviderBroken || (defaultModelBroken && want.defaultModel)) {
    cfg.provider.default = want.defaultProvider;
  }

  if (want.defaultModel) {
    if (selectionChanged || defaultModelBroken || curDefaultModel === undefined) {
      if (!isPlainObject(cfg.agent)) cfg.agent = {};
      cfg.agent.defaultModel = want.defaultModel;
    }
  } else if (
    isPlainObject(cfg.agent) &&
    hasOwn(cfg.agent, "defaultModel") &&
    (defaultModelBroken || (prevState.appliedDefaultModel && cfg.agent.defaultModel === prevState.appliedDefaultModel))
  ) {
    if (prevState.beforeDefaultModel?.exists) cfg.agent.defaultModel = clone(prevState.beforeDefaultModel.value);
    else delete cfg.agent.defaultModel;
  }

  const nextTargetState = {
    ...prevState,
    configPath: target.configPath,
    providerKeysPath: target.providerKeysPath,
    lastControlHash: want.hash,
    managedProviders: [...want.channelKeys],
    appliedDefault: want.defaultProvider,
    appliedDefaultModel: want.defaultModel ?? null,
  };

  const afterCfgText = formatJson(cfg);
  const changes = [];
  if (afterCfgText !== beforeCfgText) {
    changes.push({ file: target.configPath, before: beforeCfgText, after: afterCfgText });
  }
  if (pkDoc && pkModified) {
    const afterPkText = formatJson(pkDoc);
    if (afterPkText !== beforePkText) {
      changes.push({ file: target.providerKeysPath, before: beforePkText, after: afterPkText });
    }
  }

  return {
    changed: changes.length > 0 || canonicalJSON(targetState) !== canonicalJSON(nextTargetState),
    changes,
    nextTargetState,
  };
}

function applyDisconnectToTarget(targetState) {
  assertNotSymlink(path.dirname(targetState.configPath), true);
  const cfgRead = readJsonSafe(targetState.configPath);
  const pkRead = readJsonSafe(targetState.providerKeysPath);
  const changes = [];

  const managed = targetState.managedProviders ?? [];
  const managedSet = new Set(managed);

  if (cfgRead) {
    const cfg = clone(cfgRead.data);
    let cfgModified = false;

    if (isPlainObject(cfg.provider) && isPlainObject(cfg.provider.providers)) {
      for (const key of managed) {
        const savedBefore = targetState.beforeProviders?.[key];
        if (savedBefore?.exists) {
          cfg.provider.providers[key] = clone(savedBefore.value);
          cfgModified = true;
        } else if (hasOwn(cfg.provider.providers, key)) {
          delete cfg.provider.providers[key];
          cfgModified = true;
        }
      }
    }

    // Restore provider.default only if it still points to a Magpie-managed channel.
    if (isPlainObject(cfg.provider) && hasOwn(cfg.provider, "default")) {
      const curDefault = cfg.provider.default;
      if (curDefault === targetState.appliedDefault || managedSet.has(curDefault)) {
        if (targetState.beforeDefault?.exists) {
          cfg.provider.default = clone(targetState.beforeDefault.value);
        } else {
          delete cfg.provider.default;
        }
        cfgModified = true;
      }
    }

    // Restore agent.defaultModel only if it still points to a Magpie-managed model.
    if (isPlainObject(cfg.agent) && hasOwn(cfg.agent, "defaultModel")) {
      const curModel = cfg.agent.defaultModel;
      const pointsManaged =
        curModel === targetState.appliedDefaultModel ||
        (typeof curModel === "string" && managed.some((k) => curModel.startsWith(`${k}:`)));
      if (pointsManaged) {
        if (targetState.beforeDefaultModel?.exists) {
          cfg.agent.defaultModel = clone(targetState.beforeDefaultModel.value);
        } else {
          delete cfg.agent.defaultModel;
        }
        cfgModified = true;
      }
      if (targetState.createdAgentSection && Object.keys(cfg.agent).length === 0) {
        delete cfg.agent;
        cfgModified = true;
      }
    }

    if (cfgModified) {
      const afterCfgText = formatJson(cfg);
      if (afterCfgText !== cfgRead.text) {
        changes.push({ file: targetState.configPath, before: cfgRead.text, after: afterCfgText });
      }
    }
  }

  if (pkRead && isPlainObject(pkRead.data?.providers)) {
    const pkDoc = clone(pkRead.data);
    let pkModified = false;
    for (const key of managed) {
      const savedPk = targetState.beforeProviderKeys?.[key];
      if (savedPk?.exists) {
        pkDoc.providers[key] = clone(savedPk.value);
        pkModified = true;
      } else if (hasOwn(pkDoc.providers, key)) {
        delete pkDoc.providers[key];
        pkModified = true;
      }
    }
    if (pkModified) {
      const afterPkText = formatJson(pkDoc);
      if (afterPkText !== pkRead.text) {
        changes.push({ file: targetState.providerKeysPath, before: pkRead.text, after: afterPkText });
      }
    }
  }

  return { changes };
}

function writeStatusIfChanged(p, statusObj) {
  const nextText = formatJson(statusObj);
  let prevText = null;
  try {
    prevText = readTextSafe(p.status);
  } catch {
    prevText = null;
  }
  if (prevText !== nextText) {
    writeTextAtomic(p.status, nextText);
  }
}

/**
 * Runs one full reconciliation pass between Magpie's control file and every
 * discovered Tianshu 4.1.54+ target root. Never writes secrets into status.json.
 */
export function syncBridge(p = pathsFor(), discoverOpts = {}) {
  const { targets, detected } = discoverTargets(discoverOpts);
  const controlExists = fs.existsSync(p.control);
  const stateExists = fs.existsSync(p.state);
  const pendingExists = fs.existsSync(p.pending);

  // If Tianshu is not installed and Magpie has never wired this plugin, leave
  // the filesystem untouched so Magpie does not falsely detect Tianshu.
  if (!detected && !controlExists && !stateExists && !pendingExists) {
    return {
      version: STATE_VERSION,
      state: "not_installed",
      detected: false,
      targets: [],
    };
  }

  const release = acquireLock(p.lock);
  try {
    recoverPending(p);

    const state = readBridgeState(p);
    const controlRaw = readJsonSafe(p.control)?.data ?? null;
    const want = buildTianshuDesired(controlRaw);

    const targetSummaries = [];
    const nextTargetsState = {};
    const allChanges = [];

    if (want) {
      const activeKeys = new Set();

      for (const target of targets) {
        activeKeys.add(target.key);
        const existingState = state.targets[target.key] ?? null;
        try {
          const res = applyConnectToTarget(target, existingState, want);
          allChanges.push(...res.changes);
          nextTargetsState[target.key] = res.nextTargetState;
          targetSummaries.push({
            source: target.source,
            rivetHome: target.rivetHome,
            configPath: target.configPath,
            status: res.changed ? "synced" : "up_to_date",
            channels: [...want.channelKeys],
            defaultProvider: want.defaultProvider,
            ...(want.defaultModel ? { defaultModel: want.defaultModel } : {}),
          });
        } catch (err) {
          if (existingState) nextTargetsState[target.key] = existingState;
          targetSummaries.push({
            source: target.source,
            rivetHome: target.rivetHome,
            configPath: target.configPath,
            status: "error",
            error: err?.message ?? String(err),
          });
        }
      }

      // Restore any previously synced target that is no longer discovered.
      for (const [oldKey, oldState] of Object.entries(state.targets)) {
        if (activeKeys.has(oldKey)) continue;
        try {
          const { changes } = applyDisconnectToTarget(oldState);
          allChanges.push(...changes);
        } catch (err) {
          nextTargetsState[oldKey] = oldState;
          targetSummaries.push({
            source: "previous",
            rivetHome: path.dirname(oldState.configPath),
            configPath: oldState.configPath,
            status: "error",
            error: err?.message ?? String(err),
          });
        }
      }

      const nextStateObj =
        Object.keys(nextTargetsState).length > 0
          ? { version: STATE_VERSION, targets: nextTargetsState }
          : null;

      if (allChanges.length > 0 || canonicalJSON(state) !== canonicalJSON(nextStateObj ?? emptyState())) {
        commitChanges(p, allChanges, nextStateObj);
      }

      const hasError = targetSummaries.some((t) => t.status === "error");
      const statusObj = {
        version: STATE_VERSION,
        state: hasError ? "partial_error" : "connected",
        detected,
        channels: [...want.channelKeys],
        defaultProvider: want.defaultProvider,
        ...(want.defaultModel ? { defaultModel: want.defaultModel } : {}),
        targets: targetSummaries,
      };
      writeStatusIfChanged(p, statusObj);
      return statusObj;
    }

    // Disconnected: restore every target we previously touched.
    for (const [oldKey, oldState] of Object.entries(state.targets)) {
      try {
        const { changes } = applyDisconnectToTarget(oldState);
        allChanges.push(...changes);
        targetSummaries.push({
          source: "restored",
          rivetHome: path.dirname(oldState.configPath),
          configPath: oldState.configPath,
          status: "restored",
        });
      } catch (err) {
        nextTargetsState[oldKey] = oldState;
        targetSummaries.push({
          source: "restored",
          rivetHome: path.dirname(oldState.configPath),
          configPath: oldState.configPath,
          status: "error",
          error: err?.message ?? String(err),
        });
      }
    }

    const nextStateObj =
      Object.keys(nextTargetsState).length > 0
        ? { version: STATE_VERSION, targets: nextTargetsState }
        : null;

    if (allChanges.length > 0 || (stateExists && canonicalJSON(state) !== canonicalJSON(nextStateObj ?? emptyState())) || (stateExists && nextStateObj === null)) {
      commitChanges(p, allChanges, nextStateObj);
    }

    // Include discovered idle targets in status.json (also signals presence for Desktop-only installs).
    const listedKeys = new Set(targetSummaries.map((t) => canonicalTargetKey(t.configPath, discoverOpts.platform)));
    for (const target of targets) {
      if (listedKeys.has(target.key)) continue;
      targetSummaries.push({
        source: target.source,
        rivetHome: target.rivetHome,
        configPath: target.configPath,
        status: "idle",
      });
    }

    const hasError = targetSummaries.some((t) => t.status === "error");
    const statusObj = {
      version: STATE_VERSION,
      state: hasError ? "partial_error" : "disconnected",
      detected,
      targets: targetSummaries,
    };
    if (detected || stateExists || controlExists) {
      writeStatusIfChanged(p, statusObj);
    }
    return statusObj;
  } finally {
    release();
  }
}

/** Forces restoration of all tracked targets regardless of connection.json. */
export function restoreBridge(p = pathsFor(), discoverOpts = {}) {
  const stateExists = fs.existsSync(p.state);
  const pendingExists = fs.existsSync(p.pending);
  if (!stateExists && !pendingExists) {
    return { version: STATE_VERSION, state: "disconnected", restored: [] };
  }
  const release = acquireLock(p.lock);
  try {
    recoverPending(p);
    const state = readBridgeState(p);
    const allChanges = [];
    const restored = [];
    const remaining = {};
    for (const [key, oldState] of Object.entries(state.targets)) {
      try {
        const { changes } = applyDisconnectToTarget(oldState);
        allChanges.push(...changes);
        restored.push({ configPath: oldState.configPath, status: "restored" });
      } catch (err) {
        remaining[key] = oldState;
        restored.push({ configPath: oldState.configPath, status: "error", error: err?.message ?? String(err) });
      }
    }
    const nextState = Object.keys(remaining).length > 0 ? { version: STATE_VERSION, targets: remaining } : null;
    commitChanges(p, allChanges, nextState);
    const { targets, detected } = discoverTargets(discoverOpts);
    if (detected) {
      writeStatusIfChanged(p, {
        version: STATE_VERSION,
        state: Object.keys(remaining).length > 0 ? "partial_error" : "disconnected",
        detected,
        targets: targets.map((t) => ({
          source: t.source,
          rivetHome: t.rivetHome,
          configPath: t.configPath,
          status: "idle",
        })),
      });
    }
    return { version: STATE_VERSION, state: nextState ? "partial_error" : "disconnected", restored };
  } finally {
    release();
  }
}

/** Read-only status snapshot without mutating any Tianshu files. */
export function inspectBridge(p = pathsFor(), discoverOpts = {}) {
  const { targets, detected } = discoverTargets(discoverOpts);
  let controlConnected = false;
  let selectedModel = null;
  let modelCount = 0;
  let controlError = null;
  try {
    const raw = readJsonSafe(p.control)?.data ?? null;
    const want = buildTianshuDesired(raw);
    if (want) {
      controlConnected = true;
      selectedModel = want.defaultModel ?? null;
      modelCount = Object.values(want.providersByKey).reduce((sum, prov) => sum + (prov.models?.length ?? 0), 0);
    }
  } catch (err) {
    controlError = err?.message ?? String(err);
  }

  let tracked = {};
  try {
    tracked = readBridgeState(p).targets;
  } catch {
    tracked = {};
  }

  return {
    controlFile: p.control,
    detected,
    controlConnected,
    selectedModel,
    modelCount,
    ...(controlError ? { controlError } : {}),
    targets: targets.map((t) => ({
      source: t.source,
      rivetHome: t.rivetHome,
      configPath: t.configPath,
      configExists: fs.existsSync(t.configPath),
      providerKeysExists: fs.existsSync(t.providerKeysPath),
      managedProviders: tracked[t.key]?.managedProviders ?? [],
    })),
  };
}

function fileStamp(file) {
  const st = fs.lstatSync(file, { bigint: true, throwIfNoEntry: false });
  return st ? `${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}` : "-";
}

/**
 * Starts the background bridge loop (stat-guarded 750ms polling + fs.watch
 * fast-path on the control directory). Returns a `stop()` function.
 */
export function startBridge(
  p = pathsFor(),
  {
    interval = 750,
    discoverOpts = {},
    onError = () =>
      console.error("Tianshu bridge sync paused; run `magpie-tianshu status` for details (configuration retained)."),
  } = {},
) {
  const bridgeKey = canonicalTargetKey(p.state, discoverOpts.platform);
  if (activeBridges.has(bridgeKey)) return activeBridges.get(bridgeKey);

  let previousStamp = "";
  let previousError = "";
  let consecutiveLockErrors = 0;
  let watcher = null;
  let debounceTimer = null;

  const ensureWatcher = () => {
    if (watcher || !fs.existsSync(p.dir)) return;
    try {
      watcher = fs.watch(p.dir, { persistent: false }, (_event, filename) => {
        if (filename && filename !== path.basename(p.control)) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          tick();
        }, 80);
        debounceTimer.unref?.();
      });
      watcher.on("error", () => {
        try {
          watcher?.close();
        } catch {
          // ignore
        }
        watcher = null;
      });
    } catch {
      watcher = null;
    }
  };

  const computeStamp = () => {
    const { targets, detected } = discoverTargets(discoverOpts);
    const files = [p.control, p.state, p.pending];
    for (const t of targets) {
      files.push(t.configPath, t.providerKeysPath);
    }
    return `${detected ? "1" : "0"}|${targets.map((t) => t.key).join(",")}|${files.map(fileStamp).join("|")}`;
  };

  const tick = () => {
    try {
      const stamp = computeStamp();
      if (stamp === previousStamp) return;
      syncBridge(p, discoverOpts);
      previousStamp = computeStamp();
      previousError = "";
      consecutiveLockErrors = 0;
      ensureWatcher();
    } catch (err) {
      previousStamp = "";
      if (err?.code === "LOCKED") {
        consecutiveLockErrors += 1;
        if (consecutiveLockErrors < 3) return;
      } else {
        consecutiveLockErrors = 0;
      }
      const msg = err?.message ?? String(err);
      if (msg !== previousError) onError(err);
      previousError = msg;
    }
  };

  tick();
  const timer = setInterval(tick, interval);
  timer.unref?.();

  const stop = () => {
    clearInterval(timer);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (watcher) {
      try {
        watcher.close();
      } catch {
        // ignore
      }
      watcher = null;
    }
    activeBridges.delete(bridgeKey);
  };

  activeBridges.set(bridgeKey, stop);
  return stop;
}
