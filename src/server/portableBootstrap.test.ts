import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { refreshCoordinatorScript } from "./portableBootstrap.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-coordinator-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function coordinator(version: number, body = "Write-Output 'coordinator'"): string {
  return `# PBRESULTS_COORDINATOR_VERSION: ${version}\n${body}\n`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("portable coordinator refresh", () => {
  it("installs a missing coordinator", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source.ps1");
    const destination = path.join(root, "portable-updater.ps1");
    fs.writeFileSync(source, coordinator(2));

    expect(refreshCoordinatorScript(source, destination, path.join(root, "update.lock"))).toBe("installed");
    expect(fs.readFileSync(destination, "utf8")).toBe(coordinator(2));
  });

  it("does not rewrite an identical coordinator", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source.ps1");
    const destination = path.join(root, "portable-updater.ps1");
    fs.writeFileSync(source, coordinator(2));
    fs.copyFileSync(source, destination);
    const before = fs.statSync(destination).mtimeMs;

    expect(refreshCoordinatorScript(source, destination, path.join(root, "update.lock"))).toBe("identical");
    expect(fs.statSync(destination).mtimeMs).toBe(before);
  });

  it("atomically replaces an older coordinator with a newer packaged version", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source.ps1");
    const destination = path.join(root, "portable-updater.ps1");
    fs.writeFileSync(source, coordinator(3, "Write-Output 'new'"));
    fs.writeFileSync(destination, coordinator(2, "Write-Output 'old'"));

    expect(refreshCoordinatorScript(source, destination, path.join(root, "update.lock"))).toBe("updated");
    expect(fs.readFileSync(destination, "utf8")).toBe(coordinator(3, "Write-Output 'new'"));
    expect(fs.readdirSync(root).some((name) => /\.tmp$|\.bak$/.test(name))).toBe(false);
  });

  it("does not downgrade a newer installed coordinator", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source.ps1");
    const destination = path.join(root, "portable-updater.ps1");
    fs.writeFileSync(source, coordinator(2));
    fs.writeFileSync(destination, coordinator(4, "Write-Output 'future'"));

    expect(refreshCoordinatorScript(source, destination, path.join(root, "update.lock"))).toBe("newer-present");
    expect(fs.readFileSync(destination, "utf8")).toBe(coordinator(4, "Write-Output 'future'"));
  });

  it.runIf(process.platform === "win32")("defers replacement while a coordinator holds the update lock", async () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source.ps1");
    const destination = path.join(root, "portable-updater.ps1");
    const lock = path.join(root, "update.lock");
    const ready = path.join(root, "ready");
    fs.writeFileSync(source, coordinator(3));
    fs.writeFileSync(destination, coordinator(2));
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "$s=[IO.File]::Open($env:LOCK,[IO.FileMode]::Create,[IO.FileAccess]::Write,[IO.FileShare]::None);" +
          "[IO.File]::WriteAllText($env:READY,'ready'); Start-Sleep -Seconds 20; $s.Dispose()"
      ],
      { env: { ...process.env, LOCK: lock, READY: ready }, stdio: "ignore" }
    );
    try {
      const deadline = Date.now() + 30_000;
      while (!fs.existsSync(ready) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(fs.existsSync(ready)).toBe(true);
      expect(refreshCoordinatorScript(source, destination, lock)).toBe("deferred-active");
      expect(fs.readFileSync(destination, "utf8")).toBe(coordinator(2));
    } finally {
      child.kill();
      await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 30_000))]);
    }
  });
});
