import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const updaterPath = path.join(scriptDirectory, "portable-updater.ps1");
const temporaryDirectories = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pbresults-updater-test-"));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  return root;
}

const harness = String.raw`
$ErrorActionPreference = 'Stop'
$UpdaterPath = $env:PB_TEST_UPDATER_PATH
$TestRoot = $env:PB_TEST_ROOT
$Action = $env:PB_TEST_ACTION
$Tokens = $null
$ParseErrors = $null
$Ast = [System.Management.Automation.Language.Parser]::ParseFile($UpdaterPath, [ref]$Tokens, [ref]$ParseErrors)
if ($ParseErrors.Count -gt 0) { throw ($ParseErrors | Out-String) }
$Needed = @('Write-UpdaterLog','Resolve-RootChild','Write-AtomicJson','Remove-StaleSnapshotPartial','Get-FileSha256','Get-RootRelativePath','Get-ChildRelativePath','Save-Transaction','New-DataSnapshot')
foreach ($Name in $Needed) {
  $Definition = $Ast.FindAll({ param($Node) $Node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -eq $Name }, $true) | Select-Object -First 1
  if ($null -eq $Definition) { throw "Function not found: $Name" }
  Invoke-Expression $Definition.Extent.Text
}
$Root = [System.IO.Path]::GetFullPath($TestRoot)
$Mode = 'Test'
$Updates = Join-Path $Root 'updates'
$LogDir = Join-Path $Root 'logs'
$LogPath = Join-Path $LogDir 'updater.log'
New-Item -ItemType Directory -Path $Updates,$LogDir,(Join-Path $Updates 'transactions') -Force | Out-Null

if ($Action -eq 'atomic') {
  $Target = Join-Path $Updates 'existing.json'
  [IO.File]::WriteAllText($Target, '{"value":0}')
  [IO.File]::WriteAllText("$Target.tmp", 'stale')
  [IO.File]::WriteAllText("$Target.bak", 'stale')
  Write-AtomicJson $Target ([ordered]@{ value = 1 })
  Write-AtomicJson $Target ([ordered]@{ value = 2 })
  $Artifacts = @(Get-ChildItem -LiteralPath $Updates -File | Where-Object { $_.Name -match '\.(tmp|bak)$' })
  [pscustomobject]@{ value = (Get-Content $Target -Raw | ConvertFrom-Json).value; artifactCount = $Artifacts.Count } | ConvertTo-Json -Compress
  exit 0
}

$Transaction = [pscustomobject]@{
  id = '11111111-2222-3333-4444-555555555555'
  sourceVersion = '1.10.0'
  targetVersion = '1.10.1'
  phase = 'old-process-stopped'
  phaseTimestamps = [pscustomobject]@{}
  snapshotPath = $null
}
$script:TransactionFullPath = Join-Path $Updates 'transactions\snapshot.json'
Write-AtomicJson $script:TransactionFullPath $Transaction

if ($Action -eq 'snapshot-retry') {
  $LockedPath = Join-Path $Root 'data\locked.json'
  [IO.File]::WriteAllText($LockedPath, '{"locked":true}')
  $Lock = [IO.File]::Open($LockedPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
  try {
    try { New-DataSnapshot $Transaction; throw 'Snapshot unexpectedly succeeded while a data file was locked.' }
    catch { if (-not $_.Exception.Message.StartsWith('UPDATE_SNAPSHOT_FAILED')) { throw } }
  } finally { $Lock.Dispose() }
  New-DataSnapshot $Transaction
} else {
  New-DataSnapshot $Transaction
}
$ManifestPath = Join-Path (Resolve-RootChild $Transaction.snapshotPath) 'snapshot.json'
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
$Artifacts = @(Get-ChildItem -LiteralPath $Root -Recurse -Force | Where-Object { $_.Name -match '\.(tmp|bak)$' -or $_.Name -like '*.partial' })
[pscustomobject]@{
  phase = $Transaction.phase
  snapshotPath = $Transaction.snapshotPath
  fileCount = $Manifest.fileCount
  totalBytes = [int64]$Manifest.totalBytes
  complete = $Manifest.complete
  artifactCount = $Artifacts.Count
} | ConvertTo-Json -Compress
`;

function invokeHarness(root, action) {
  return JSON.parse(
    execFileSync("powershell.exe", ["-NoProfile", "-Command", harness], {
      encoding: "utf8",
      env: {
        ...process.env,
        PB_TEST_UPDATER_PATH: updaterPath,
        PB_TEST_ROOT: root,
        PB_TEST_ACTION: action
      }
    }).trim()
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe.runIf(process.platform === "win32")("portable updater PowerShell primitives", () => {
  it("atomically replaces an existing JSON file and removes retry artifacts", () => {
    expect(invokeHarness(temporaryRoot(), "atomic")).toEqual({ value: 2, artifactCount: 0 });
  });

  it("creates a complete snapshot for an empty data directory", () => {
    const result = invokeHarness(temporaryRoot(), "snapshot");
    expect(result).toMatchObject({ phase: "snapshot-created", fileCount: 0, totalBytes: 0, complete: true, artifactCount: 0 });
  });

  it("snapshots normal JSON files", () => {
    const root = temporaryRoot();
    fs.writeFileSync(path.join(root, "data", "settings.json"), '{"theme":"default"}\n');
    fs.writeFileSync(path.join(root, "data", "teams.json"), "[]\n");
    const expected = fs.statSync(path.join(root, "data", "settings.json")).size + fs.statSync(path.join(root, "data", "teams.json")).size;
    expect(invokeHarness(root, "snapshot")).toMatchObject({ fileCount: 2, totalBytes: expected, complete: true, artifactCount: 0 });
  });

  it("snapshots nested uploads", () => {
    const root = temporaryRoot();
    const nested = path.join(root, "data", "uploads", "teams", "home");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "logo.png"), Buffer.from([1, 2, 3, 4, 5]));
    expect(invokeHarness(root, "snapshot")).toMatchObject({ fileCount: 1, totalBytes: 5, complete: true, artifactCount: 0 });
  });

  it("uses Int64 byte accumulation for larger files", () => {
    const root = temporaryRoot();
    fs.writeFileSync(path.join(root, "data", "large.bin"), Buffer.alloc(12 * 1024 * 1024, 0x5a));
    expect(invokeHarness(root, "snapshot")).toMatchObject({ fileCount: 1, totalBytes: 12 * 1024 * 1024, complete: true, artifactCount: 0 });
  });

  it("cleans a failed partial snapshot and succeeds on retry", () => {
    expect(invokeHarness(temporaryRoot(), "snapshot-retry")).toMatchObject({
      phase: "snapshot-created",
      fileCount: 1,
      complete: true,
      artifactCount: 0
    });
  });
});
