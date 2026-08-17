#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  compareStableVersions,
  findLatestStableVersion,
  githubRepositoryFromRemote,
  normalizeStableVersion
} from "./release-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultProjectDir = path.resolve(scriptDir, "..");

const helpText = `Create a PBResults Scoreboard release tag safely.

Usage:
  pnpm release <version> [options]

Examples:
  pnpm release 1.7.0
  pnpm release v1.7.0 --dry-run

Options:
  --dry-run      Validate and run checks without creating or pushing a tag
  --yes          Skip the interactive confirmation
  --skip-checks  Skip tests, typecheck, overlay scope check, and build
  -h, --help     Show this help
`;

export function parseReleaseArguments(argv) {
  const options = {
    versionInput: null,
    dryRun: false,
    yes: false,
    skipChecks: false,
    help: false
  };

  for (const argument of argv) {
    if (argument === "--") {
      continue;
    }
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (argument === "--yes") {
      options.yes = true;
      continue;
    }
    if (argument === "--skip-checks") {
      options.skipChecks = true;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`Unknown release option: ${argument}`);
    }
    if (options.versionInput) {
      throw new Error(`Only one release version may be provided. Received "${options.versionInput}" and "${argument}".`);
    }
    options.versionInput = argument;
  }

  if (!options.help && !options.versionInput) {
    throw new Error("A release version is required. Example: pnpm release 1.7.0");
  }
  return options;
}

