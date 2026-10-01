import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appInventory,
  childEnvironment,
  createContext,
  isProcessAlive,
  pruneUpdateArtifacts,
  readJson,
  runTransaction
} from "./pbresults-updater.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const roots = [];

const fakeServer = `
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
const appDir = path.dirname(fileURLToPath(import.meta.url));
const mode = JSON.parse(fs.readFileSync(path.join(appDir, "behavior.json"), "utf8")).mode;
const build = JSON.parse(fs.readFileSync(path.join(appDir, "BUILD-INFO.json"), "utf8"));
// Tests never kill pids (Windows reuses them); fake servers exit by themselves when the test writes this file.
setInterval(() => {
  const root = process.env.APP_ROOT_DIR;
  if (fs.existsSync(path.join(root, "stop-fake-servers")) || fs.existsSync(path.join(root, "stop-v" + build.appVersion))) process.exit(0);
}, 100);
if (mode === "exit") process.exit(3);

if (mode === "corrupt-data-then-exit") {
  fs.writeFileSync(path.join(process.env.APP_ROOT_DIR, "data", "settings.json"), "CORRUPTED");
  process.exit(4);
}
http
  .createServer((request, response) => {
    if (request.url !== "/api/health") {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      ready: mode !== "never-ready",
      appVersion: mode === "wrong-version" ? "0.0.1" : build.appVersion,
      releaseTag: mode === "wrong-version" ? "v0.0.1" : build.releaseTag
    }));
  })
  .listen(Number(process.env.APP_SERVER_PORT), "127.0.0.1");
`;

async function freePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}

/** A portable root with a space and non-ASCII characters in its path, the real coordinators, and some data. */
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pb updater ü-"));
  roots.push(root);
  for (const name of ["pbresults-launcher.mjs", "pbresults-updater.mjs"]) {
    fs.copyFileSync(path.join(scriptsDir, name), path.join(root, name));
  }
  fs.mkdirSync(path.join(root, "data", "uploads"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "settings.json"), JSON.stringify({ name: "original" }));
  fs.writeFileSync(path.join(root, "data", "uploads", "logo.png"), Buffer.from([1, 2, 3, 4]));
  return root;
}

function makeApp(appDir, version, mode = "healthy") {
  fs.mkdirSync(path.join(appDir, "node"), { recursive: true });
  const nodeTarget = path.join(appDir, "node", "node.exe");
  if (process.platform !== "win32") {
    fs.symlinkSync(process.execPath, nodeTarget);
  } else {
    // A hard link avoids copying the ~80 MB runtime for every fake version; fall back across volumes.
    try {
      fs.linkSync(process.execPath, nodeTarget);
    } catch {
      fs.copyFileSync(process.execPath, nodeTarget);
    }
  }
  fs.mkdirSync(path.join(appDir, "dist", "client"), { recursive: true });
  fs.mkdirSync(path.join(appDir, "dist", "server", "server"), { recursive: true });
  fs.writeFileSync(path.join(appDir, "dist", "client", "index.html"), "<!doctype html>");
  fs.writeFileSync(path.join(appDir, "dist", "server", "server", "index.js"), "");
  fs.writeFileSync(path.join(appDir, "package.json"), "{}");
  fs.writeFileSync(path.join(appDir, "start-portable.mjs"), fakeServer);
  fs.writeFileSync(path.join(appDir, "behavior.json"), JSON.stringify({ mode }));
  fs.writeFileSync(
    path.join(appDir, "BUILD-INFO.json"),
    JSON.stringify({ appVersion: version, releaseTag: `v${version}`, updaterProtocolVersion: 2 })
  );
}

function setBehavior(appDir, mode) {
  fs.writeFileSync(path.join(appDir, "behavior.json"), JSON.stringify({ mode }));
}

function writePointer(root, active, previous = null) {
  fs.writeFileSync(
    path.join(root, "current-version.json"),
    JSON.stringify({ schemaVersion: 1, generation: 1, active, previous, updatedAt: new Date().toISOString() })
  );
}

const slot = (version, relativePath) => ({ version, releaseTag: `v${version}`, relativePath });

