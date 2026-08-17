import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { parseReleaseArguments, runCommand, runRelease } from "./release.mjs";
import {
  compareStableVersions,
  findLatestStableVersion,
  githubRepositoryFromRemote,
  normalizeStableVersion,
  resolvePortableReleaseMetadata
} from "./release-utils.mjs";

const tempRoots = [];
const testDir = path.dirname(fileURLToPath(import.meta.url));

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function createTestRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-release-test-"));
  tempRoots.push(root);
  const remote = path.join(root, "origin.git");
  const worktree = path.join(root, "worktree");
  fs.mkdirSync(worktree);

  git(root, ["init", "--bare", "--initial-branch=main", remote]);
  git(worktree, ["init", "--initial-branch=main"]);
  git(worktree, ["config", "user.name", "Release Test"]);
  git(worktree, ["config", "user.email", "release-test@example.com"]);
  fs.writeFileSync(path.join(worktree, "README.md"), "release test\n");
  git(worktree, ["add", "README.md"]);
  git(worktree, ["commit", "-m", "initial"]);
  git(worktree, ["remote", "add", "origin", remote]);
  git(worktree, ["push", "-u", "origin", "main"]);
  return { remote, worktree };
}

function releaseOptions(versionInput, overrides = {}) {
  return {
    versionInput,
    dryRun: false,
    yes: true,
    skipChecks: true,
    help: false,
    ...overrides
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("release version helpers", () => {
  it("normalizes stable versions and tags", () => {
    expect(normalizeStableVersion("1.7.0")).toEqual({ version: "1.7.0", tag: "v1.7.0", parts: [1, 7, 0] });
    expect(normalizeStableVersion("v2.0.3")).toEqual({ version: "2.0.3", tag: "v2.0.3", parts: [2, 0, 3] });
  });

  it.each(["", "1.7", "v1.7", "01.7.0", "1.07.0", "release-1.7.0", "1.7.0-beta.1"])(
    "rejects invalid or unsupported version %j",
    (value) => {
      expect(() => normalizeStableVersion(value)).toThrow("Expected MAJOR.MINOR.PATCH");
    }
  );

  it("compares and finds stable versions", () => {
    expect(compareStableVersions("1.7.0", "1.6.9")).toBe(1);
    expect(compareStableVersions("1.7.0", "1.7.0")).toBe(0);
    expect(compareStableVersions("1.6.9", "1.7.0")).toBe(-1);
    expect(findLatestStableVersion(["preview", "v1.4.0", "v2.0.0-beta.1", "v1.9.2"])?.tag).toBe("v1.9.2");
  });

  it("recognizes common GitHub remote formats", () => {
    expect(githubRepositoryFromRemote("https://github.com/example/project.git")).toBe("example/project");
    expect(githubRepositoryFromRemote("git@github.com:example/project.git")).toBe("example/project");
    expect(githubRepositoryFromRemote("ssh://git@github.com/example/project.git")).toBe("example/project");
    expect(githubRepositoryFromRemote("/tmp/project.git")).toBeNull();
  });

  it("derives portable package metadata from the release tag", () => {
    expect(resolvePortableReleaseMetadata("v1.7.0", "0.1.0")).toEqual({
      appVersion: "1.7.0",
      releaseTag: "v1.7.0",
      zipFileName: "pbresults-scoreboard-windows-portable-v1.7.0.zip"
    });
    expect(resolvePortableReleaseMetadata("", "0.1.0")).toEqual({
      appVersion: "0.1.0",
      releaseTag: null,
      zipFileName: "PBResults-Scoreboard-win-x64.zip"
    });
  });
});

describe("release arguments", () => {
  it("parses supported options", () => {
    expect(parseReleaseArguments(["1.7.0", "--dry-run", "--yes", "--skip-checks"])).toEqual({
      versionInput: "1.7.0",
      dryRun: true,
      yes: true,
      skipChecks: true,
      help: false
    });
  });

  it("rejects missing versions, duplicate versions, and unknown options", () => {
    expect(() => parseReleaseArguments([])).toThrow("A release version is required");
    expect(() => parseReleaseArguments(["1.7.0", "1.8.0"])).toThrow("Only one release version");
    expect(() => parseReleaseArguments(["1.7.0", "--force"])).toThrow("Unknown release option");
  });
});

describe("GitHub release workflow", () => {
  it("keeps manual runs build-only and publishes versioned tag builds", () => {
    const workflow = fs.readFileSync(
      path.resolve(testDir, "../.github/workflows/build-windows-portable.yml"),
      "utf8"
    );

    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("if: github.ref_type == 'tag'");
    expect(workflow).toContain("RELEASE_TAG: ${{ github.ref_name }}");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("gh release upload");
    expect(workflow).toContain("gh release edit");
  });
});

describe("release repository workflow", () => {
  it("performs a dry run without creating a tag", async () => {
    const { worktree } = createTestRepository();
    const messages = [];
    const result = await runRelease(releaseOptions("1.0.0", { dryRun: true }), {
      cwd: worktree,
      log: (message) => messages.push(message)
    });

    expect(result.status).toBe("dry-run");
    expect(git(worktree, ["tag", "--list"])).toBe("");
    expect(messages.some((message) => message.includes("No tag was created or pushed"))).toBe(true);
  });

  it("runs every local verification command in order", async () => {
    const { worktree } = createTestRepository();
    const verificationCommands = [];
    const command = (executable, args, options) => {
      if (executable === "git") {
        return runCommand(executable, args, options);
      }
      verificationCommands.push(args);
      return { status: 0, stdout: "", stderr: "" };
    };

    await runRelease(releaseOptions("1.0.0", { dryRun: true, skipChecks: false }), {
      cwd: worktree,
      command,
      log: () => {}
    });

    expect(verificationCommands).toEqual([
      ["test"],
      ["exec", "tsc", "-p", "tsconfig.json", "--pretty", "false"],
      ["check:overlay-scope"],
      ["build"]
    ]);
  });

  it("cancels before creating a tag when confirmation is declined", async () => {
    const { worktree } = createTestRepository();
    const result = await runRelease(releaseOptions("1.0.0", { yes: false }), {
      cwd: worktree,
      confirm: async () => false,
      log: () => {}
    });

    expect(result.status).toBe("cancelled");
    expect(git(worktree, ["tag", "--list"])).toBe("");
  });

  it("creates an annotated tag and pushes it to origin", async () => {
    const { remote, worktree } = createTestRepository();
    const result = await runRelease(releaseOptions("1.0.0"), { cwd: worktree, log: () => {} });

    expect(result.status).toBe("pushed");
    expect(git(worktree, ["tag", "--list"])).toBe("v1.0.0");
    expect(git(rootForBare(remote), ["--git-dir", remote, "rev-list", "-n", "1", "v1.0.0"])).toBe(result.headCommit);
  });

  it("rejects dirty, non-main, and unsynchronized repositories", async () => {
    const dirty = createTestRepository().worktree;
    fs.writeFileSync(path.join(dirty, "dirty.txt"), "dirty\n");
    await expect(runRelease(releaseOptions("1.0.0", { dryRun: true }), { cwd: dirty, log: () => {} })).rejects.toThrow(
      "working tree is not clean"
    );

    const feature = createTestRepository().worktree;
    git(feature, ["switch", "-c", "feature"]);
    await expect(runRelease(releaseOptions("1.0.0", { dryRun: true }), { cwd: feature, log: () => {} })).rejects.toThrow(
      'expected branch "main"'
    );

    const ahead = createTestRepository().worktree;
    fs.appendFileSync(path.join(ahead, "README.md"), "ahead\n");
    git(ahead, ["add", "README.md"]);
    git(ahead, ["commit", "-m", "ahead"]);
    await expect(runRelease(releaseOptions("1.0.0", { dryRun: true }), { cwd: ahead, log: () => {} })).rejects.toThrow(
      "not synchronized with origin/main"
    );
  });

  it("rejects existing and non-increasing tags", async () => {
    const existing = createTestRepository().worktree;
    git(existing, ["tag", "-a", "v1.0.0", "-m", "Release v1.0.0"]);
    git(existing, ["push", "origin", "refs/tags/v1.0.0"]);
    await expect(runRelease(releaseOptions("1.0.0", { dryRun: true }), { cwd: existing, log: () => {} })).rejects.toThrow(
      "already exists"
    );

    const older = createTestRepository().worktree;
    git(older, ["tag", "-a", "v2.0.0", "-m", "Release v2.0.0"]);
    git(older, ["push", "origin", "refs/tags/v2.0.0"]);
    await expect(runRelease(releaseOptions("1.9.0", { dryRun: true }), { cwd: older, log: () => {} })).rejects.toThrow(
      "must be newer than the latest stable tag v2.0.0"
    );
  });

  it("removes the local tag when the push fails", async () => {
    const { worktree } = createTestRepository();
    const failingPushCommand = (command, args, options) => {
      if (command === "git" && args[0] === "push") {
        throw new Error("simulated push failure");
      }
      return runCommand(command, args, options);
    };

    await expect(
      runRelease(releaseOptions("1.0.0"), { cwd: worktree, command: failingPushCommand, log: () => {} })
    ).rejects.toThrow("The local tag was removed");
    expect(git(worktree, ["tag", "--list"])).toBe("");
  });
});

function rootForBare(remote) {
  return path.dirname(remote);
}
