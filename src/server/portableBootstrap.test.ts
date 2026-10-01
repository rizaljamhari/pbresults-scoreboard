import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { refreshCoordinatorScript, updaterLockIsActive } from "./portableBootstrap.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-coordinator-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function coordinator(version: number, body = "console.log('coordinator');"): string {
  return `// PBRESULTS_COORDINATOR_VERSION: ${version}\n${body}\n`;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("portable coordinator refresh", () => {
  it("installs a missing coordinator", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source.mjs");
    const destination = path.join(root, "pbresults-updater.mjs");
    fs.writeFileSync(source, coordinator(2));

    expect(refreshCoordinatorScript(source, destination, path.join(root, "update.lock"))).toBe("installed");
    expect(fs.readFileSync(destination, "utf8")).toBe(coordinator(2));
  });

  it("does not rewrite an identical coordinator", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source.mjs");
    const destination = path.join(root, "pbresults-updater.mjs");
    fs.writeFileSync(source, coordinator(2));
    fs.copyFileSync(source, destination);
    const before = fs.statSync(destination).mtimeMs;

    expect(refreshCoordinatorScript(source, destination, path.join(root, "update.lock"))).toBe("identical");
    expect(fs.statSync(destination).mtimeMs).toBe(before);
  });

  it("atomically replaces an older coordinator with a newer packaged version", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source.mjs");
    const destination = path.join(root, "pbresults-updater.mjs");
    fs.writeFileSync(source, coordinator(3, "console.log('new');"));
    fs.writeFileSync(destination, coordinator(2, "console.log('old');"));

    expect(refreshCoordinatorScript(source, destination, path.join(root, "update.lock"))).toBe("updated");
    expect(fs.readFileSync(destination, "utf8")).toBe(coordinator(3, "console.log('new');"));
    expect(fs.readdirSync(root).some((name) => /\.tmp$|\.bak$/.test(name))).toBe(false);
  });

  it("does not downgrade a newer installed coordinator", () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source.mjs");
    const destination = path.join(root, "pbresults-updater.mjs");
    fs.writeFileSync(source, coordinator(2));
    fs.writeFileSync(destination, coordinator(4, "console.log('future');"));

    expect(refreshCoordinatorScript(source, destination, path.join(root, "update.lock"))).toBe("newer-present");
    expect(fs.readFileSync(destination, "utf8")).toBe(coordinator(4, "console.log('future');"));
  });

  it("defers replacement while a live coordinator holds the update lock", async () => {
    const root = temporaryDirectory();
    const source = path.join(root, "source.mjs");
    const destination = path.join(root, "pbresults-updater.mjs");
    const lock = path.join(root, "update.lock");
    fs.writeFileSync(source, coordinator(3));
    fs.writeFileSync(destination, coordinator(2));
    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore" });
    try {
      await once(holder, "spawn");
      fs.writeFileSync(lock, JSON.stringify({ pid: holder.pid, startedAt: new Date().toISOString() }));
      expect(updaterLockIsActive(lock)).toBe(true);
      expect(refreshCoordinatorScript(source, destination, lock)).toBe("deferred-active");
      expect(fs.readFileSync(destination, "utf8")).toBe(coordinator(2));
    } finally {
      holder.kill();
      await once(holder, "exit");
    }
  });

  it("treats a lock left by a process that has exited as stale", async () => {
    const root = temporaryDirectory();
    const lock = path.join(root, "update.lock");
    const finished = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
    await once(finished, "exit");
    fs.writeFileSync(lock, JSON.stringify({ pid: finished.pid, startedAt: new Date().toISOString() }));
    expect(updaterLockIsActive(lock)).toBe(false);
    expect(fs.existsSync(lock)).toBe(false);
  });
});
