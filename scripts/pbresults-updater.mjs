// PBRESULTS_COORDINATOR_VERSION: 1
//
// Root update coordinator for the Windows portable package. It runs on the bundled node.exe from the portable root,
// outside any version folder, and imports only Node built-ins so it works with whichever version is installed.
//
// Modes: install, rollback, recover. Every durable step is recorded in the transaction journal so an interrupted
// update can be finished or rolled back by `recover` (which the root launcher runs at startup).

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const PROTOCOL_VERSION = 2;
export const TERMINAL_PHASES = new Set(["committed", "rollback-completed", "failed"]);
const RECOVERY_STARTS_APPLICATION = new Set(["pointer-activated", "new-process-started", "rollback-started"]);
const REQUIRED_APP_FILES = [
  ["node", "node.exe"],
  ["start-portable.mjs"],
  ["dist", "client", "index.html"],
  ["dist", "server", "server", "index.js"],
  ["package.json"],
  ["BUILD-INFO.json"]
];
const LAUNCHER_REQUIRED_FILES = REQUIRED_APP_FILES.filter((parts) => parts[0] !== "package.json");

export class CoordinatorError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

/** All paths and timings the coordinator uses; tests override timings and the launcher command. */
export function createContext(root, overrides = {}) {
  const resolvedRoot = path.resolve(root);
  const updates = path.join(resolvedRoot, "updates");
  return {
    root: resolvedRoot,
    updates,
    lockPath: path.join(updates, "update.lock"),
    pointerPath: path.join(resolvedRoot, "current-version.json"),
    logPath: path.join(resolvedRoot, "logs", "updater.log"),
    launcherPath: path.join(resolvedRoot, "pbresults-launcher.mjs"),
    nodePath: process.execPath,
    mode: "Coordinator",
    transactionPath: null,
    healthTimeoutMs: 60_000,
    healthIntervalMs: 750,
    shutdownTimeoutMs: 20_000,
    launcherPidTimeoutMs: 30_000,
    retainSnapshots: 3,
    retainQuarantine: 3,
    useWindowsConsole: process.platform === "win32",
    fault: null,
    ...overrides
  };
}

/**
 * Environment for child processes, without Node's IPC variables: a process that was itself forked with an IPC channel
 * must not hand that channel to the launcher or server it starts.
 */
export function childEnvironment(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.NODE_CHANNEL_FD;
  delete env.NODE_CHANNEL_SERIALIZATION_MODE;
  delete env.NODE_UNIQUE_ID;
  return env;
}

export function log(ctx, message) {
  try {
    fs.mkdirSync(path.dirname(ctx.logPath), { recursive: true });
    fs.appendFileSync(ctx.logPath, `${new Date().toISOString()} [${ctx.mode}] ${message}\n`);
  } catch {
    // Logging must never break an update.
  }
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFsError(error) {
  return ["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(error?.code);
}

/** Antivirus and indexers briefly hold files on Windows; retry the operation instead of failing the update. */
export function retryFs(operation, attempts = 10) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (attempt >= attempts || !isRetryableFsError(error)) throw error;
      const until = Date.now() + 100 * attempt;
      while (Date.now() < until) {
        // Synchronous back-off keeps callers simple; this only runs while a file is locked.
      }
    }
  }
}

