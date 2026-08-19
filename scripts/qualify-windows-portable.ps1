[CmdletBinding()]
param(
  [string]$PackageDirectory = '',
  [string]$InstallationRoot = '',
  [int]$Port = 43871,
  [switch]$KeepInstallation,
  [switch]$CleanupOnly,
  [switch]$HealthFailureOnly
)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($PackageDirectory)) {
  $PackageDirectory = Join-Path $PSScriptRoot '..\release\windows-portable'
}
if ([string]::IsNullOrWhiteSpace($InstallationRoot)) {
  $InstallationRoot = Join-Path ([Environment]::GetFolderPath('Desktop')) 'PBResults-Scoreboard'
}
$PackageDirectory = [IO.Path]::GetFullPath($PackageDirectory)
$InstallationRoot = [IO.Path]::GetFullPath($InstallationRoot)
$InstallationParent = Split-Path -Parent $InstallationRoot
$InstallationLeaf = Split-Path -Leaf $InstallationRoot
if ($InstallationLeaf -ne 'PBResults-Scoreboard' -or -not $InstallationParent) {
  throw 'Qualification installation must be an absent PBResults-Scoreboard child directory.'
}
if ($CleanupOnly) {
  if (Test-Path -LiteralPath $InstallationRoot) {
    Remove-Item -LiteralPath $InstallationRoot -Recurse -Force
  }
  return
}
if (Test-Path -LiteralPath $InstallationRoot) {
  throw "Qualification installation already exists: $InstallationRoot"
}

$Zip = (Get-ChildItem -LiteralPath $PackageDirectory -Filter 'pbresults-scoreboard-windows-portable-v1.10.1.zip' -File -ErrorAction Stop).FullName
$ManifestPath = (Get-ChildItem -LiteralPath $PackageDirectory -Filter 'pbresults-scoreboard-update-manifest-v1.10.1.json' -File -ErrorAction Stop).FullName
$Utf8 = [Text.UTF8Encoding]::new($false)
$LaunchedPids = [System.Collections.Generic.List[int]]::new()
$SummaryJson = $null

function Write-Json([string]$Path, [object]$Value) {
  [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 20) + [Environment]::NewLine, $Utf8)
}

function Stop-LauncherTree([int]$ProcessId) {
  if ($ProcessId -le 0) { return }
  try {
    & taskkill.exe /PID ([string]$ProcessId) /T /F 2>$null | Out-Null
  } catch {
    # The coordinator may already have stopped the launcher tree.
  }
}

