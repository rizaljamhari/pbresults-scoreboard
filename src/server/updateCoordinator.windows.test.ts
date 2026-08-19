import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnCoordinator, UpdateFailure } from "./updateService.js";

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

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe.runIf(process.platform === "win32")("coordinator startup handoff", () => {
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
          startTimeoutMs: 3000,
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
      rootDirectory: fixtureData.root,
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