export function resolveRootChild(ctx, candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error("Missing path in the update journal.");
  }
  const resolved = path.resolve(path.isAbsolute(candidate) ? candidate : path.join(ctx.root, candidate));
  const relative = path.relative(ctx.root, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the portable root: ${candidate}`);
  }
  return resolved;
}

export function rootRelative(ctx, fullPath) {
  return path.relative(ctx.root, resolveRootChild(ctx, fullPath));
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^﻿/, ""));
}

export function atomicWriteJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  try {
    const descriptor = fs.openSync(temporary, "wx");
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    JSON.parse(fs.readFileSync(temporary, "utf8"));
    retryFs(() => fs.renameSync(temporary, target));
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function saveTransaction(ctx, transaction, phase) {
  transaction.phase = phase;
  transaction.phaseTimestamps = { ...(transaction.phaseTimestamps ?? {}), [phase]: new Date().toISOString() };
  atomicWriteJson(ctx.transactionPath, transaction);
  log(ctx, `Transaction ${transaction.id} entered ${phase}.`);
}

function fileSha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function listFiles(root) {
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return files;
}

/** Structural check used by the launcher: enough to start the server. */
export function isStartableApp(appPath) {
  return LAUNCHER_REQUIRED_FILES.every((parts) => fs.existsSync(path.join(appPath, ...parts)));
}

/** Full check before activating a version: every required file and matching build metadata. */
export function testApp(appPath, version) {
  if (!REQUIRED_APP_FILES.every((parts) => fs.existsSync(path.join(appPath, ...parts)))) return false;
  try {
    const build = readJson(path.join(appPath, "BUILD-INFO.json"));
    return build.appVersion === version && build.releaseTag === `v${version}` && build.updaterProtocolVersion <= PROTOCOL_VERSION;
  } catch {
    return false;
  }
}

/** Sorted `relative|size` lines hashed together. src/server/updateStage.ts computes the same digest when staging. */
export function appInventory(appPath) {
  const lines = listFiles(appPath)
    .map((file) => `${path.relative(appPath, file).split(path.sep).join("/")}|${fs.statSync(file).size}`)
    .sort();
  return {
    fileCount: lines.length,
    digest: createHash("sha256").update(lines.join("\n"), "utf8").digest("hex")
  };
}

export function isProcessAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export function readPointer(ctx) {
  return readJson(ctx.pointerPath);
}

function writePointer(ctx, pointer) {
  atomicWriteJson(ctx.pointerPath, { ...pointer, updatedAt: new Date().toISOString() });
}

function swappedPointer(pointer) {
  return {
    schemaVersion: 1,
    generation: Number(pointer.generation ?? 0) + 1,
    active: pointer.previous,
    previous: pointer.active
  };
}

// ---------- Lock ----------

/** One coordinator at a time. A lock left by a process that no longer exists is stale and taken over. */
export function acquireLock(ctx) {
  fs.mkdirSync(ctx.updates, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(ctx.lockPath, "wx");
      try {
        fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      } finally {
        fs.closeSync(descriptor);
      }
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let holder = null;
      try {
        holder = readJson(ctx.lockPath);
      } catch {
        // An unreadable lock is treated as stale.
      }
      if (holder && holder.pid !== process.pid && isProcessAlive(holder.pid)) {
        throw new CoordinatorError("UPDATE_BUSY", `Another update coordinator (pid ${holder.pid}) is running.`);
      }
      fs.rmSync(ctx.lockPath, { force: true });
    }
  }
  throw new CoordinatorError("UPDATE_BUSY", "The update lock could not be acquired.");
}

export function releaseLock(ctx) {
  try {
    if (readJson(ctx.lockPath).pid === process.pid) fs.rmSync(ctx.lockPath, { force: true });
  } catch {
    // Already gone.
  }
}

// ---------- Processes ----------

async function waitForOldServer(ctx, transaction) {
  const deadline = Date.now() + ctx.shutdownTimeoutMs;
  while (transaction.serverPid && isProcessAlive(Number(transaction.serverPid))) {
    if (Date.now() >= deadline) throw new CoordinatorError("UPDATE_SHUTDOWN_TIMEOUT");
    await sleep(250);
  }
  saveTransaction(ctx, transaction, "old-process-stopped");
}

function quoteForCmd(value) {
  if (value.includes('"')) throw new Error(`Unsupported character in path: ${value}`);
  return `"${value}"`;
}

/**
 * Start the root launcher in its own console window and return its pid. On Windows this goes through `start` so the
 * new server gets a real, visible console like a normal double-click start; the launcher reports its pid through a file.
 */
async function startLauncher(ctx, port) {
  const env = childEnvironment({ APP_UPDATER_RECOVERY: "1" });
  const launcherArgs = [ctx.launcherPath, "--port", String(port), "--no-browser"];
  if (!ctx.useWindowsConsole) {
    const child = spawn(ctx.nodePath, launcherArgs, { cwd: ctx.root, env, detached: true, stdio: "ignore" });
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
    return child.pid;
  }

  const pidPath = path.join(ctx.updates, `launcher-${randomUUID()}.pid`);
  env.PB_LAUNCHER_PID_PATH = pidPath;
  const command = ["start", '"PBResults Scoreboard"', quoteForCmd(ctx.nodePath), ...launcherArgs.map(quoteForCmd)].join(" ");
  const result = spawnSync("cmd.exe", ["/d", "/s", "/c", `"${command}"`], {
    cwd: ctx.root,
    env,
    windowsHide: true,
    windowsVerbatimArguments: true,
    stdio: "ignore"
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to open the scoreboard window (${result.error?.message ?? `exit ${result.status}`}).`);
  }
  const deadline = Date.now() + ctx.launcherPidTimeoutMs;
  try {
    while (Date.now() < deadline) {
      try {
        const pid = Number(fs.readFileSync(pidPath, "utf8").trim());
        if (Number.isSafeInteger(pid) && pid > 0) return pid;
      } catch {
        // Not written yet.
      }
      await sleep(100);
    }
  } finally {
    fs.rmSync(pidPath, { force: true });
  }
  throw new Error("The scoreboard window did not start in time.");
}