try {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($Zip, $InstallationParent)
  $Root = $InstallationRoot
  $Updater = Join-Path $Root 'portable-updater.ps1'
  $BuildPath = Join-Path $Root 'app\BUILD-INFO.json'
  $Build = Get-Content -LiteralPath $BuildPath -Raw | ConvertFrom-Json
  $Build.appVersion = '1.10.0'
  $Build.releaseTag = 'v1.10.0'
  Write-Json $BuildPath $Build
  Write-Json (Join-Path $Root 'current-version.json') ([ordered]@{
    schemaVersion = 1
    generation = 1
    active = [ordered]@{ version = '1.10.0'; releaseTag = 'v1.10.0'; relativePath = 'app' }
    previous = $null
    updatedAt = [DateTime]::UtcNow.ToString('o')
  })

  $Preserved = Join-Path $Root 'data\qualification-preserved.json'
  [IO.File]::WriteAllText($Preserved, '{"preserve":"yes","value":1100}' + [Environment]::NewLine, $Utf8)
  $NestedUpload = Join-Path $Root 'data\uploads\qualification\nested\logo.bin'
  New-Item -ItemType Directory -Path (Split-Path -Parent $NestedUpload) -Force | Out-Null
  [IO.File]::WriteAllBytes($NestedUpload, [byte[]](1, 2, 3, 4, 5, 6, 7, 8))

  $Updates = Join-Path $Root 'updates'
  $Downloads = Join-Path $Updates 'downloads'
  $StagingRoot = Join-Path $Updates 'staging'
  $Transactions = Join-Path $Updates 'transactions'
  New-Item -ItemType Directory -Path $Downloads, $StagingRoot, $Transactions -Force | Out-Null
  $Archive = Join-Path $Downloads 'v1.10.1-qualification.zip'
  Copy-Item -LiteralPath $Zip -Destination $Archive
  $Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
  $BadManifest = $Manifest | ConvertTo-Json -Depth 20 | ConvertFrom-Json
  $BadManifest.asset.sha256 = '0' * 64
  $Id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  $Staging = Join-Path $StagingRoot $Id
  $TransactionPath = Join-Path $Transactions "$Id.json"
  $Transaction = [ordered]@{
    schemaVersion = 1
    id = $Id
    phase = 'staging'
    phaseTimestamps = [ordered]@{ staging = [DateTime]::UtcNow.ToString('o') }
    sourceVersion = '1.10.0'
    sourceReleaseTag = 'v1.10.0'
    targetVersion = '1.10.1'
    archivePath = 'updates\downloads\v1.10.1-qualification.zip'
    stagingPath = "updates\staging\$Id"
    manifest = $BadManifest
    expectedArchiveHash = $BadManifest.asset.sha256
    port = $Port
    preparedAppPath = $null
    stagedAt = $null
    snapshotPath = $null
    targetAppPath = $null
    newLauncherPid = $null
    outcome = $null
    completedAt = $null
    errorCode = $null
    errorMessage = $null
    recoveryAttempted = $false
    preparedMarkerPath = $null
    serverPid = $null
  }
  Write-Json $TransactionPath $Transaction

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Updater -Mode Stage -TransactionPath $TransactionPath
  $FailedStageExit = $LASTEXITCODE
  $AfterFailedStage = Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json
  if ($FailedStageExit -eq 0 -or $AfterFailedStage.errorCode -ne 'UPDATE_DIGEST_MISMATCH') {
    throw 'Failed staging qualification did not fail with digest mismatch.'
  }

  $Retry = Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json
  $Retry.phase = 'staging'
  $Retry.manifest = $Manifest
  $Retry.expectedArchiveHash = $Manifest.asset.sha256
  $Retry.errorCode = $null
  $Retry.errorMessage = $null
  $Retry.outcome = $null
  $Retry.completedAt = $null
  Write-Json $TransactionPath $Retry
  New-Item -ItemType Directory -Path (Join-Path $Staging 'payload.partial') -Force | Out-Null
  [IO.File]::WriteAllText((Join-Path $Staging 'stale.tmp'), 'stale')
  [IO.File]::WriteAllText((Join-Path $Staging 'stale.bak'), 'stale')
  New-Item -ItemType Directory -Path (Join-Path $Staging 'stale.partial') | Out-Null
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Updater -Mode Stage -TransactionPath $TransactionPath
  if ($LASTEXITCODE -ne 0) { throw 'Staging retry failed.' }
  $Prepared = Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json
  if ($Prepared.phase -ne 'prepared') { throw "Expected prepared, got $($Prepared.phase)." }
  $StageArtifacts = @(Get-ChildItem -LiteralPath $Staging -Recurse -Force | Where-Object {
    $_.Name -match '\.(tmp|bak)$' -or $_.Name -like '*.partial'
  }).Count

  if ($HealthFailureOnly) {
    $PreparedApp = Join-Path $Root $Prepared.preparedAppPath
    [IO.File]::WriteAllText((Join-Path $PreparedApp 'start-portable.mjs'), 'process.exit(91);' + [Environment]::NewLine, $Utf8)
    $Prepared.serverPid = $null
    Write-Json $TransactionPath $Prepared
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Updater -Mode Install -TransactionPath $TransactionPath
    if ($LASTEXITCODE -ne 0) { throw 'Health-failure qualification coordinator failed to complete rollback.' }
    $RolledBack = Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json
    if ($RolledBack.newLauncherPid) { $LaunchedPids.Add([int]$RolledBack.newLauncherPid) }
    $RestoredHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
    $RollbackPointer = Get-Content -LiteralPath (Join-Path $Root 'current-version.json') -Raw | ConvertFrom-Json
    $RollbackData = Get-Content -LiteralPath $Preserved -Raw | ConvertFrom-Json
    $RollbackPhases = @($RolledBack.phaseTimestamps.psobject.Properties | ForEach-Object {
      [pscustomobject]@{ phase = $_.Name; timestamp = [string]$_.Value }
    } | Sort-Object timestamp)
    $SummaryJson = ([ordered]@{
      root = $Root
      phase = $RolledBack.phase
      outcome = $RolledBack.outcome
      errorCode = $RolledBack.errorCode
      restoredHealthVersion = $RestoredHealth.appVersion
      pointerVersion = $RollbackPointer.active.version
      pointerPrevious = $RollbackPointer.previous.version
      pointerGeneration = $RollbackPointer.generation
      dataRestored = ($RollbackData.preserve -eq 'yes')
      nestedUploadRestored = (Test-Path -LiteralPath $NestedUpload)
      stagingRetryArtifacts = $StageArtifacts
      phaseLog = $RollbackPhases
    } | ConvertTo-Json -Depth 8)
    $SummaryJson
    return
  }

  $Dummy = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-Command', 'Start-Sleep -Seconds 60') -PassThru -WindowStyle Hidden
  $Prepared.serverPid = $Dummy.Id
  Write-Json $TransactionPath $Prepared
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Updater -Mode Install -TransactionPath $TransactionPath
  $ShutdownExit = $LASTEXITCODE
  $AfterShutdown = Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json
  if ($ShutdownExit -eq 0 -or $AfterShutdown.phase -ne 'prepared' -or $AfterShutdown.errorCode -ne 'UPDATE_SHUTDOWN_TIMEOUT') {
    throw 'Interrupted shutdown did not remain prepared with a timeout error.'
  }
  if (-not $Dummy.HasExited) { Stop-Process -Id $Dummy.Id -Force }

  $Lock = [IO.File]::Open($Preserved, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
  try {
    $AfterShutdown.serverPid = $null
    $AfterShutdown.errorCode = $null
    $AfterShutdown.errorMessage = $null
    Write-Json $TransactionPath $AfterShutdown
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Updater -Mode Install -TransactionPath $TransactionPath
    $SnapshotExit = $LASTEXITCODE
  } finally {
    $Lock.Dispose()
  }
  $AfterSnapshot = Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json
  if ($AfterSnapshot.newLauncherPid) { $LaunchedPids.Add([int]$AfterSnapshot.newLauncherPid) }
  if ($SnapshotExit -eq 0 -or $AfterSnapshot.phase -ne 'prepared' -or $AfterSnapshot.errorCode -ne 'UPDATE_SNAPSHOT_FAILED') {
    throw 'Snapshot failure did not restart the current app and return to prepared.'
  }
  $OldHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
  if ($OldHealth.appVersion -ne '1.10.0') { throw 'The old version was not healthy after snapshot failure.' }
  Stop-LauncherTree ([int]$AfterSnapshot.newLauncherPid)
  Start-Sleep -Seconds 2

  $AfterSnapshot.serverPid = $null
  $AfterSnapshot.errorCode = $null
  $AfterSnapshot.errorMessage = $null
  $AfterSnapshot.newLauncherPid = $null
  Write-Json $TransactionPath $AfterSnapshot
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Updater -Mode Install -TransactionPath $TransactionPath
  if ($LASTEXITCODE -ne 0) { throw 'Final installation retry failed.' }
  $Final = Get-Content -LiteralPath $TransactionPath -Raw | ConvertFrom-Json
  if ($Final.newLauncherPid) { $LaunchedPids.Add([int]$Final.newLauncherPid) }
  $NewHealth = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5
  $FinalPointer = Get-Content -LiteralPath (Join-Path $Root 'current-version.json') -Raw | ConvertFrom-Json
  $Data = Get-Content -LiteralPath $Preserved -Raw | ConvertFrom-Json
  $SnapshotManifest = Get-Content -LiteralPath (Join-Path (Join-Path $Root $Final.snapshotPath) 'snapshot.json') -Raw | ConvertFrom-Json
  $TempArtifacts = @(Get-ChildItem -LiteralPath $Root -Recurse -Force | Where-Object {
    $_.Name -match '\.(tmp|bak)$' -or $_.Name -like '*.partial'
  } | Select-Object -ExpandProperty FullName)
  $PhaseLog = @($Final.phaseTimestamps.psobject.Properties | ForEach-Object {
    [pscustomobject]@{ phase = $_.Name; timestamp = [string]$_.Value }
  } | Sort-Object timestamp)
  $SummaryJson = ([ordered]@{
    root = $Root
    failedStagingExit = $FailedStageExit
    stagingRetryPhase = $Prepared.phase
    stagingRetryArtifacts = $StageArtifacts
    interruptedShutdownExit = $ShutdownExit
    interruptedShutdownPhase = $AfterShutdown.phase
    snapshotFailureExit = $SnapshotExit
    snapshotFailurePhase = $AfterSnapshot.phase
    oldHealthVersion = $OldHealth.appVersion
    finalPhase = $Final.phase
    outcome = $Final.outcome
    newHealthVersion = $NewHealth.appVersion
    pointerVersion = $FinalPointer.active.version
    pointerPrevious = $FinalPointer.previous.version
    pointerGeneration = $FinalPointer.generation
    dataPreserved = ($Data.preserve -eq 'yes')
    nestedUploadPreserved = (Test-Path -LiteralPath $NestedUpload)
    snapshotComplete = $SnapshotManifest.complete
    snapshotContainsPreserved = [bool]($SnapshotManifest.files | Where-Object { $_.path -eq 'qualification-preserved.json' })
    archiveCleaned = (-not (Test-Path -LiteralPath $Archive))
    stagingCleaned = (-not (Test-Path -LiteralPath $Staging))
    tempArtifacts = $TempArtifacts
    phaseLog = $PhaseLog
  } | ConvertTo-Json -Depth 8)
} finally {
  foreach ($LaunchedPid in $LaunchedPids) { Stop-LauncherTree $LaunchedPid }
  Start-Sleep -Milliseconds 500
  if (-not $KeepInstallation -and (Test-Path -LiteralPath $InstallationRoot)) {
    $ResolvedCleanup = [IO.Path]::GetFullPath($InstallationRoot)
    if ((Split-Path -Leaf $ResolvedCleanup) -ne 'PBResults-Scoreboard') {
      throw "Refusing to clean unexpected qualification path: $ResolvedCleanup"
    }
    Remove-Item -LiteralPath $ResolvedCleanup -Recurse -Force
  }
}

if ($SummaryJson) { $SummaryJson }