/** Stage version `version` the way src/server/updateStage.ts leaves it, and write an install journal. */
function stageInstall(root, { id, sourceVersion, version, port, mode = "healthy", serverPid = null }) {
  const staging = path.join(root, "updates", "staging", id);
  const prepared = path.join(staging, "prepared-app");
  makeApp(prepared, version, mode);
  const marker = path.join(staging, "prepared-marker.json");
  fs.writeFileSync(marker, JSON.stringify({ transactionId: id, version, inventorySha256: appInventory(prepared).digest }));
  const archive = path.join(root, "updates", "downloads", `v${version}-${id}.zip`);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  fs.writeFileSync(archive, "zip");
  return writeJournal(root, {
    id,
    phase: "shutdown-requested",
    sourceVersion,
    sourceReleaseTag: `v${sourceVersion}`,
    targetVersion: version,
    serverPid,
    port,
    archivePath: path.relative(root, archive),
    stagingPath: path.relative(root, staging),
    preparedAppPath: path.relative(root, prepared),
    preparedMarkerPath: path.relative(root, marker)
  });
}

function writeJournal(root, fields) {
  const journal = path.join(root, "updates", "transactions", `${fields.id}.json`);
  fs.mkdirSync(path.dirname(journal), { recursive: true });
  fs.writeFileSync(
    journal,
    JSON.stringify({
      schemaVersion: 1,
      phaseTimestamps: {},
      snapshotPath: null,
      newLauncherPid: null,
      outcome: null,
      completedAt: null,
      errorCode: null,
      errorMessage: null,
      recoveryAttempted: false,
      ...fields
    })
  );
  return journal;
}

function context(root, overrides = {}) {
  return createContext(root, {
    healthTimeoutMs: 8000,
    healthIntervalMs: 100,
    shutdownTimeoutMs: 5000,
    useWindowsConsole: false,
    ...overrides
  });
}

async function health(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    return await response.json();
  } catch {
    return null;
  }
}

/** Start the root launcher directly, as "Run Scoreboard.cmd" would, and wait until it answers. */
async function launch(root, port) {
  const child = spawn(process.execPath, [path.join(root, "pbresults-launcher.mjs"), "--port", String(port), "--no-browser"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    env: childEnvironment({ APP_UPDATER_RECOVERY: "1" })
  });
  await once(child, "spawn");
  child.unref();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !(await health(port))) await new Promise((resolve) => setTimeout(resolve, 100));
  return child.pid;
}

function trackJournalProcess() {
  // Processes are stopped through the stop file in afterEach, never by pid.
}

afterEach(async () => {
  vi.restoreAllMocks();
  const finished = roots.splice(0);
  for (const root of finished) fs.writeFileSync(path.join(root, "stop-fake-servers"), "");
  await new Promise((resolve) => setTimeout(resolve, 600));
  for (const root of finished) fs.rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 100 });
});