export async function startAndWaitForHealth(ctx, transaction, version, releaseTag) {
  const pid = await startLauncher(ctx, transaction.port);
  transaction.newLauncherPid = pid;
  transaction.newLauncherExited = false;
  saveTransaction(ctx, transaction, "new-process-started");
  const deadline = Date.now() + ctx.healthTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(ctx.healthIntervalMs);
    try {
      const response = await fetch(`http://127.0.0.1:${transaction.port}/api/health`, { signal: AbortSignal.timeout(3000) });
      const health = await response.json();
      if (health.ready && health.appVersion === version && health.releaseTag === releaseTag) return true;
    } catch {
      // Not listening yet.
    }
    if (!isProcessAlive(pid)) {
      // Remember it: Windows reuses pids quickly, so this pid must never be killed later.
      transaction.newLauncherExited = true;
      return false;
    }
  }
  return false;
}

/** Windows reuses pids quickly; only ever terminate a pid that still belongs to a node.exe. */
function isNodeProcessOnWindows(pid) {
  const result = spawnSync("tasklist.exe", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    windowsHide: true,
    encoding: "utf8"
  });
  return typeof result.stdout === "string" && result.stdout.toLowerCase().includes('"node.exe"');
}

export async function stopProcessTree(pid) {
  if (!isProcessAlive(pid)) return;
  if (process.platform === "win32") {
    if (!isNodeProcessOnWindows(pid)) return;
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // Already exited.
      }
    }
  }
  const deadline = Date.now() + 10_000;
  while (isProcessAlive(pid) && Date.now() < deadline) await sleep(100);
}

async function stopNewProcess(ctx, transaction) {
  if (!transaction.newLauncherPid || transaction.newLauncherExited) return;
  await stopProcessTree(Number(transaction.newLauncherPid));
  log(ctx, `Stopped process tree ${transaction.newLauncherPid}.`);
}

// ---------- Data snapshot ----------

function removeStaleSnapshotPartial(ctx, partial) {
  if (!fs.existsSync(partial)) return;
  try {
    retryFs(() => fs.rmSync(partial, { recursive: true, force: true }));
  } catch (error) {
    log(ctx, `Unable to remove incomplete snapshot ${partial}: ${error.message}`);
    throw new CoordinatorError("UPDATE_SNAPSHOT_FAILED", error.message);
  }
}

function utcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function createDataSnapshot(ctx, transaction) {
  const data = path.join(ctx.root, "data");
  const safeId = String(transaction.id).replace(/[^A-Za-z0-9-]/g, "");
  const name = `${utcStamp()}-v${transaction.sourceVersion}-to-v${transaction.targetVersion}-${safeId}`;
  const snapshots = path.join(ctx.root, "backups", "pre-update");
  const partial = path.join(snapshots, `${name}.partial`);
  const final = path.join(snapshots, name);
  fs.mkdirSync(snapshots, { recursive: true });
  removeStaleSnapshotPartial(ctx, partial);

  try {
    ctx.fault?.("snapshot");
    fs.mkdirSync(path.join(partial, "data"), { recursive: true });
    const files = [];
    let totalBytes = 0;
    for (const file of listFiles(data)) {
      const relative = path.relative(data, file);
      const target = path.join(partial, "data", relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      retryFs(() => fs.copyFileSync(file, target));
      const size = fs.statSync(target).size;
      totalBytes += size;
      files.push({ path: relative.split(path.sep).join("/"), size, sha256: fileSha256(target) });
    }
    atomicWriteJson(path.join(partial, "snapshot.json"), {
      schemaVersion: 1,
      transactionId: transaction.id,
      sourceVersion: transaction.sourceVersion,
      targetVersion: transaction.targetVersion,
      createdAt: new Date().toISOString(),
      fileCount: files.length,
      totalBytes,
      files,
      complete: true
    });
    retryFs(() => fs.renameSync(partial, final));
    transaction.snapshotPath = rootRelative(ctx, final);
    saveTransaction(ctx, transaction, "snapshot-created");
  } catch (error) {
    if (error instanceof CoordinatorError) throw error;
    removeStaleSnapshotPartial(ctx, partial);
    log(ctx, `Snapshot creation failed for transaction ${transaction.id}: ${error.message}`);
    throw new CoordinatorError("UPDATE_SNAPSHOT_FAILED", error.message);
  }
}

/**
 * Recursive copy built from plain file operations. fs.cpSync is avoided on purpose: its native implementation in
 * Node 22 can abort the whole process on Windows for some paths, which would kill the coordinator mid-rollback.
 */
export function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else if (entry.isFile()) retryFs(() => fs.copyFileSync(from, to));
  }
}

export function restoreSnapshot(ctx, transaction) {
  const snapshotData = path.join(resolveRootChild(ctx, transaction.snapshotPath), "data");
  const data = path.join(ctx.root, "data");
  const quarantine = path.join(ctx.updates, "quarantine", `failed-data-${transaction.id}-${randomUUID().slice(0, 8)}`);
  fs.mkdirSync(path.dirname(quarantine), { recursive: true });
  if (fs.existsSync(data)) retryFs(() => fs.renameSync(data, quarantine));
  copyDirectory(snapshotData, data);
  log(ctx, `Restored data from ${transaction.snapshotPath}.`);
}

function removeCompletedArtifacts(ctx, transaction) {
  for (const candidate of [transaction.archivePath, transaction.stagingPath]) {
    if (!candidate) continue;
    try {
      const resolved = resolveRootChild(ctx, candidate);
      if (fs.existsSync(resolved)) {
        retryFs(() => fs.rmSync(resolved, { recursive: true, force: true }));
        log(ctx, `Removed completed update artifact ${resolved}.`);
      }
    } catch (error) {
      log(ctx, `Deferred cleanup for ${candidate}: ${error.message}`);
    }
  }
}

function commit(ctx, transaction) {
  saveTransaction(ctx, transaction, "health-confirmed");
  transaction.outcome = "succeeded";
  transaction.completedAt = new Date().toISOString();
  saveTransaction(ctx, transaction, "committed");
  removeCompletedArtifacts(ctx, transaction);
}

