import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { spawnCoordinator, updateService, UpdateFailure } from "./updateService.js";

const temporaryDirectories: string[] = [];

/** A stand-in coordinator: a Node script that can acknowledge the journal like the real one. */
function fixture(scriptBody: string, phase = "shutdown-requested") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-handoff-test-"));
  temporaryDirectories.push(root);
  const updaterPath = path.join(root, "coordinator.mjs");
  const transactionPath = path.join(root, "transaction.json");
  fs.writeFileSync(
    updaterPath,
    [
      'import fs from "node:fs";',
      'import path from "node:path";',
      "const transactionPath = process.argv[process.argv.indexOf(\"--transaction\") + 1];",
      "const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));",
      "const acknowledge = (phase) => fs.writeFileSync(transactionPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(transactionPath, \"utf8\")), phase }));",
      scriptBody
    ].join("\n"),
    "utf8"
  );
  fs.writeFileSync(transactionPath, JSON.stringify({ phase }), "utf8");
  return { root, updaterPath, transactionPath };
}

async function waitFor(predicate: () => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return;
    } catch {
      // The coordinator may be replacing the observed file between polls.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Condition was not met within ${timeoutMs} ms.`);
}

function processIsRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
  }
});

describe("automatic update check coordination", () => {
  it("defers an automatic check while another update operation is active", async () => {
    const service = updateService as unknown as {
      bootstrap: { supported: boolean };
      busy: boolean;
      scheduleAutomaticCheck: (delayMs: number) => void;
      getStatus: () => { phase: string };
      check: (manual: boolean) => Promise<{ phase: string }>;
    };
    const originalSupported = service.bootstrap.supported;
    const originalBusy = service.busy;
    const originalSchedule = service.scheduleAutomaticCheck;
    const originalGetStatus = service.getStatus;
    const schedule = vi.fn();
    service.bootstrap.supported = true;
    service.busy = true;
    service.scheduleAutomaticCheck = schedule;
    service.getStatus = () => ({ phase: "downloading" });
    try {
      await expect(service.check(false)).resolves.toEqual({ phase: "downloading" });
      expect(schedule).toHaveBeenCalledOnce();
      expect(schedule).toHaveBeenCalledWith(60_000);
    } finally {
      service.bootstrap.supported = originalSupported;
      service.busy = originalBusy;
      service.scheduleAutomaticCheck = originalSchedule;
      service.getStatus = originalGetStatus;
    }
  });
});

describe("coordinator startup handoff", () => {
  it("keeps the detached coordinator running after it acknowledges", async () => {
    const completionPath = path.join(os.tmpdir(), `pbresults-coordinator-complete-${process.pid}-${Date.now()}`);
    const fixtureData = fixture(
      `acknowledge("install-coordinator-started"); await sleep(700); fs.writeFileSync(${JSON.stringify(completionPath)}, String(process.pid));`
    );
    try {
      await spawnCoordinator("Install", fixtureData.transactionPath, "install-coordinator-started", {
        updaterPath: fixtureData.updaterPath,
        rootDirectory: fixtureData.root,
        startTimeoutMs: 15_000,
        stabilityMs: 100
      });
      await waitFor(() => fs.existsSync(completionPath) && fs.readFileSync(completionPath, "utf8").length > 0);
      const coordinatorPid = Number(fs.readFileSync(completionPath, "utf8"));
      expect(coordinatorPid).toBeGreaterThan(0);
      // Windows keeps a running process's working directory locked; let it exit before cleanup.
      await waitFor(() => !processIsRunning(coordinatorPid));
    } finally {
      fs.rmSync(completionPath, { force: true });
    }
  });

  it("passes the mode and journal path as plain arguments", async () => {
    const fixtureData = fixture(
      `fs.writeFileSync(path.join(path.dirname(transactionPath), "args.json"), JSON.stringify(process.argv.slice(2))); acknowledge("rollback-coordinator-started");`
    );
    await spawnCoordinator("Rollback", fixtureData.transactionPath, "rollback-coordinator-started", {
      updaterPath: fixtureData.updaterPath,
      rootDirectory: fixtureData.root,
      startTimeoutMs: 15_000,
      stabilityMs: 50
    });
    expect(JSON.parse(fs.readFileSync(path.join(fixtureData.root, "args.json"), "utf8"))).toEqual([
      "--mode",
      "rollback",
      "--transaction",
      fixtureData.transactionPath
    ]);
  });

  it("reports an early coordinator exit without advancing shutdown", async () => {
    const fixtureData = fixture("process.exit(23);");
    const error = await spawnCoordinator("Install", fixtureData.transactionPath, "install-coordinator-started", {
      updaterPath: fixtureData.updaterPath,
      rootDirectory: fixtureData.root,
      startTimeoutMs: 15_000,
      stabilityMs: 100
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(UpdateFailure);
    expect(error.message).toContain("exit code 23");
    expect(error.message).toContain("current version is still running");
    expect(JSON.parse(fs.readFileSync(fixtureData.transactionPath, "utf8")).phase).toBe("shutdown-requested");
  });

  it("reports startup timeout and stops the coordinator", async () => {
    const markerPath = path.join(os.tmpdir(), `pbresults-coordinator-late-${process.pid}-${Date.now()}`);
    const fixtureData = fixture(`await sleep(2000); fs.writeFileSync(${JSON.stringify(markerPath)}, "late");`);
    const error = await spawnCoordinator("Install", fixtureData.transactionPath, "install-coordinator-started", {
      updaterPath: fixtureData.updaterPath,
      rootDirectory: fixtureData.root,
      startTimeoutMs: 250,
      stabilityMs: 50
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(UpdateFailure);
    expect(error.message).toContain("did not acknowledge startup");
    expect(JSON.parse(fs.readFileSync(fixtureData.transactionPath, "utf8")).phase).toBe("shutdown-requested");
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(fs.existsSync(markerPath)).toBe(false);
  });
});
