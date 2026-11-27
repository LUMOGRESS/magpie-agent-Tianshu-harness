#!/usr/bin/env node
// Diagnostic and manual reconciliation CLI for magpie-agent-tianshu-harness.
// Usage: magpie-tianshu [status | sync | restore]

import { inspectBridge, pathsFor, restoreBridge, syncBridge } from "./bridge.mjs";

const command = process.argv[2] || "status";
const paths = pathsFor();

try {
  if (command === "status") {
    const info = inspectBridge(paths);
    console.log(JSON.stringify(info, null, 2));
    if (info.controlError) process.exitCode = 1;
  } else if (command === "sync") {
    const result = syncBridge(paths);
    console.log(JSON.stringify(result, null, 2));
    if (result.state === "partial_error") process.exitCode = 1;
  } else if (command === "restore") {
    const result = restoreBridge(paths);
    console.log(JSON.stringify(result, null, 2));
    if (result.state === "partial_error") process.exitCode = 1;
  } else if (command === "-h" || command === "--help" || command === "help") {
    console.log("Usage: magpie-tianshu [status | sync | restore]");
  } else {
    console.error(`Unknown command: ${command}\nUsage: magpie-tianshu [status | sync | restore]`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err?.message ?? String(err));
  process.exitCode = 1;
}