describe("install", () => {
  it("installs over a running version, keeps the previous one and removes older ones", async () => {
    const root = makeRoot();
    const port = await freePort();
    makeApp(path.join(root, "app"), "1.0.0");
    writePointer(root, slot("1.0.0", "app"));
    const oldLauncher = await launch(root, port);
    expect((await health(port))?.appVersion).toBe("1.0.0");

    const journal = stageInstall(root, { id: "tx-b", sourceVersion: "1.0.0", version: "2.0.0", port, serverPid: oldLauncher });
    setTimeout(() => fs.writeFileSync(path.join(root, "stop-v1.0.0"), ""), 300);
    expect(await runTransaction(context(root), "install", journal)).toBe(0);
    trackJournalProcess(journal);

    const done = readJson(journal);
    expect(done).toMatchObject({ phase: "committed", outcome: "succeeded" });
    expect(Object.keys(done.phaseTimestamps)).toEqual(
      expect.arrayContaining(["install-coordinator-started", "old-process-stopped", "snapshot-created", "payload-finalized", "pointer-activated", "new-process-started", "health-confirmed", "committed"])
    );
    expect(readJson(path.join(root, "current-version.json"))).toMatchObject({
      active: slot("2.0.0", path.join("versions", "v2.0.0")),
      previous: slot("1.0.0", "app")
    });
    expect((await health(port))?.appVersion).toBe("2.0.0");
    expect(readJson(path.join(root, "data", "settings.json"))).toEqual({ name: "original" });
    const snapshot = path.join(root, done.snapshotPath);
    expect(readJson(path.join(snapshot, "snapshot.json"))).toMatchObject({ complete: true, fileCount: 2 });
    expect(fs.existsSync(path.join(root, "updates", "staging", "tx-b"))).toBe(false);
    expect(fs.existsSync(path.join(root, "app"))).toBe(true);

    // A second update makes the original app/ folder two versions old, so it is removed.
    const second = stageInstall(root, { id: "tx-c", sourceVersion: "2.0.0", version: "3.0.0", port, serverPid: done.newLauncherPid });
    setTimeout(() => fs.writeFileSync(path.join(root, "stop-v2.0.0"), ""), 300);
    expect(await runTransaction(context(root), "install", second)).toBe(0);
    trackJournalProcess(second);
    expect((await health(port))?.appVersion).toBe("3.0.0");
    expect(fs.existsSync(path.join(root, "app"))).toBe(false);
    expect(fs.readdirSync(path.join(root, "versions")).sort()).toEqual(["v2.0.0", "v3.0.0"]);
  });

  it.each(["exit", "wrong-version", "never-ready"])("rolls back automatically when the new version is %s", async (mode) => {
    const root = makeRoot();
    const port = await freePort();
    makeApp(path.join(root, "versions", "v1.0.0"), "1.0.0");
    writePointer(root, slot("1.0.0", path.join("versions", "v1.0.0")));
    const journal = stageInstall(root, { id: `tx-${mode}`, sourceVersion: "1.0.0", version: "2.0.0", port, mode });

    expect(await runTransaction(context(root, { healthTimeoutMs: mode === "exit" ? 8000 : 2500 }), "install", journal)).toBe(0);
    trackJournalProcess(journal);

    expect(readJson(journal)).toMatchObject({ phase: "rollback-completed", outcome: "rolled-back" });
    expect(readJson(path.join(root, "current-version.json")).active.version).toBe("1.0.0");
    expect((await health(port))?.appVersion).toBe("1.0.0");
  });

  it("restores the data snapshot when the new version damages data before failing", async () => {
    const root = makeRoot();
    const port = await freePort();
    makeApp(path.join(root, "versions", "v1.0.0"), "1.0.0");
    writePointer(root, slot("1.0.0", path.join("versions", "v1.0.0")));
    const journal = stageInstall(root, { id: "tx-corrupt", sourceVersion: "1.0.0", version: "2.0.0", port, mode: "corrupt-data-then-exit" });

    expect(await runTransaction(context(root), "install", journal)).toBe(0);
    trackJournalProcess(journal);

    expect(readJson(journal).phase).toBe("rollback-completed");
    expect(readJson(path.join(root, "data", "settings.json"))).toEqual({ name: "original" });
    expect(fs.readFileSync(path.join(root, "data", "uploads", "logo.png"))).toEqual(Buffer.from([1, 2, 3, 4]));
    const quarantined = fs.readdirSync(path.join(root, "updates", "quarantine")).find((name) => name.startsWith("failed-data-"));
    expect(fs.readFileSync(path.join(root, "updates", "quarantine", quarantined, "settings.json"), "utf8")).toBe("CORRUPTED");
  });

  it("fails without looping when the rollback target is also unhealthy", async () => {
    const root = makeRoot();
    const port = await freePort();
    makeApp(path.join(root, "versions", "v1.0.0"), "1.0.0", "exit");
    writePointer(root, slot("1.0.0", path.join("versions", "v1.0.0")));
    const journal = stageInstall(root, { id: "tx-both", sourceVersion: "1.0.0", version: "2.0.0", port, mode: "exit" });

    expect(await runTransaction(context(root), "install", journal)).toBe(1);
    expect(readJson(journal)).toMatchObject({ phase: "failed", outcome: "failed", errorCode: "UPDATE_ROLLBACK_FAILED" });
  });

  it("restarts the current version and stays retryable when the data snapshot fails", async () => {
    const root = makeRoot();
    const port = await freePort();
    makeApp(path.join(root, "versions", "v1.0.0"), "1.0.0");
    writePointer(root, slot("1.0.0", path.join("versions", "v1.0.0")));
    const journal = stageInstall(root, { id: "tx-snap", sourceVersion: "1.0.0", version: "2.0.0", port });
    const ctx = context(root, {
      fault: (point) => {
        if (point === "snapshot") throw new Error("disk full");
      }
    });

    expect(await runTransaction(ctx, "install", journal)).toBe(1);
    trackJournalProcess(journal);
    expect(readJson(journal)).toMatchObject({ phase: "prepared", errorCode: "UPDATE_SNAPSHOT_FAILED" });
    expect(readJson(path.join(root, "current-version.json")).active.version).toBe("1.0.0");
    expect((await health(port))?.appVersion).toBe("1.0.0");
    expect(fs.readdirSync(path.join(root, "backups", "pre-update"))).toEqual([]);
  });

  it("refuses to run while another live coordinator holds the lock, and takes over a stale lock", async () => {
    const root = makeRoot();
    const port = await freePort();
    makeApp(path.join(root, "versions", "v1.0.0"), "1.0.0");
    writePointer(root, slot("1.0.0", path.join("versions", "v1.0.0")));
    const journal = stageInstall(root, { id: "tx-lock", sourceVersion: "1.0.0", version: "2.0.0", port });
    const lockPath = path.join(root, "updates", "update.lock");

    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore", env: childEnvironment() });
    await once(holder, "spawn");
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: holder.pid }));
      expect(await runTransaction(context(root), "install", journal)).toBe(1);
      expect(readJson(journal).phase).toBe("shutdown-requested");
    } finally {
      holder.kill();
      await once(holder, "exit");
    }

    expect(isProcessAlive(holder.pid)).toBe(false);
    expect(await runTransaction(context(root), "install", journal)).toBe(0);
    trackJournalProcess(journal);
    expect(readJson(journal).phase).toBe("committed");
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});

