#!/usr/bin/env node
import fs from "node:fs/promises";
import { existsSync, cpSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const packageJson = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8"));
const releaseDir = path.join(projectDir, "release", "windows-portable");
const bundleName = "PBResults-Scoreboard";
const bundleRoot = path.join(releaseDir, bundleName);
const appDir = path.join(bundleRoot, "app");
const dataDir = path.join(bundleRoot, "data");
const uploadsDir = path.join(dataDir, "uploads");
const logsDir = path.join(bundleRoot, "logs");
const runtimeDir = path.join(appDir, "node");
const portableLauncherSource = path.join(projectDir, "scripts", "portable-launcher.mjs");
const portableLauncherTarget = path.join(appDir, "start-portable.mjs");
const nodeVersion = process.versions.node;
const nodeRuntimeZipName = `node-v${nodeVersion}-win-x64.zip`;
const nodeRuntimeUrl = `https://nodejs.org/dist/v${nodeVersion}/${nodeRuntimeZipName}`;
const zipOutput = path.join(releaseDir, `${bundleName}-win-x64.zip`);

function fail(message) {
  throw new Error(message);
}

function run(command, args, options = {}) {
  const execOptions = {
    cwd: projectDir,
    stdio: "inherit",
    ...options
  };

  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    execFileSync("cmd.exe", ["/d", "/s", "/c", command, ...args], execOptions);
    return;
  }

  execFileSync(command, args, execOptions);
}

async function ensureWindowsHost() {
  if (process.platform !== "win32") {
    fail("Windows portable packaging must be run on Windows or Windows CI.");
  }
}

async function cleanReleaseDir() {
  rmSync(releaseDir, { recursive: true, force: true });
  await fs.mkdir(releaseDir, { recursive: true });
}

async function buildProject() {
  run("pnpm.cmd", ["build"]);
}

async function stageProductionApp() {
  await fs.mkdir(appDir, { recursive: true });
  const installDir = await fs.mkdtemp(path.join(os.tmpdir(), "pbresults-scoreboard-package-"));

  try {
    await fs.copyFile(path.join(projectDir, "package.json"), path.join(installDir, "package.json"));
    await fs.copyFile(path.join(projectDir, "pnpm-lock.yaml"), path.join(installDir, "pnpm-lock.yaml"));

    run(
      "pnpm.cmd",
      [
        "install",
        "--prod",
        "--frozen-lockfile",
        "--config.node-linker=hoisted",
        "--config.package-import-method=copy"
      ],
      { cwd: installDir }
    );

    const installedNodeModulesDir = path.join(installDir, "node_modules");
    if (!existsSync(installedNodeModulesDir)) {
      fail(`Temporary production install did not create node_modules: ${installedNodeModulesDir}`);
    }

    await fs.copyFile(path.join(installDir, "package.json"), path.join(appDir, "package.json"));
    cpSync(installedNodeModulesDir, path.join(appDir, "node_modules"), { recursive: true });
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
}

async function materializeNodeModules() {
  const sourceNodeModulesDir = path.join(appDir, "node_modules");
  const materializedNodeModulesDir = path.join(releaseDir, ".node_modules-materialized");

  if (!existsSync(sourceNodeModulesDir)) {
    fail(`Installed node_modules directory not found: ${sourceNodeModulesDir}`);
  }

  rmSync(materializedNodeModulesDir, { recursive: true, force: true });
  cpSync(sourceNodeModulesDir, materializedNodeModulesDir, {
    recursive: true,
    dereference: true
  });

  rmSync(sourceNodeModulesDir, { recursive: true, force: true });
  cpSync(materializedNodeModulesDir, sourceNodeModulesDir, {
    recursive: true
  });
  rmSync(materializedNodeModulesDir, { recursive: true, force: true });

  const requiredRuntimePackages = [
    path.join(sourceNodeModulesDir, "fastify", "package.json"),
    path.join(sourceNodeModulesDir, "react", "package.json"),
    path.join(sourceNodeModulesDir, "sharp", "package.json")
  ];

  for (const requiredPath of requiredRuntimePackages) {
    if (!existsSync(requiredPath)) {
      fail(`Required packaged runtime dependency not found: ${requiredPath}`);
    }
  }
}

async function copyBuiltArtifacts() {
  const sourceDistDir = path.join(projectDir, "dist");
  const targetDistDir = path.join(appDir, "dist");

  if (!existsSync(sourceDistDir)) {
    fail(`Built dist directory not found: ${sourceDistDir}`);
  }

  rmSync(targetDistDir, { recursive: true, force: true });
  cpSync(sourceDistDir, targetDistDir, { recursive: true });

  const requiredPaths = [
    path.join(targetDistDir, "client"),
    path.join(targetDistDir, "server", "server", "index.js")
  ];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      fail(`Required packaged build artifact not found: ${requiredPath}`);
    }
  }
}

async function pruneDeployedApp() {
  const removablePaths = [
    ".nvmrc",
    "SETUP.md",
    "data",
    "index.html",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "run.bat",
    "run.command",
    "run.ps1",
    "scripts",
    "setup.bat",
    "setup.command",
    "setup.ps1",
    "src",
    "tsconfig.json",
    "tsconfig.server.json",
    "vite.config.ts"
  ];

  for (const relativePath of removablePaths) {
    rmSync(path.join(appDir, relativePath), { recursive: true, force: true });
  }
}

