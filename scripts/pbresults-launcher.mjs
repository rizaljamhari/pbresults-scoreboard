#!/usr/bin/env node
// PBRESULTS_COORDINATOR_VERSION: 1
//
// Root launcher for the Windows portable package, started by "Run Scoreboard.cmd" or by the update coordinator.
// It finishes any interrupted update, picks the active version from current-version.json (falling back to the
// previous one), and runs that version's start-portable.mjs on its own bundled node.exe.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  PROTOCOL_VERSION,
  RECOVERY_STARTS_APPLICATION,
  createContext,
  findInterruptedTransaction,
  isStartableApp,
  log,
  readPointer,
  resolveRootChild,
  runTransaction
} from "./pbresults-updater.mjs";

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: "string" },
      "no-browser": { type: "boolean" }
    }
  });
  const ctx = createContext(path.dirname(fileURLToPath(import.meta.url)), { mode: "Launcher" });

  if (process.env.PB_LAUNCHER_PID_PATH) {
    try {
      fs.writeFileSync(process.env.PB_LAUNCHER_PID_PATH, String(process.pid));
    } catch {
      // The coordinator falls back to its timeout.
    }
  }

  if (process.env.APP_UPDATER_RECOVERY !== "1") {
    try {
      const interrupted = findInterruptedTransaction(ctx);
      if (interrupted) {
        const startsApplication = RECOVERY_STARTS_APPLICATION.has(interrupted.transaction.phase);
        log(ctx, `Recovering interrupted transaction ${interrupted.transaction.id} from phase ${interrupted.transaction.phase}.`);
        const code = await runTransaction(createContext(ctx.root), "recover", interrupted.path);
        // Recovery from these phases starts the application in its own window.
        if (startsApplication) return code;
      }
    } catch (error) {
      log(ctx, `Unable to inspect interrupted transaction: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const pointer = readPointer(ctx);
  let selected = pointer.active;
  let appPath = resolveRootChild(ctx, selected.relativePath);
  if (!isStartableApp(appPath)) {
    if (!pointer.previous) throw new Error(`Active application is invalid and no previous version is available: ${appPath}`);
    selected = pointer.previous;
    appPath = resolveRootChild(ctx, selected.relativePath);
    if (!isStartableApp(appPath)) throw new Error("Neither the active nor the previous application is complete.");
    log(ctx, `Falling back to previous application ${selected.releaseTag}.`);
  }

  const port = values.port ?? "3000";
  log(ctx, `Starting ${selected.releaseTag} from ${appPath} on port ${port}.`);
  const child = spawn(path.join(appPath, "node", "node.exe"), [path.join(appPath, "start-portable.mjs")], {
    cwd: ctx.root,
    stdio: "inherit",
    env: {
      ...process.env,
      APP_ROOT_DIR: ctx.root,
      APP_SERVER_PORT: port,
      APP_REQUIRE_PORT: values.port ? "1" : "0",
      APP_OPEN_BROWSER: values["no-browser"] ? "0" : "1",
      APP_ACTIVE_DIR: appPath,
      APP_BUILD_INFO_PATH: path.join(appPath, "BUILD-INFO.json"),
      APP_UPDATER_PROTOCOL_VERSION: String(PROTOCOL_VERSION),
      APP_UPDATER_RECOVERY: ""
    }
  });
  const forward = (signal) => {
    if (child.exitCode === null) child.kill(signal);
  };
  process.on("SIGINT", () => forward("SIGINT"));
  process.on("SIGTERM", () => forward("SIGTERM"));
  process.on("SIGHUP", () => forward("SIGHUP"));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

main().then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`[launcher] ${error instanceof Error ? error.message : String(error)}\n`);
    try {
      log(createContext(path.dirname(fileURLToPath(import.meta.url)), { mode: "Launcher" }), `Launch failed: ${error instanceof Error ? error.message : String(error)}`);
    } catch {
      // Nothing more to do.
    }
    process.exit(1);
  }
);