describe("manual rollback", () => {
  it("switches back to the previous version", async () => {
    const root = makeRoot();
    const port = await freePort();
    makeApp(path.join(root, "versions", "v1.0.0"), "1.0.0");
    makeApp(path.join(root, "versions", "v2.0.0"), "2.0.0");
    writePointer(root, slot("2.0.0", path.join("versions", "v2.0.0")), slot("1.0.0", path.join("versions", "v1.0.0")));
    const journal = writeJournal(root, {
      id: "tx-manual",
      kind: "manual-rollback",
      phase: "shutdown-requested",
      sourceVersion: "2.0.0",
      sourceReleaseTag: "v2.0.0",
      targetVersion: "1.0.0",
      targetReleaseTag: "v1.0.0",
      serverPid: null,
      port
    });

    expect(await runTransaction(context(root), "rollback", journal)).toBe(0);
    trackJournalProcess(journal);
    expect(readJson(journal).phase).toBe("committed");
    expect(readJson(path.join(root, "current-version.json"))).toMatchObject({
      active: slot("1.0.0", path.join("versions", "v1.0.0")),
      previous: slot("2.0.0", path.join("versions", "v2.0.0"))
    });
    expect((await health(port))?.appVersion).toBe("1.0.0");
  });
});

describe("recovery after an interruption", () => {
  async function recoverAt(phase, setup = () => undefined) {
    const root = makeRoot();
    const port = await freePort();
    makeApp(path.join(root, "versions", "v1.0.0"), "1.0.0");
    makeApp(path.join(root, "versions", "v2.0.0"), "2.0.0");
    writePointer(root, slot("1.0.0", path.join("versions", "v1.0.0")));
    const journal = writeJournal(root, {
      id: `tx-${phase}`,
      phase,
      sourceVersion: "1.0.0",
      sourceReleaseTag: "v1.0.0",
      targetVersion: "2.0.0",
      serverPid: null,
      port
    });
    setup(root, journal);
    const code = await runTransaction(context(root), "recover", journal);
    trackJournalProcess(journal);
    return { root, port, journal, code };
  }

  it.each(["shutdown-requested", "install-coordinator-started", "old-process-stopped", "snapshot-created", "payload-finalized"])(
    "marks the update failed and keeps the previous version when interrupted at %s",
    async (phase) => {
      const { root, journal, code } = await recoverAt(phase);
      expect(code).toBe(0);
      expect(readJson(journal)).toMatchObject({ phase: "failed", errorCode: "UPDATE_ACTIVATION_FAILED" });
      expect(readJson(path.join(root, "current-version.json")).active.version).toBe("1.0.0");
    }
  );

  it("commits an update that was interrupted after its health check", async () => {
    const { journal } = await recoverAt("health-confirmed");
    expect(readJson(journal)).toMatchObject({ phase: "committed", outcome: "succeeded" });
  });

  it("finishes an update that was interrupted after the pointer switched", async () => {
    const { journal, port } = await recoverAt("pointer-activated", (root) =>
      writePointer(root, slot("2.0.0", path.join("versions", "v2.0.0")), slot("1.0.0", path.join("versions", "v1.0.0")))
    );
    expect(readJson(journal).phase).toBe("committed");
    expect((await health(port))?.appVersion).toBe("2.0.0");
  });

  it("completes a rollback that was interrupted, restoring the snapshot", async () => {
    const { root, journal, port } = await recoverAt("rollback-started", (portableRoot, journalPath) => {
      writePointer(portableRoot, slot("2.0.0", path.join("versions", "v2.0.0")), slot("1.0.0", path.join("versions", "v1.0.0")));
      const snapshot = path.join(portableRoot, "backups", "pre-update", "snap");
      fs.mkdirSync(path.join(snapshot, "data"), { recursive: true });
      fs.writeFileSync(path.join(snapshot, "data", "settings.json"), JSON.stringify({ name: "snapshot" }));
      fs.writeFileSync(journalPath, JSON.stringify({ ...readJson(journalPath), snapshotPath: path.relative(portableRoot, snapshot) }));
    });
    expect(readJson(journal).phase).toBe("rollback-completed");
    expect(readJson(path.join(root, "current-version.json")).active.version).toBe("1.0.0");
    expect(readJson(path.join(root, "data", "settings.json"))).toEqual({ name: "snapshot" });
    expect((await health(port))?.appVersion).toBe("1.0.0");
  });

  it("does not attempt recovery twice", async () => {
    const { journal, code } = await recoverAt("pointer-activated", (root, journalPath) =>
      fs.writeFileSync(journalPath, JSON.stringify({ ...readJson(journalPath), recoveryAttempted: true }))
    );
    expect(code).toBe(1);
    expect(readJson(journal)).toMatchObject({ phase: "failed", errorCode: "UPDATE_ROLLBACK_FAILED" });
  });
});

