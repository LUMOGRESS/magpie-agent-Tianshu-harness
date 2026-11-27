// Target data-root discovery for Tianshu (rivet harness) 4.1.54+ across
// Windows, macOS, and Linux.
//
// Exact priority mirrored from Tianshu-harness v4.1.54
// (src/config/paths.ts & docs/desktop-guide.md):
//   1. Explicit plugin overrides: MAGPIE_TIANSHU_CONFIG / MAGPIE_TIANSHU_HOMES
//   2. Tianshu env overrides:     RIVET_CONFIG_PATH / RIVET_HOME
//   3. Desktop portable mode:     <installDir>/TianshuData/.rivet (Windows non-Program-Files)
//   4. Desktop launcher.json:     rivetHome in app.tianshu.desktop/launcher.json
//   5. Platform default:          %LOCALAPPDATA%\.rivet (Windows) / ~/.rivet (macOS & Linux)

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DESKTOP_IDENTIFIER = "app.tianshu.desktop";
const REGISTRY_CACHE_TTL_MS = 300_000;
const BIN_CACHE_TTL_MS = 30_000;

let registryCache = { at: 0, dirs: [] };
let binCache = { at: 0, found: false };

function pathModFor(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

/** Platform default `.rivet` home for Tianshu 4.1.54+. */
export function defaultRivetHome({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const p = pathModFor(platform);
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
    return p.join(localAppData, ".rivet");
  }
  return p.join(home, ".rivet");
}

/** Cross-platform path of Tianshu Desktop's `launcher.json`. */
export function launcherConfigPath({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const p = pathModFor(platform);
  if (platform === "win32") {
    const appData = env.APPDATA || p.join(home, "AppData", "Roaming");
    return p.join(appData, DESKTOP_IDENTIFIER, "launcher.json");
  }
  if (platform === "darwin") {
    return p.join(home, "Library", "Application Support", DESKTOP_IDENTIFIER, "launcher.json");
  }
  const xdg = env.XDG_CONFIG_HOME || p.join(home, ".config");
  return p.join(xdg, DESKTOP_IDENTIFIER, "launcher.json");
}

/** Reads `rivetHome` from Tianshu Desktop's `launcher.json`, returning undefined if absent/corrupt. */
export function readLauncherRivetHome(opts = {}) {
  const readText = opts.readText ?? ((file) => fs.readFileSync(file, "utf8"));
  const file = opts.launcherPath ?? launcherConfigPath(opts);
  try {
    const parsed = JSON.parse(readText(file));
    if (parsed && typeof parsed.rivetHome === "string" && parsed.rivetHome.trim()) {
      return parsed.rivetHome.trim();
    }
  } catch {
    // Absent or unreadable launcher.json falls back silently.
  }
  return undefined;
}

/** True when a Windows path is inside Program Files / Program Files (x86). */
export function isProgramFilesPath(dir, env = process.env) {
  if (typeof dir !== "string" || !dir.trim()) return false;
  const norm = path.win32.resolve(dir).toLowerCase().replace(/\\+$/, "");
  const roots = [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.ProgramW6432,
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ]
    .filter((v) => typeof v === "string" && v.trim())
    .map((v) => path.win32.resolve(v).toLowerCase().replace(/\\+$/, ""));
  return roots.some((root) => norm === root || norm.startsWith(root + "\\"));
}

/** Parses `InstallLocation` entries for Tianshu from `reg.exe query` output. */
export function parseWindowsUninstallOutput(stdout) {
  if (typeof stdout !== "string" || !stdout) return [];
  const blocks = stdout.split(/\r?\n\r?\n+/);
  const dirs = [];
  for (const block of blocks) {
    if (!/DisplayName\s+REG_\w+\s+.*(?:Tianshu|天枢)/i.test(block)) continue;
    const match = block.match(/InstallLocation\s+REG_\w+\s+(.+)/i);
    if (!match) continue;
    const raw = match[1].trim().replace(/^"+|"+$/g, "").trim();
    if (raw) dirs.push(raw);
  }
  return [...new Set(dirs)];
}

function queryWindowsInstallDirsCached(now = Date.now()) {
  if (process.platform !== "win32") return [];
  if (now - registryCache.at < REGISTRY_CACHE_TTL_MS) return registryCache.dirs;

  const found = [];
  for (const hive of [
    "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
  ]) {
    try {
      const stdout = execFileSync("reg.exe", ["query", hive, "/s", "/f", "Tianshu", "/d"], {
        encoding: "utf8",
        timeout: 1500,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
      const keys = [...new Set(stdout.split(/\r?\n/).filter((line) => /^HK(?:CU|LM|EY_)/i.test(line.trim())).map((l) => l.trim()))];
      for (const key of keys) {
        try {
          const detail = execFileSync("reg.exe", ["query", key], {
            encoding: "utf8",
            timeout: 1000,
            windowsHide: true,
            stdio: ["ignore", "pipe", "ignore"],
          });
          found.push(...parseWindowsUninstallOutput(detail));
        } catch {
          // Ignore individual unreadable subkeys.
        }
      }
    } catch {
      // reg.exe returns exit 1 when no match exists; safe to ignore.
    }
  }
  registryCache = { at: now, dirs: [...new Set(found)] };
  return registryCache.dirs;
}

function hasTianshuCliOnPath({ platform = process.platform, env = process.env, exists = fs.existsSync, now = Date.now() } = {}) {
  const canUseCache = platform === process.platform && env === process.env && exists === fs.existsSync;
  if (canUseCache && now - binCache.at < BIN_CACHE_TTL_MS) {
    return binCache.found;
  }
  const p = pathModFor(platform);
  const pathVar = env.PATH || env.Path || "";
  const sep = platform === "win32" ? ";" : ":";
  const exts = platform === "win32" ? [".cmd", ".ps1", ".exe", ".bat", ""] : [""];
  let found = false;
  for (const rawDir of pathVar.split(sep)) {
    const dir = rawDir.trim().replace(/^"+|"+$/g, "");
    if (!dir) continue;
    for (const cmd of ["tianshu", "rivet"]) {
      for (const ext of exts) {
        try {
          if (exists(p.join(dir, cmd + ext))) {
            found = true;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (found) break;
    }
    if (found) break;
  }
  if (canUseCache) {
    binCache = { at: now, found };
  }
  return found;
}

/** Canonical comparison key for deduplicating config paths across platforms. */
export function canonicalTargetKey(filePath, platform = process.platform) {
  const p = pathModFor(platform);
  const resolved = p.resolve(filePath);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Discovers all active Tianshu 4.1.54+ targets (`config.json` + sibling
 * `provider-keys.json`) and reports whether a real Tianshu installation was
 * detected on this machine.
 */
export function discoverTargets(opts = {}) {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const home = opts.home ?? os.homedir();
  const exists = opts.exists ?? fs.existsSync;
  const readText = opts.readText ?? ((file) => fs.readFileSync(file, "utf8"));
  const queryWindowsInstallDirs = opts.queryWindowsInstallDirs ?? (() => (platform === "win32" ? queryWindowsInstallDirsCached() : []));
  const hasCliBin = opts.hasCliBin ?? (() => hasTianshuCliOnPath({ platform, env, exists }));
  const p = pathModFor(platform);

  const targets = [];
  const seen = new Set();
  let detected = false;

  const addConfig = (configPath, source, { markDetected = true } = {}) => {
    if (typeof configPath !== "string" || !configPath.trim()) return;
    const resolvedConfig = p.resolve(configPath.trim());
    const key = canonicalTargetKey(resolvedConfig, platform);
    if (seen.has(key)) {
      if (markDetected) detected = true;
      return;
    }
    seen.add(key);
    const rivetHome = p.dirname(resolvedConfig);
    targets.push({
      key,
      source,
      rivetHome,
      configPath: resolvedConfig,
      providerKeysPath: p.join(rivetHome, "provider-keys.json"),
    });
    if (markDetected) detected = true;
  };

  const addHome = (rivetHome, source, options) => {
    if (typeof rivetHome !== "string" || !rivetHome.trim()) return;
    const resolvedHome = p.resolve(rivetHome.trim());
    addConfig(p.join(resolvedHome, "config.json"), source, options);
  };

  // 1. Explicit plugin overrides (highest priority, exclusive when provided).
  const overrideConfig = env.MAGPIE_TIANSHU_CONFIG?.trim();
  const overrideHomes = env.MAGPIE_TIANSHU_HOMES?.trim();
  if (overrideConfig || overrideHomes) {
    if (overrideConfig) addConfig(overrideConfig, "MAGPIE_TIANSHU_CONFIG");
    if (overrideHomes) {
      const sep = platform === "win32" ? ";" : ":";
      for (const dir of overrideHomes.split(sep).map((s) => s.trim()).filter(Boolean)) {
        addHome(dir, "MAGPIE_TIANSHU_HOMES");
      }
    }
    return { targets, detected: true };
  }

  // 2. Explicit Tianshu env overrides.
  if (env.RIVET_CONFIG_PATH?.trim()) {
    addConfig(env.RIVET_CONFIG_PATH.trim(), "RIVET_CONFIG_PATH");
  } else if (env.RIVET_HOME?.trim()) {
    addHome(env.RIVET_HOME.trim(), "RIVET_HOME");
  }

  // 3. Windows Desktop portable mode: <installDir>\TianshuData\.rivet
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
    const candidateInstallDirs = [p.join(localAppData, "Tianshu")];
    for (const regDir of queryWindowsInstallDirs() ?? []) {
      if (typeof regDir === "string" && regDir.trim()) candidateInstallDirs.push(regDir.trim());
    }

    const seenInstallDirs = new Set();
    for (const installDir of candidateInstallDirs) {
      const normInstall = p.resolve(installDir).toLowerCase();
      if (seenInstallDirs.has(normInstall)) continue;
      seenInstallDirs.add(normInstall);

      const portableHome = p.join(installDir, "TianshuData", ".rivet");
      const exePath = p.join(installDir, "tianshu-desktop.exe");
      const hasPortableDir = exists(portableHome);
      const hasExe = exists(exePath);

      if (hasExe) detected = true;
      if (hasPortableDir || (hasExe && !isProgramFilesPath(installDir, env))) {
        addHome(portableHome, "desktop-portable");
      }
    }
  } else if (platform === "darwin") {
    if (exists("/Applications/Tianshu.app") || exists(p.join(home, "Applications", "Tianshu.app"))) {
      detected = true;
    }
  }

  // 4. Desktop launcher.json (Settings -> System -> Storage).
  const fromLauncher = readLauncherRivetHome({ platform, env, home, readText });
  if (fromLauncher) {
    addHome(fromLauncher, "launcher.json");
  }

  // 5. Platform default (%LOCALAPPDATA%\.rivet on Windows, ~/.rivet on Unix).
  const fallbackHome = defaultRivetHome({ platform, env, home });
  const fallbackExists = exists(fallbackHome) || exists(p.join(fallbackHome, "config.json"));
  if (fallbackExists) {
    addHome(fallbackHome, "platform-default");
  }

  // CLI binary presence on PATH also marks Tianshu as installed.
  if (!detected && hasCliBin()) {
    detected = true;
  }

  // If Tianshu is installed (e.g. fresh CLI or Program Files Desktop before first run)
  // and no existing data dir was found yet, target the platform default root.
  if (targets.length === 0 && detected) {
    addHome(fallbackHome, "platform-default", { markDetected: true });
  }

  return { targets, detected };
}

export function _resetCaches() {
  registryCache = { at: 0, dirs: [] };
  binCache = { at: 0, found: false };
}
