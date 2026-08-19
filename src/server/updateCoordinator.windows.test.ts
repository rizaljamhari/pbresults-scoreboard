import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorLaunch, spawnCoordinator, updateService, UpdateFailure } from "./updateService.js";

const temporaryDirectories: string[] = [];

function fixture(scriptBody: string, phase = "shutdown-requested") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-handoff-test-"));
  temporaryDirectories.push(root);
  const updaterPath = path.join(root, "coordinator.ps1");
  const transactionPath = path.join(root, "transaction.json");
  fs.writeFileSync(
    updaterPath,
    `[CmdletBinding()]\nparam([string]$Mode,[string]$TransactionPath)\n$ErrorActionPreference='Stop'\n${scriptBody}\n`.replaceAll("\\n", "\n"),
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

describe.runIf(process.platform === "win32")("coordinator startup handoff", () => {
  it("launches the coordinator through an independent Start-Process bootstrap", () => {
    const launch = createCoordinatorLaunch(
      "Install",
      "C:\\portable-root\\portable-updater.ps1",
      "C:\\portable-root\\updates\\transactions\\transaction.json",
      "C:\\portable-root"
    );
    expect(launch.options).toMatchObject({ cwd: "C:\\portable-root", stdio: "ignore", windowsHide: false });
    expect(launch.options.detached).not.toBe(true);
    expect(launch.options.env).toMatchObject({
      PB_COORDINATOR_UPDATER_PATH: "C:\\portable-root\\portable-updater.ps1",
      PB_COORDINATOR_MODE: "Install",
      PB_COORDINATOR_TRANSACTION_PATH: "C:\\portable-root\\updates\\transactions\\transaction.json",
      PB_COORDINATOR_PID_PATH: launch.pidPath
    });
    expect(launch.arguments).toHaveLength(3);
    expect(launch.arguments.slice(0, 2)).toEqual(["-NoProfile", "-EncodedCommand"]);
    expect(Buffer.from(launch.arguments[2], "base64").toString("utf16le")).toContain("Start-Process");
  });

  it("keeps the independent coordinator alive after its bootstrap wrapper exits", async () => {
    const completionPath = path.join(os.tmpdir(), `pbresults-coordinator-complete-${process.pid}-${Date.now()}`);
    const fixtureData = fixture(
      `$tx=Get-Content -LiteralPath $TransactionPath -Raw|ConvertFrom-Json;$tx.phase='install-coordinator-started';$json=$tx|ConvertTo-Json;[IO.File]::WriteAllText($TransactionPath,$json,[Text.UTF8Encoding]::new($false));Start-Sleep -Milliseconds 700;[IO.File]::WriteAllText('${completionPath.replaceAll("'", "''")}','complete')`
    );
    const launch = createCoordinatorLaunch("Install", fixtureData.updaterPath, fixtureData.transactionPath, os.tmpdir());
    const wrapper = spawn("powershell.exe", launch.arguments, launch.options);
    let coordinatorPid: number | null = null;
    try {
      await waitFor(() => JSON.parse(fs.readFileSync(fixtureData.transactionPath, "utf8")).phase === "install-coordinator-started");
      coordinatorPid = Number(fs.readFileSync(launch.pidPath, "utf8").trim());
      expect(Number.isSafeInteger(coordinatorPid)).toBe(true);
      expect(wrapper.exitCode).toBeNull();
      wrapper.kill();
      await waitFor(() => fs.existsSync(completionPath));
      expect(fs.readFileSync(completionPath, "utf8")).toBe("complete");
      await waitFor(() => !processIsRunning(coordinatorPid!));
    } finally {
      wrapper.kill();
      if (coordinatorPid && processIsRunning(coordinatorPid)) {
        process.kill(coordinatorPid);
      }
      fs.rmSync(launch.pidPath, { force: true });
      fs.rmSync(completionPath, { force: true });
    }
  });

  for (const [mode, phase] of [
    ["Install", "install-coordinator-started"],
    ["Rollback", "rollback-coordinator-started"]
  ] as const) {
    it(`waits for the ${mode.toLowerCase()} coordinator acknowledgement`, async () => {
      const fixtureData = fixture(
        `$tx=Get-Content -LiteralPath $TransactionPath -Raw|ConvertFrom-Json;$tx.phase='${phase}';$json=$tx|ConvertTo-Json;[IO.File]::WriteAllText($TransactionPath,$json,[Text.UTF8Encoding]::new($false));Start-Sleep -Milliseconds 900`
      );
      await expect(
        spawnCoordinator(mode, fixtureData.transactionPath, phase, {
          updaterPath: fixtureData.updaterPath,
          rootDirectory: fixtureData.root,
          startTimeoutMs: 8000,
          stabilityMs: 150
        })
      ).resolves.toBeUndefined();
      expect(JSON.parse(fs.readFileSync(fixtureData.transactionPath, "utf8")).phase).toBe(phase);
      await new Promise((resolve) => setTimeout(resolve, 900));
    });
  }

  it("reports an early coordinator exit without advancing shutdown", async () => {
    const fixtureData = fixture("exit 23");
    const error = await spawnCoordinator("Install", fixtureData.transactionPath, "install-coordinator-started", {
      updaterPath: fixtureData.updaterPath,
      // Keep the short-lived PowerShell host's working directory outside the
      // fixture so Windows can remove the fixture immediately after early exit.
      rootDirectory: os.tmpdir(),
      startTimeoutMs: 2000,
      stabilityMs: 100
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(UpdateFailure);
    expect(error.message).toContain("current version is still running");
    expect(JSON.parse(fs.readFileSync(fixtureData.transactionPath, "utf8")).phase).toBe("shutdown-requested");
  });

  it("reports startup timeout without advancing shutdown", async () => {
    const fixtureData = fixture("Start-Sleep -Seconds 5");
    const error = await spawnCoordinator("Install", fixtureData.transactionPath, "install-coordinator-started", {
      updaterPath: fixtureData.updaterPath,
      rootDirectory: fixtureData.root,
      startTimeoutMs: 250,
      stabilityMs: 50
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(UpdateFailure);
    expect(error.message).toContain("did not acknowledge startup");
    expect(error.message).toContain("current version is still running");
    expect(JSON.parse(fs.readFileSync(fixtureData.transactionPath, "utf8")).phase).toBe("shutdown-requested");
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
});