describe("cleanup", () => {
  function seedCleanupRoot() {
    const root = makeRoot();
    for (const version of ["1.0.0", "2.0.0", "3.0.0", "4.0.0"]) {
      fs.mkdirSync(path.join(root, "versions", `v${version}`, "node"), { recursive: true });
    }
    fs.mkdirSync(path.join(root, "app"), { recursive: true });
    writePointer(root, slot("4.0.0", path.join("versions", "v4.0.0")), slot("3.0.0", path.join("versions", "v3.0.0")));
    for (let index = 0; index < 5; index += 1) {
      const snapshot = path.join(root, "backups", "pre-update", `snapshot-${index}`);
      fs.mkdirSync(snapshot, { recursive: true });
      const time = new Date(Date.now() - (5 - index) * 60_000);
      fs.utimesSync(snapshot, time, time);
    }
    writeJournal(root, { id: "tx-open", phase: "prepared", preparedAppPath: path.join("versions", "v2.0.0") });
    return root;
  }

  it("keeps only the active and previous versions, the newest snapshots, and anything an open update uses", () => {
    const root = seedCleanupRoot();
    pruneUpdateArtifacts(context(root));
    expect(fs.readdirSync(path.join(root, "versions")).sort()).toEqual(["v2.0.0", "v3.0.0", "v4.0.0"]);
    expect(fs.existsSync(path.join(root, "app"))).toBe(false);
    expect(fs.readdirSync(path.join(root, "backups", "pre-update")).sort()).toEqual(["snapshot-2", "snapshot-3", "snapshot-4"]);
    expect(fs.readdirSync(path.join(root, "updates", "trash"))).toEqual([]);
  });

  it("skips a locked folder and removes it on the next run", () => {
    const root = seedCleanupRoot();
    const locked = path.join(root, "versions", "v1.0.0");
    const rename = fs.renameSync;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (path.resolve(String(from)) === locked) {
        throw Object.assign(new Error("resource busy"), { code: "EBUSY" });
      }
      return rename(from, to);
    });
    pruneUpdateArtifacts(context(root));
    expect(fs.existsSync(locked)).toBe(true);
    expect(fs.readFileSync(path.join(root, "logs", "updater.log"), "utf8")).toContain("Cleanup skipped");

    spy.mockRestore();
    pruneUpdateArtifacts(context(root));
    expect(fs.existsSync(locked)).toBe(false);
  });
});

describe.runIf(process.platform === "win32")("Windows console handoff", () => {
  it("starts the new version in its own console window through start", async () => {
    const root = makeRoot();
    const port = await freePort();
    makeApp(path.join(root, "versions", "v1.0.0"), "1.0.0");
    writePointer(root, slot("1.0.0", path.join("versions", "v1.0.0")));
    const journal = stageInstall(root, { id: "tx-console", sourceVersion: "1.0.0", version: "2.0.0", port });

    expect(await runTransaction(context(root, { useWindowsConsole: true }), "install", journal)).toBe(0);
    trackJournalProcess(journal);
    expect(readJson(journal).phase).toBe("committed");
    expect((await health(port))?.appVersion).toBe("2.0.0");
  });
});
