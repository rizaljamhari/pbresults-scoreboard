#!/usr/bin/env node
import fs from "node:fs/promises";
import { createReadStream, existsSync, cpSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createUpdateManifest, resolvePortableReleaseMetadata } from "./release-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const packageJson = JSON.parse(await fs.readFile(path.join(projectDir, "package.json"), "utf8"));
const releaseMetadata = resolvePortableReleaseMetadata(process.env.RELEASE_TAG, packageJson.version);
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
const rootLauncherSource = path.join(projectDir, "scripts", "portable-launcher.ps1");
const rootUpdaterSource = path.join(projectDir, "scripts", "portable-updater.ps1");
const nodeVersion = process.versions.node;
const nodeRuntimeZipName = `node-v${nodeVersion}-win-x64.zip`;
const nodeRuntimeUrl = `https://nodejs.org/dist/v${nodeVersion}/${nodeRuntimeZipName}`;
const zipOutput = path.join(
  releaseDir,
  releaseMetadata.zipFileName
);
const manifestOutput = path.join(releaseDir, releaseMetadata.manifestFileName);
const builtAt = new Date().toISOString();
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectDir, encoding: "utf8" }).trim().toLowerCase();
const windowsPathBudget = Number(process.env.PB_WINDOWS_PATH_BUDGET ?? 259);
const validationPortableRoot = path.resolve(
  process.env.PB_WINDOWS_PATH_VALIDATION_ROOT ?? path.join("C:\\Users", os.userInfo().username, "Desktop", bundleName)
);
let buildInfo;

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

    await pruneSharpBuildArtifacts(installedNodeModulesDir);

    await fs.copyFile(path.join(installDir, "package.json"), path.join(appDir, "package.json"));
    cpSync(installedNodeModulesDir, path.join(appDir, "node_modules"), { recursive: true });
  } finally {
    rmSync(installDir, { recursive: true, force: true });
  }
}

async function findSharpPackageDirectories(nodeModulesDir) {
  const found = [];
  const pending = [nodeModulesDir];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(current, entry.name);
      if (entry.name === "sharp" && existsSync(path.join(child, "package.json"))) {
        try {
          const metadata = JSON.parse(await fs.readFile(path.join(child, "package.json"), "utf8"));
          if (metadata.name === "sharp") found.push(child);
        } catch {
          // A malformed package will be rejected by the runtime smoke test.
        }
      }
      pending.push(child);
    }
  }
  return found;
}

async function removeNamedDirectories(root, directoryName) {
  if (!existsSync(root)) return;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const child = path.join(current, entry.name);
      if (entry.name.toLowerCase() === directoryName.toLowerCase()) {
        rmSync(child, { recursive: true, force: true });
      } else {
        pending.push(child);
      }
    }
  }
}