export function runCommand(command, args, options = {}) {
  const capture = options.capture !== false;
  const allowedExitCodes = options.allowedExitCodes ?? [0];
  const isWindowsCommandScript = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const executable = isWindowsCommandScript ? "cmd.exe" : command;
  const executableArgs = isWindowsCommandScript ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });

  if (result.error) {
    throw new Error(`Unable to run ${command}: ${result.error.message}`);
  }
  const status = result.status ?? 1;
  if (!allowedExitCodes.includes(status)) {
    const detail = capture ? (result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${status}${detail ? `: ${detail}` : "."}`);
  }

  return {
    status,
    stdout: capture ? (result.stdout ?? "").trim() : "",
    stderr: capture ? (result.stderr ?? "").trim() : ""
  };
}

async function defaultConfirmation(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive confirmation requires a terminal. Re-run with --yes after reviewing the release summary.");
  }
  const interfaceInstance = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await interfaceInstance.question(prompt);
    return answer.trim().toLowerCase() === "y" || answer.trim().toLowerCase() === "yes";
  } finally {
    interfaceInstance.close();
  }
}

function formatReleaseSummary({ release, shortCommit, skipChecks, dryRun }) {
  return [
    "Release summary",
    "",
    `Version:       ${release.version}`,
    `Tag:           ${release.tag}`,
    "Branch:        main",
    `Commit:        ${shortCommit}`,
    "Remote:        origin",
    `Local checks:  ${skipChecks ? "skipped" : "passed"}`,
    `Mode:          ${dryRun ? "dry run" : "create and push tag"}`,
    ""
  ].join("\n");
}

export async function runRelease(options, dependencies = {}) {
  const cwd = dependencies.cwd ?? defaultProjectDir;
  const command = dependencies.command ?? runCommand;
  const confirm = dependencies.confirm ?? defaultConfirmation;
  const log = dependencies.log ?? ((message) => process.stdout.write(`${message}\n`));
  const release = normalizeStableVersion(options.versionInput);
  const git = (args, commandOptions = {}) => command("git", args, { cwd, ...commandOptions });

  const branch = git(["branch", "--show-current"]).stdout;
  if (branch !== "main") {
    throw new Error(`Release aborted: expected branch "main", but the current branch is "${branch || "(detached HEAD)"}".`);
  }

  const workingTree = git(["status", "--porcelain"]).stdout;
  if (workingTree) {
    throw new Error("Release aborted: the working tree is not clean. Commit or stash all changes before releasing.");
  }

  const remoteUrl = git(["remote", "get-url", "origin"]).stdout;
  log("Fetching origin/main and release tags...");
  git(["fetch", "origin", "main", "--tags"], { capture: false });

  const headCommit = git(["rev-parse", "HEAD"]).stdout;
  const remoteMainCommit = git(["rev-parse", "refs/remotes/origin/main"]).stdout;
  if (headCommit !== remoteMainCommit) {
    throw new Error(
      "Release aborted: local main is not synchronized with origin/main. Pull or push the branch, then run the release again."
    );
  }

  const localTagCheck = git(["show-ref", "--verify", "--quiet", `refs/tags/${release.tag}`], {
    allowedExitCodes: [0, 1]
  });
  const remoteTagCheck = git(["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${release.tag}`], {
    allowedExitCodes: [0, 2]
  });
  if (localTagCheck.status === 0 || remoteTagCheck.status === 0) {
    throw new Error(`Release aborted: tag ${release.tag} already exists${remoteTagCheck.status === 0 ? " on origin" : " locally"}.`);
  }

  const tags = git(["tag", "--list"]).stdout.split(/\r?\n/).filter(Boolean);
  const latestRelease = findLatestStableVersion(tags);
  if (latestRelease && compareStableVersions(release, latestRelease) <= 0) {
    throw new Error(
      `Release aborted: ${release.tag} must be newer than the latest stable tag ${latestRelease.tag}.`
    );
  }

  if (options.skipChecks) {
    log("WARNING: local verification checks were skipped.");
  } else {
    const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
    const checks = [
      ["Running tests", ["test"]],
      ["Running client TypeScript check", ["exec", "tsc", "-p", "tsconfig.json", "--pretty", "false"]],
      ["Checking overlay CSS scope", ["check:overlay-scope"]],
      ["Building production application", ["build"]]
    ];
    for (const [label, args] of checks) {
      log(`${label}...`);
      command(pnpm, args, { cwd, capture: false });
    }
  }

  const shortCommit = git(["rev-parse", "--short", "HEAD"]).stdout;
  log(formatReleaseSummary({ release, shortCommit, skipChecks: options.skipChecks, dryRun: options.dryRun }));

  if (options.dryRun) {
    log("Dry run complete. No tag was created or pushed.");
    return { status: "dry-run", release, headCommit };
  }

  if (!options.yes) {
    const confirmed = await confirm("Pushing this tag will trigger publication of a GitHub Release. Continue? [y/N] ");
    if (!confirmed) {
      log("Release cancelled. No tag was created.");
      return { status: "cancelled", release, headCommit };
    }
  }

  git(["tag", "-a", release.tag, "-m", `Release ${release.tag}`, "HEAD"], { capture: false });
  try {
    git(["push", "origin", `refs/tags/${release.tag}`], { capture: false });
  } catch (pushError) {
    let remoteTagAfterFailure;
    try {
      remoteTagAfterFailure = git(
        ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${release.tag}`],
        { allowedExitCodes: [0, 2] }
      );
    } catch {
      throw new Error(
        `The push command failed and the remote tag state could not be verified. The local tag was kept; inspect origin before retrying.\n${
          pushError instanceof Error ? pushError.message : String(pushError)
        }`
      );
    }
    if (remoteTagAfterFailure.status === 0) {
      throw new Error(
        `The push command reported a failure, but ${release.tag} exists on origin. The local tag was kept; inspect GitHub Actions before retrying.\n${
          pushError instanceof Error ? pushError.message : String(pushError)
        }`
      );
    }
    let rollbackMessage = "The local tag was removed.";
    try {
      git(["tag", "-d", release.tag], { capture: false });
    } catch {
      rollbackMessage = `The local tag could not be removed; delete it manually with: git tag -d ${release.tag}`;
    }
    throw new Error(`Failed to push ${release.tag}. ${rollbackMessage}\n${pushError instanceof Error ? pushError.message : String(pushError)}`);
  }

  const repository = githubRepositoryFromRemote(remoteUrl);
  log(`Release tag ${release.tag} was pushed successfully.`);
  if (repository) {
    const repositoryUrl = `https://github.com/${repository}`;
    log(`Tag:      ${repositoryUrl}/tree/${release.tag}`);
    log(`Actions:  ${repositoryUrl}/actions/workflows/build-windows-portable.yml`);
    log(`Release:  ${repositoryUrl}/releases/tag/${release.tag}`);
  }
  return { status: "pushed", release, headCommit };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseReleaseArguments(argv);
  if (options.help) {
    process.stdout.write(helpText);
    return;
  }
  await runRelease(options);
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
