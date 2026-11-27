// Magpie Bun companion plugin entry for Tianshu (rivet harness) 4.1.54+.
//
// `tianshu.agent.js` runs inside Magpie's moejs sandbox and writes intent to
// `~/.config/magpie-tianshu/connection.json`. This companion runs inside
// Magpie's shared Bun plugin host, syncing every discovered Tianshu 4.1.54+
// root (Desktop portable TianshuData, launcher.json, %LOCALAPPDATA%\.rivet,
// ~/.rivet) and sibling `provider-keys.json` atomically and reversibly.
//
// Returning `{}` keeps this package purely an Agent plugin (no fake provider).

import { pathsFor, startBridge, syncBridge } from "./bridge.mjs";

const INSTANCE = Symbol.for("magpie.tianshu.bridge.v1");

export default async function TianshuBridgePlugin(input) {
  if (!globalThis[INSTANCE]) {
    const paths = pathsFor();
    const stop = startBridge(paths, {
      onError(err) {
        const message = `tianshu bridge paused (${err?.code || "sync_error"}); run magpie-tianshu status for details.`;
        try {
          void input?.client?.app
            ?.log?.({ body: { service: "tianshu-agent", level: "warn", message } })
            ?.catch?.(() => {});
        } catch {
          // ignore logging failure
        }
      },
    });
    globalThis[INSTANCE] = { stop, paths };

    // Magpie restores the control JSON before closing the shared host on
    // disable or removal. Flush synchronously on normal exit without taking
    // over process signals or affecting sibling plugins.
    process.once("exit", () => {
      try {
        syncBridge(paths);
      } catch (err) {
        if (err?.code !== "LOCKED") {
          console.error("Tianshu bridge final sync paused; configuration and recovery files retained.");
        }
      }
    });
  }
  return {};
}