async function downloadNodeRuntime(zipPath) {
  const response = await fetch(nodeRuntimeUrl);
  if (!response.ok) {
    fail(`Failed to download Windows Node runtime from ${nodeRuntimeUrl}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(zipPath, buffer);
}

async function installBundledNodeRuntime() {
  const overrideDir = process.env.PB_WINDOWS_NODE_RUNTIME_DIR;
  const overrideZip = process.env.PB_WINDOWS_NODE_RUNTIME_ZIP;
  const downloadZipPath = path.join(releaseDir, nodeRuntimeZipName);
  const sourceZipPath = overrideZip ? path.resolve(overrideZip) : downloadZipPath;
  const extractDir = path.join(releaseDir, ".node-runtime");

  rmSync(runtimeDir, { recursive: true, force: true });
  rmSync(extractDir, { recursive: true, force: true });

  if (overrideDir) {
    cpSync(path.resolve(overrideDir), runtimeDir, { recursive: true });
    return;
  }

  if (!overrideZip) {
    await downloadNodeRuntime(downloadZipPath);
  }

  await fs.mkdir(extractDir, { recursive: true });
  run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Path '${sourceZipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`
  ]);

  const [runtimeFolder] = await fs.readdir(extractDir);
  if (!runtimeFolder) {
    fail("Expanded Node runtime archive was empty.");
  }
  cpSync(path.join(extractDir, runtimeFolder), runtimeDir, { recursive: true });
  rmSync(extractDir, { recursive: true, force: true });
  if (!overrideZip) {
    rmSync(downloadZipPath, { force: true });
  }
}

async function writeBootstrapData() {
  const themeModule = await import(pathToFileURL(path.join(projectDir, "dist", "server", "shared", "theme.js")).href);
  const builtinThemeModule = await import(pathToFileURL(path.join(projectDir, "dist", "server", "shared", "builtinThemes.js")).href);

  const defaultSettings = themeModule.defaultSettings;
  const builtinThemes = builtinThemeModule.builtinThemes;

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(logsDir, { recursive: true });

  await fs.writeFile(path.join(dataDir, "settings.json"), `${JSON.stringify(defaultSettings, null, 2)}\n`);
  await fs.writeFile(path.join(dataDir, "themes.json"), `${JSON.stringify(builtinThemes, null, 2)}\n`);
  await fs.writeFile(path.join(dataDir, "teams.json"), "[]\n");
  await fs.writeFile(path.join(dataDir, "assets.json"), "[]\n");
  await fs.writeFile(path.join(dataDir, "operations.json"), `${JSON.stringify({ overrides: [] }, null, 2)}\n`);
}

async function writeLauncherFiles() {
  await fs.copyFile(portableLauncherSource, portableLauncherTarget);

  const launcher = `@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "APP_OPEN_BROWSER=1"
"%ROOT_DIR%app\\node\\node.exe" "%ROOT_DIR%app\\start-portable.mjs"
`;

  const readme = `PBResults Scoreboard - Windows Portable
========================================

First run
---------
1. Extract this folder somewhere writable.
2. Double-click "Run Scoreboard.cmd".
3. Your browser will open to the live operator overview.

Live overlay for vMix
---------------------
The launcher prints the live overlay URL in the console.
Use that URL as your browser source in vMix:
  http://localhost:3000/overlay/live

If port 3000 is already in use, the app will choose another free port and print the correct URL.

Move setup from another machine
-------------------------------
If you already have a setup on macOS, Linux, or another PC:
1. Export a full app backup JSON from the old machine.
2. Start this Windows portable app once.
3. Import the full app backup JSON.
4. Confirm the upstream URL, published theme, and team logos.

Update to a new release
-----------------------
1. Stop the app.
2. Keep a copy of the "data" folder.
3. Replace the "app" folder with the one from the new release.
4. Keep the existing "data" folder.
5. Run "Run Scoreboard.cmd" again.

Writable folders
----------------
- data\\   persistent settings, themes, teams, assets, uploads
- logs\\   runtime logs
`;

  const buildInfo = {
    appVersion: packageJson.version,
    builtAt: new Date().toISOString(),
    target: "windows-x64-portable",
    bundledNodeVersion: nodeVersion
  };

  await fs.writeFile(path.join(bundleRoot, "Run Scoreboard.cmd"), launcher.replace(/\n/g, "\r\n"));
  await fs.writeFile(path.join(bundleRoot, "README-OPERATOR.txt"), readme.replace(/\n/g, "\r\n"));
  await fs.writeFile(path.join(bundleRoot, "BUILD-INFO.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
}

async function createZipArchive() {
  rmSync(zipOutput, { force: true });
  run("powershell.exe", [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path '${bundleRoot.replace(/'/g, "''")}' -DestinationPath '${zipOutput.replace(/'/g, "''")}' -Force`
  ]);
}

async function main() {
  await ensureWindowsHost();
  await cleanReleaseDir();
  await buildProject();
  await stageProductionApp();
  await materializeNodeModules();
  await copyBuiltArtifacts();
  await pruneDeployedApp();
  await installBundledNodeRuntime();
  await writeBootstrapData();
  await writeLauncherFiles();
  await createZipArchive();

  process.stdout.write(`\n[package] Windows portable bundle ready:\n  ${bundleRoot}\n`);
  process.stdout.write(`[package] Zip archive ready:\n  ${zipOutput}\n`);
}

await main();