function finishRolledBack(ctx, transaction) {
  transaction.outcome = "rolled-back";
  transaction.completedAt = new Date().toISOString();
  saveTransaction(ctx, transaction, "rollback-completed");
}

// ---------- Modes ----------

export async function install(ctx, transaction) {
  await waitForOldServer(ctx, transaction);
  createDataSnapshot(ctx, transaction);

  const prepared = resolveRootChild(ctx, transaction.preparedAppPath);
  const markerPath = resolveRootChild(ctx, transaction.preparedMarkerPath);
  if (!fs.existsSync(markerPath)) throw new CoordinatorError("UPDATE_PAYLOAD_INVALID");
  const marker = readJson(markerPath);
  const version = transaction.targetVersion;
  const target = path.join(ctx.root, "versions", `v${version}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });

  if (fs.existsSync(target)) {
    if (!testApp(target, version) || appInventory(target).digest !== marker.inventorySha256) {
      const quarantine = path.join(ctx.updates, "quarantine", `invalid-v${version}-${transaction.id}`);
      fs.mkdirSync(path.dirname(quarantine), { recursive: true });
      retryFs(() => fs.renameSync(target, quarantine));
      throw new CoordinatorError("UPDATE_ACTIVATION_FAILED", "An existing copy of this version was damaged and has been set aside.");
    }
    if (fs.existsSync(prepared)) retryFs(() => fs.rmSync(prepared, { recursive: true, force: true }));
    log(ctx, `Reused identical application at ${target}.`);
  } else {
    if (!testApp(prepared, version) || appInventory(prepared).digest !== marker.inventorySha256) {
      throw new CoordinatorError("UPDATE_PAYLOAD_INVALID");
    }
    retryFs(() => fs.renameSync(prepared, target));
  }
  transaction.targetAppPath = rootRelative(ctx, target);
  saveTransaction(ctx, transaction, "payload-finalized");

  const oldPointer = readPointer(ctx);
  const newPointer = {
    schemaVersion: 1,
    generation: Number(oldPointer.generation ?? 0) + 1,
    active: { version, releaseTag: `v${version}`, relativePath: transaction.targetAppPath },
    previous: oldPointer.active
  };
  writePointer(ctx, newPointer);
  saveTransaction(ctx, transaction, "pointer-activated");
  if (await startAndWaitForHealth(ctx, transaction, version, `v${version}`)) {
    commit(ctx, transaction);
    return;
  }

  await stopNewProcess(ctx, transaction);
  saveTransaction(ctx, transaction, "rollback-started");
  writePointer(ctx, swappedPointer(newPointer));
  restoreSnapshot(ctx, transaction);
  if (await startAndWaitForHealth(ctx, transaction, transaction.sourceVersion, transaction.sourceReleaseTag)) {
    transaction.errorMessage ??= `Version ${version} did not pass its health check.`;
    finishRolledBack(ctx, transaction);
    return;
  }
  throw new CoordinatorError("UPDATE_ROLLBACK_FAILED");
}

export async function manualRollback(ctx, transaction) {
  await waitForOldServer(ctx, transaction);
  createDataSnapshot(ctx, transaction);
  const pointer = readPointer(ctx);
  if (!pointer.previous) throw new CoordinatorError("UPDATE_ROLLBACK_FAILED", "No previous version is available.");
  const previousPath = resolveRootChild(ctx, pointer.previous.relativePath);
  if (!testApp(previousPath, pointer.previous.version)) {
    throw new CoordinatorError("UPDATE_ROLLBACK_FAILED", "The previous version is incomplete.");
  }
  const swapped = swappedPointer(pointer);
  writePointer(ctx, swapped);
  saveTransaction(ctx, transaction, "pointer-activated");
  if (await startAndWaitForHealth(ctx, transaction, swapped.active.version, swapped.active.releaseTag)) {
    commit(ctx, transaction);
    return;
  }
  await stopNewProcess(ctx, transaction);
  saveTransaction(ctx, transaction, "rollback-started");
  writePointer(ctx, pointer);
  restoreSnapshot(ctx, transaction);
  if (await startAndWaitForHealth(ctx, transaction, pointer.active.version, pointer.active.releaseTag)) {
    finishRolledBack(ctx, transaction);
    return;
  }
  throw new CoordinatorError("UPDATE_ROLLBACK_FAILED");
}

/** Finish or undo a transaction that a crash or power loss interrupted. Runs at most once per transaction. */
export async function recover(ctx, transaction) {
  if (transaction.recoveryAttempted) throw new CoordinatorError("UPDATE_ROLLBACK_FAILED", "Recovery was already attempted.");
  transaction.recoveryAttempted = true;
  atomicWriteJson(ctx.transactionPath, transaction);

  const beforeActivation = [
    "prepared",
    "staging",
    "shutdown-requested",
    "install-coordinator-started",
    "rollback-coordinator-started",
    "old-process-stopped",
    "snapshot-created",
    "payload-finalized"
  ];
  if (beforeActivation.includes(transaction.phase)) {
    transaction.errorCode = "UPDATE_ACTIVATION_FAILED";
    transaction.errorMessage = `Update interrupted during ${transaction.phase}; the previous version remains active.`;
    transaction.outcome = "failed";
    transaction.completedAt = new Date().toISOString();
    saveTransaction(ctx, transaction, "failed");
    return;
  }
  if (transaction.phase === "health-confirmed") {
    transaction.outcome = "succeeded";
    transaction.completedAt = new Date().toISOString();
    saveTransaction(ctx, transaction, "committed");
    removeCompletedArtifacts(ctx, transaction);
    return;
  }

  if (transaction.phase === "rollback-started") {
    const pointer = readPointer(ctx);
    if (pointer.active?.version !== transaction.sourceVersion && pointer.previous?.version === transaction.sourceVersion) {
      writePointer(ctx, swappedPointer(pointer));
    }
    if (transaction.snapshotPath) restoreSnapshot(ctx, transaction);
    if (await startAndWaitForHealth(ctx, transaction, transaction.sourceVersion, transaction.sourceReleaseTag)) {
      finishRolledBack(ctx, transaction);
      return;
    }
    throw new CoordinatorError("UPDATE_ROLLBACK_FAILED");
  }

  if (transaction.phase === "pointer-activated" || transaction.phase === "new-process-started") {
    if (await startAndWaitForHealth(ctx, transaction, transaction.targetVersion, `v${transaction.targetVersion}`)) {
      commit(ctx, transaction);
      return;
    }
    await stopNewProcess(ctx, transaction);
    saveTransaction(ctx, transaction, "rollback-started");
    const pointer = readPointer(ctx);
    if (pointer.previous?.version !== transaction.sourceVersion) throw new CoordinatorError("UPDATE_ROLLBACK_FAILED");
    writePointer(ctx, swappedPointer(pointer));
    restoreSnapshot(ctx, transaction);
    if (await startAndWaitForHealth(ctx, transaction, transaction.sourceVersion, transaction.sourceReleaseTag)) {
      finishRolledBack(ctx, transaction);
      return;
    }
    throw new CoordinatorError("UPDATE_ROLLBACK_FAILED");
  }
  throw new CoordinatorError("UPDATE_ACTIVATION_FAILED");
}

// ---------- Disk cleanup ----------

function entriesByNewest(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, full: path.join(directory, entry.name), mtime: fs.statSync(path.join(directory, entry.name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime);
}

function activeTransactionPaths(ctx) {
  const referenced = new Set();
  const directory = path.join(ctx.updates, "transactions");
  if (!fs.existsSync(directory)) return referenced;
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith(".json")) continue;
    try {
      const transaction = readJson(path.join(directory, name));
      if (TERMINAL_PHASES.has(transaction.phase)) continue;
      for (const key of ["targetAppPath", "preparedAppPath", "snapshotPath", "stagingPath", "archivePath"]) {
        if (typeof transaction[key] === "string") referenced.add(path.resolve(ctx.root, transaction[key]));
      }
    } catch {
      // Ignore unreadable journals.
    }
  }
  return referenced;
}

/** Move a folder out of the way first, so a half-deleted folder never sits where the launcher could pick it. */
function discard(ctx, folder) {
  const trash = path.join(ctx.updates, "trash");
  fs.mkdirSync(trash, { recursive: true });
  const parked = path.join(trash, `${path.basename(folder)}-${randomUUID().slice(0, 8)}`);
  try {
    retryFs(() => fs.renameSync(folder, parked), 3);
  } catch (error) {
    log(ctx, `Cleanup skipped ${folder}: ${error.message}`);
    return false;
  }
  try {
    fs.rmSync(parked, { recursive: true, force: true });
  } catch (error) {
    log(ctx, `Cleanup deferred ${parked}: ${error.message}`);
  }
  log(ctx, `Removed ${path.relative(ctx.root, folder)}.`);
  return true;
}

/**
 * Keep only the active and previous versions (the rollback target), the newest data snapshots and quarantine
 * entries, and anything an unfinished transaction references. Never throws: locked folders are retried next time.
 */
export function pruneUpdateArtifacts(ctx) {
  const removed = [];
  try {
    const keep = activeTransactionPaths(ctx);
    let pointer = null;
    try {
      pointer = readPointer(ctx);
    } catch {
      log(ctx, "Cleanup skipped: the version pointer is unreadable.");
      return removed;
    }
    for (const slot of [pointer.active, pointer.previous]) {
      if (slot?.relativePath) keep.add(path.resolve(ctx.root, slot.relativePath));
    }
    if (!pointer.active?.relativePath) return removed;

    const candidates = entriesByNewest(path.join(ctx.root, "versions")).map((entry) => entry.full);
    const legacyApp = path.join(ctx.root, "app");
    if (fs.existsSync(legacyApp)) candidates.push(legacyApp);
    for (const folder of candidates) {
      if (!keep.has(path.resolve(folder)) && discard(ctx, folder)) removed.push(folder);
    }

    for (const [directory, retain] of [
      [path.join(ctx.root, "backups", "pre-update"), ctx.retainSnapshots],
      [path.join(ctx.updates, "quarantine"), ctx.retainQuarantine]
    ]) {
      const entries = entriesByNewest(directory).filter((entry) => !entry.name.endsWith(".partial") && !keep.has(path.resolve(entry.full)));
      for (const entry of entries.slice(retain)) {
        if (discard(ctx, entry.full)) removed.push(entry.full);
      }
    }

    for (const directory of [path.join(ctx.updates, "staging"), path.join(ctx.updates, "downloads")]) {
      if (!fs.existsSync(directory)) continue;
      for (const name of fs.readdirSync(directory)) {
        const full = path.join(directory, name);
        if (keep.has(path.resolve(full))) continue;
        try {
          fs.rmSync(full, { recursive: true, force: true });
          removed.push(full);
        } catch (error) {
          log(ctx, `Cleanup deferred ${full}: ${error.message}`);
        }
      }
    }

    const trash = path.join(ctx.updates, "trash");
    if (fs.existsSync(trash)) {
      for (const name of fs.readdirSync(trash)) {
        try {
          fs.rmSync(path.join(trash, name), { recursive: true, force: true });
        } catch {
          // Still locked; next run.
        }
      }
    }
  } catch (error) {
    log(ctx, `Cleanup failed: ${error.message}`);
  }
  return removed;
}

// ---------- Entry point ----------

/** Run one coordinator transaction. Returns the process exit code. */
export async function runTransaction(ctx, mode, transactionPath) {
  ctx.mode = mode[0].toUpperCase() + mode.slice(1);
  let transaction = null;
  let locked = false;
  try {
    ctx.transactionPath = resolveRootChild(ctx, transactionPath);
    acquireLock(ctx);
    locked = true;
    transaction = readJson(ctx.transactionPath);
    log(ctx, `Starting transaction ${transaction.id}, protocol ${PROTOCOL_VERSION}.`);
    if (mode === "install") {
      saveTransaction(ctx, transaction, "install-coordinator-started");
      await install(ctx, transaction);
    } else if (mode === "rollback") {
      saveTransaction(ctx, transaction, "rollback-coordinator-started");
      await manualRollback(ctx, transaction);
    } else if (mode === "recover") {
      await recover(ctx, transaction);
    } else {
      throw new Error(`Unknown mode ${mode}`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = /^(UPDATE_[A-Z_]+)/.exec(message)?.[1] ?? "UPDATE_ACTIVATION_FAILED";
    log(ctx, `Transaction failed: ${message}`);
    if (transaction) {
      transaction.errorCode = code;
      transaction.errorMessage = message;
      let retryPrepared = mode === "install" && (code === "UPDATE_SHUTDOWN_TIMEOUT" || code === "UPDATE_SNAPSHOT_FAILED");
      if (code === "UPDATE_SNAPSHOT_FAILED") {
        try {
          const pointer = readPointer(ctx);
          if (await startAndWaitForHealth(ctx, transaction, pointer.active.version, pointer.active.releaseTag)) {
            log(ctx, `Restarted ${pointer.active.releaseTag} after the snapshot failure.`);
          } else {
            log(ctx, `Unable to restart ${pointer.active.releaseTag} after the snapshot failure.`);
            retryPrepared = false;
          }
        } catch (restartError) {
          log(ctx, `Unable to restart the current version after the snapshot failure: ${restartError.message}`);
          retryPrepared = false;
        }
        transaction.errorCode = code;
        transaction.errorMessage = message;
      }
      try {
        if (retryPrepared) {
          transaction.outcome = null;
          transaction.completedAt = null;
          saveTransaction(ctx, transaction, "prepared");
        } else {
          transaction.outcome = "failed";
          transaction.completedAt = new Date().toISOString();
          saveTransaction(ctx, transaction, "failed");
        }
      } catch {
        // The journal is best effort once the transaction has failed.
      }
    }
    return 1;
  } finally {
    if (locked) {
      if (transaction && TERMINAL_PHASES.has(transaction.phase)) pruneUpdateArtifacts(ctx);
      releaseLock(ctx);
    }
  }
}

/** Find the newest journal that has not reached a terminal phase. */
export function findInterruptedTransaction(ctx) {
  const directory = path.join(ctx.updates, "transactions");
  if (!fs.existsSync(directory)) return null;
  const newest = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => path.join(directory, name))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
  if (!newest) return null;
  const transaction = readJson(newest);
  return TERMINAL_PHASES.has(transaction.phase) ? null : { path: newest, transaction };
}

export { RECOVERY_STARTS_APPLICATION };

async function main() {
  const { values } = parseArgs({
    options: {
      mode: { type: "string" },
      transaction: { type: "string" },
      prune: { type: "boolean" }
    }
  });
  const ctx = createContext(path.dirname(fileURLToPath(import.meta.url)));
  if (values.prune) {
    ctx.mode = "Cleanup";
    try {
      acquireLock(ctx);
    } catch {
      // A running coordinator prunes when it finishes.
      return 0;
    }
    try {
      pruneUpdateArtifacts(ctx);
    } finally {
      releaseLock(ctx);
    }
    return 0;
  }
  if (!values.mode || !values.transaction) {
    process.stderr.write("Usage: pbresults-updater.mjs --mode install|rollback|recover --transaction <journal>\n");
    return 2;
  }
  return runTransaction(ctx, values.mode, values.transaction);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
      process.exit(1);
    }
  );
}