async function pruneSharpBuildArtifacts(nodeModulesDir) {
  const sharpDirectories = await findSharpPackageDirectories(nodeModulesDir);
  if (sharpDirectories.length === 0) {
    fail("No Sharp installations were found in the production dependency tree.");
  }
  for (const sharpDirectory of sharpDirectories) {
    rmSync(path.join(sharpDirectory, "src"), { recursive: true, force: true });
    rmSync(path.join(sharpDirectory, "install"), { recursive: true, force: true });
    await removeNamedDirectories(path.join(sharpDirectory, "vendor"), "include");
  }
  process.stdout.write(`[package] Pruned build-only Sharp sources and headers from ${sharpDirectories.length} runtime installation(s).\n`);
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
    `Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
      `[System.IO.Compression.ZipFile]::ExtractToDirectory('${sourceZipPath.replace(/'/g, "''")}', '${extractDir.replace(/'/g, "''")}')`
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

async function verifyPackagedImageRuntime() {
  const smokeTestPath = path.join(appDir, `.image-runtime-smoke-${process.pid}.mjs`);
  const smokeTest = `
import sharp from "sharp";
import { applySegmentationMask } from "@imgly/background-removal-node";

const pixels = Buffer.from([
  255, 0, 0, 255,
  0, 255, 0, 255,
  0, 0, 255, 255,
  255, 255, 255, 255
]);
const input = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
const directMetadata = await sharp(input).metadata();
if (directMetadata.width !== 2 || directMetadata.height !== 2 || directMetadata.format !== "png") {
  throw new Error("Direct Sharp runtime operation failed.");
}
const mask = await sharp(Buffer.from([255, 128, 64, 0]), { raw: { width: 2, height: 2, channels: 1 } }).png().toBuffer();
const masked = await applySegmentationMask(
  new Blob([input], { type: "image/png" }),
  new Blob([mask], { type: "image/png" }),
  { output: { format: "image/png", quality: 1 } }
);
const maskedMetadata = await sharp(Buffer.from(await masked.arrayBuffer())).metadata();
if (maskedMetadata.width !== 2 || maskedMetadata.height !== 2 || maskedMetadata.format !== "png") {
  throw new Error("IMG.LY background-removal runtime operation failed.");
}
process.stdout.write("IMAGE_RUNTIME_OK\\n");
`;
  await fs.writeFile(smokeTestPath, smokeTest, "utf8");
  try {
    run(path.join(runtimeDir, "node.exe"), [smokeTestPath], { cwd: appDir });
  } finally {
    rmSync(smokeTestPath, { force: true });
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
  const bootstrapDir = path.join(appDir, "updater-bootstrap");
  await fs.mkdir(bootstrapDir, { recursive: true });
  await fs.copyFile(rootLauncherSource, path.join(bootstrapDir, "portable-launcher.ps1"));
  await fs.copyFile(rootUpdaterSource, path.join(bootstrapDir, "portable-updater.ps1"));
  await fs.copyFile(rootLauncherSource, path.join(bundleRoot, "portable-launcher.ps1"));
  await fs.copyFile(rootUpdaterSource, path.join(bundleRoot, "portable-updater.ps1"));

  const launcher = `@echo off
setlocal
set "ROOT_DIR=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT_DIR%portable-launcher.ps1"
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

Software updates
----------------
Open Settings in the local admin page to check for, download, and install updates.
Installation always requires confirmation and briefly restarts the admin page and overlay.
Before switching versions, the updater stores a safety snapshot under backups\\pre-update.
If the new version fails its health check, the previous app and data snapshot are restored automatically.
Detailed update events are written to logs\\updater.log.

Writable folders
----------------
- data\\   persistent settings, themes, teams, assets, uploads
- logs\\   runtime logs
`;

  buildInfo = {
    schemaVersion: 1,
    appVersion: releaseMetadata.appVersion,
    releaseTag: releaseMetadata.releaseTag,
    builtAt,
    target: "windows-x64-portable",
    bundledNodeVersion: nodeVersion,
    updaterProtocolVersion: 1,
    sourceRepository: "rizaljamhari/pbresults-scoreboard",
    sourceCommit
  };

  await fs.writeFile(path.join(bundleRoot, "Run Scoreboard.cmd"), launcher.replace(/\n/g, "\r\n"));
  await fs.writeFile(path.join(bundleRoot, "README-OPERATOR.txt"), readme.replace(/\n/g, "\r\n"));
  await fs.writeFile(path.join(bundleRoot, "BUILD-INFO.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
  await fs.writeFile(path.join(appDir, "BUILD-INFO.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);
  await fs.writeFile(
    path.join(bundleRoot, "current-version.json"),
    `${JSON.stringify({
      schemaVersion: 1,
      generation: 1,
      active: { version: buildInfo.appVersion, releaseTag: buildInfo.releaseTag, relativePath: "app" },
      previous: null,
      updatedAt: builtAt
    }, null, 2)}\n`
  );
}

async function calculateDirectorySize(target) {
  let total = 0;
  for (const entry of await fs.readdir(target, { withFileTypes: true })) {
    const child = path.join(target, entry.name);
    total += entry.isDirectory() ? await calculateDirectorySize(child) : entry.isFile() ? (await fs.stat(child)).size : 0;
  }
  return total;
}

async function hashFile(target) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const input = createReadStream(target);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("error", reject);
    input.on("end", resolve);
  });
  return hash.digest("hex");
}

async function createZipArchive() {
  rmSync(zipOutput, { force: true });
  const temporaryZip = path.join(os.tmpdir(), `pbresults-scoreboard-${process.pid}-${Date.now()}.zip`);
  rmSync(temporaryZip, { force: true });
  try {
    run("powershell.exe", [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
        `[System.IO.Compression.ZipFile]::CreateFromDirectory('${releaseDir.replace(/'/g, "''")}', '${temporaryZip.replace(/'/g, "''")}', ` +
        `[System.IO.Compression.CompressionLevel]::Optimal, $false)`
    ]);
    await fs.rename(temporaryZip, zipOutput);
  } finally {
    rmSync(temporaryZip, { force: true });
  }
}

function inspectZipPathBudget() {
  if (!Number.isSafeInteger(windowsPathBudget) || windowsPathBudget < 200) {
    fail(`Invalid Windows path budget: ${windowsPathBudget}`);
  }
  const inspectionScript = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($env:PB_ZIP_PATH)
try {
  $staging = Join-Path ([System.IO.Path]::GetFullPath($env:PB_VALIDATION_ROOT)) 'updates\\staging\\00000000-0000-0000-0000-000000000000'
  $legacyLongest = $null
  $actualLongest = $null
  $violations = @()
  $count = 0
  foreach ($entry in $zip.Entries) {
    $count++
    $entryName = $entry.FullName.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
    $legacy = [System.IO.Path]::GetFullPath((Join-Path $staging $entryName))
    if ($null -eq $legacyLongest -or $legacy.Length -gt $legacyLongest.length) {
      $legacyLongest = [pscustomobject]@{ entry = $entry.FullName; path = $legacy; length = $legacy.Length }
    }
    if ($legacy.Length -gt [int]$env:PB_PATH_BUDGET) {
      $violations += [pscustomobject]@{ entry = $entry.FullName; path = $legacy; length = $legacy.Length }
    }
    $prefix = 'PBResults-Scoreboard/app/'
    if ($entry.FullName.Replace('\\', '/').StartsWith($prefix, [System.StringComparison]::Ordinal)) {
      $relative = $entry.FullName.Replace('\\', '/').Substring($prefix.Length)
      if ($relative) {
        $actual = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $staging 'payload.partial') $relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar)))
        if ($null -eq $actualLongest -or $actual.Length -gt $actualLongest.length) {
          $actualLongest = [pscustomobject]@{ entry = $entry.FullName; path = $actual; length = $actual.Length }
        }
      }
    }
  }
  [pscustomobject]@{
    entryCount = $count
    pathBudget = [int]$env:PB_PATH_BUDGET
    validationRoot = $env:PB_VALIDATION_ROOT
    legacyLongest = $legacyLongest
    actualLongest = $actualLongest
    violations = $violations
  } | ConvertTo-Json -Depth 5 -Compress
} finally {
  $zip.Dispose()
}
`;
  const output = execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", inspectionScript],
    {
      cwd: projectDir,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      env: {
        ...process.env,
        PB_ZIP_PATH: zipOutput,
        PB_VALIDATION_ROOT: validationPortableRoot,
        PB_PATH_BUDGET: String(windowsPathBudget)
      }
    }
  ).trim();
  const inspection = JSON.parse(output);
  if (inspection.violations.length > 0) {
    const longest = inspection.violations.sort((left, right) => right.length - left.length)[0];
    fail(
      `Windows staging path budget exceeded (${longest.length} > ${windowsPathBudget}): ${longest.path} [${longest.entry}]`
    );
  }
  process.stdout.write(
    `[package] Inspected ${inspection.entryCount} ZIP entries; longest legacy staging path is ${inspection.legacyLongest.length}/${windowsPathBudget} characters.\n`
  );
  process.stdout.write(`[package] Longest ZIP entry: ${inspection.legacyLongest.entry}\n`);
  process.stdout.write(`[package] Projected legacy staging path: ${inspection.legacyLongest.path}\n`);
  process.stdout.write(`[package] Projected short staging path: ${inspection.actualLongest.path}\n`);
  return inspection;
}

async function writeUpdateManifest() {
  const stats = await fs.stat(zipOutput);
  const unpackedSize = await calculateDirectorySize(appDir);
  const manifest = createUpdateManifest(buildInfo, {
    name: releaseMetadata.zipFileName,
    size: stats.size,
    unpackedSize,
    sha256: await hashFile(zipOutput)
  });
  await fs.writeFile(manifestOutput, `${JSON.stringify(manifest, null, 2)}\n`);
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
  await verifyPackagedImageRuntime();
  await writeBootstrapData();
  await writeLauncherFiles();
  await createZipArchive();
  inspectZipPathBudget();
  await writeUpdateManifest();

  process.stdout.write(`\n[package] Windows portable bundle ready:\n  ${bundleRoot}\n`);
  process.stdout.write(`[package] Zip archive ready:\n  ${zipOutput}\n`);
  process.stdout.write(`[package] Update manifest ready:\n  ${manifestOutput}\n`);
}

await main();
