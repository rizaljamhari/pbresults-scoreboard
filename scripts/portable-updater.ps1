[CmdletBinding()]
# PBRESULTS_COORDINATOR_VERSION: 2
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Stage', 'Install', 'Rollback', 'Recover')]
  [string]$Mode,
  [Parameter(Mandatory = $true)]
  [string]$TransactionPath
)

$ErrorActionPreference = 'Stop'
$ProtocolVersion = 1
$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$Updates = Join-Path $Root 'updates'
$LockPath = Join-Path $Updates 'update.lock'
$PointerPath = Join-Path $Root 'current-version.json'
$LogDir = Join-Path $Root 'logs'
$LogPath = Join-Path $LogDir 'updater.log'
$LockStream = $null

New-Item -ItemType Directory -Path $Updates -Force | Out-Null
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Write-UpdaterLog([string]$Message) {
  Add-Content -LiteralPath $LogPath -Value "$([DateTime]::UtcNow.ToString('o')) [$Mode] $Message"
}

function Resolve-RootChild([string]$Candidate) {
  $Resolved = if ([System.IO.Path]::IsPathRooted($Candidate)) {
    [System.IO.Path]::GetFullPath($Candidate)
  } else {
    [System.IO.Path]::GetFullPath((Join-Path $Root $Candidate))
  }
  $Prefix = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Resolved.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escapes the portable root: $Candidate"
  }
  return $Resolved
}

function Write-AtomicJson([string]$Path, [object]$Value) {
  $Parent = Split-Path -Parent $Path
  if ($Parent) { New-Item -ItemType Directory -Path $Parent -Force | Out-Null }
  foreach ($LegacyArtifact in @("$Path.tmp", "$Path.bak")) {
    if (Test-Path -LiteralPath $LegacyArtifact) {
      Remove-Item -LiteralPath $LegacyArtifact -Force
    }
  }
  $Token = "$PID-$([Guid]::NewGuid().ToString('N'))"
  $Temp = "$Path.$Token.tmp"
  $Backup = "$Path.$Token.bak"
  try {
    $Json = $Value | ConvertTo-Json -Depth 20
    $Encoding = [System.Text.UTF8Encoding]::new($false)
    $Bytes = $Encoding.GetBytes($Json + [Environment]::NewLine)
    $Stream = [System.IO.File]::Open($Temp, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      $Stream.Write($Bytes, 0, $Bytes.Length)
      $Stream.Flush($true)
    } finally {
      $Stream.Dispose()
    }
    $Check = Get-Content -LiteralPath $Temp -Raw | ConvertFrom-Json
    if ($null -eq $Check) { throw "Unable to validate temporary JSON: $Temp" }
    if (Test-Path -LiteralPath $Path) {
      # PowerShell 5.1 can coerce $null to an empty string when binding this
      # .NET overload, which File.Replace rejects as an illegal backup path.
      [System.IO.File]::Replace($Temp, $Path, $Backup)
    } else {
      [System.IO.File]::Move($Temp, $Path)
    }
  } finally {
    foreach ($Artifact in @($Temp, $Backup)) {
      try {
        if (Test-Path -LiteralPath $Artifact) { [System.IO.File]::Delete($Artifact) }
      } catch {
        Write-UpdaterLog "Deferred cleanup for ${Artifact}: $($_.Exception.Message)"
      }
    }
  }
}

function Remove-StaleSnapshotPartial([string]$Partial) {
  if (Test-Path -LiteralPath $Partial) {
    try {
      Remove-Item -LiteralPath $Partial -Recurse -Force
    } catch {
      Write-UpdaterLog "Unable to remove incomplete snapshot ${Partial}: $($_.Exception.Message)"
      throw 'UPDATE_SNAPSHOT_FAILED'
    }
  }
}

function Get-FileSha256([string]$Path) {
  $Stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  $Hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($Hasher.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant()
  } finally {
    $Hasher.Dispose()
    $Stream.Dispose()
  }
}

function Get-RootRelativePath([string]$FullPath) {
  $Resolved = Resolve-RootChild $FullPath
  return $Resolved.Substring($Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar).Length + 1)
}

function Get-ChildRelativePath([string]$BasePath, [string]$FullPath) {
  $Base = [System.IO.Path]::GetFullPath($BasePath).TrimEnd([System.IO.Path]::DirectorySeparatorChar)
  $Resolved = [System.IO.Path]::GetFullPath($FullPath)
  $Prefix = $Base + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Resolved.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Path escapes its expected parent: $FullPath"
  }
  return $Resolved.Substring($Prefix.Length)
}

function Save-Transaction([object]$Transaction, [string]$Phase) {
  $Transaction.phase = $Phase
  if ($null -eq $Transaction.phaseTimestamps) {
    $Transaction | Add-Member -NotePropertyName phaseTimestamps -NotePropertyValue ([ordered]@{})
  }
  $Transaction.phaseTimestamps | Add-Member -NotePropertyName $Phase -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
  Write-AtomicJson $script:TransactionFullPath $Transaction
  Write-UpdaterLog "Transaction $($Transaction.id) entered $Phase."
}

function Test-App([string]$AppPath, [string]$Version) {
  $Required = @(
    'node\node.exe', 'start-portable.mjs', 'dist\client\index.html',
    'dist\server\server\index.js', 'package.json', 'BUILD-INFO.json'
  )
  foreach ($Item in $Required) {
    if (-not (Test-Path -LiteralPath (Join-Path $AppPath $Item))) { return $false }
  }
  try {
    $Build = Get-Content -LiteralPath (Join-Path $AppPath 'BUILD-INFO.json') -Raw | ConvertFrom-Json
    return $Build.appVersion -eq $Version -and $Build.releaseTag -eq "v$Version" -and $Build.updaterProtocolVersion -le $ProtocolVersion
  } catch {
    return $false
  }
}

function Get-AppInventory([string]$AppPath) {
  $Lines = @(
    Get-ChildItem -LiteralPath $AppPath -File -Recurse |
      ForEach-Object { "$(Get-ChildRelativePath $AppPath $_.FullName)|$($_.Length)" } |
      Sort-Object
  )
  $Text = $Lines -join "`n"
  $Hasher = [System.Security.Cryptography.SHA256]::Create()
  try {
    $Digest = ([System.BitConverter]::ToString($Hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '').ToLowerInvariant()
  } finally {
    $Hasher.Dispose()
  }
  return [pscustomobject]@{ Lines = $Lines; FileCount = $Lines.Count; Digest = $Digest }
}

function Invoke-Stage([object]$Transaction) {
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $Archive = Resolve-RootChild $Transaction.archivePath
  $Staging = Resolve-RootChild $Transaction.stagingPath
  $Manifest = $Transaction.manifest
  if ($Manifest.protocol.minimumUpdaterVersion -gt $ProtocolVersion) { throw 'UPDATE_PROTOCOL_UNSUPPORTED' }
  if ((Get-Item -LiteralPath $Archive).Length -ne [int64]$Manifest.asset.size) { throw 'UPDATE_DIGEST_MISMATCH' }
  $Digest = Get-FileSha256 $Archive
  if ($Digest -ne $Manifest.asset.sha256) { throw 'UPDATE_DIGEST_MISMATCH' }

  if (Test-Path -LiteralPath $Staging) { Remove-Item -LiteralPath $Staging -Recurse -Force }
  New-Item -ItemType Directory -Path $Staging -Force | Out-Null
  $Extraction = Join-Path $Staging 'payload.partial'
  New-Item -ItemType Directory -Path $Extraction -Force | Out-Null
  $ExtractionPrefix = $Extraction.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  $Total = [int64]0
  $DeclaredRoot = $Manifest.payload.rootDirectory.TrimEnd('/') + '/'
  $DeclaredAppPrefix = $DeclaredRoot + $Manifest.payload.applicationDirectory.Trim('/') + '/'
  $Zip = [System.IO.Compression.ZipFile]::OpenRead($Archive)
  try {
    foreach ($Entry in $Zip.Entries) {
      if (-not $Entry.FullName.Replace('\', '/').StartsWith($DeclaredRoot, [System.StringComparison]::Ordinal)) {
        throw 'UPDATE_ARCHIVE_UNSAFE'
      }
      $NormalizedName = $Entry.FullName.Replace('\', '/')
      $Name = $NormalizedName.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      if ([string]::IsNullOrWhiteSpace($Name) -or [System.IO.Path]::IsPathRooted($Name) -or $Name -match '^[A-Za-z]:') {
        throw 'UPDATE_ARCHIVE_UNSAFE'
      }
      $UnixMode = (($Entry.ExternalAttributes -shr 16) -band 0xF000)
      if ($UnixMode -eq 0xA000) { throw 'UPDATE_ARCHIVE_UNSAFE' }
      if (-not $NormalizedName.StartsWith($DeclaredAppPrefix, [System.StringComparison]::Ordinal)) {
        continue
      }
      $AppRelativeName = $NormalizedName.Substring($DeclaredAppPrefix.Length)
      if ([string]::IsNullOrWhiteSpace($AppRelativeName)) { continue }
      $Destination = [System.IO.Path]::GetFullPath((Join-Path $Extraction $AppRelativeName.Replace('/', [System.IO.Path]::DirectorySeparatorChar)))
      if (-not $Destination.StartsWith($ExtractionPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'UPDATE_ARCHIVE_UNSAFE'
      }
      $Total += [int64]$Entry.Length
      if ($Total -gt [int64]$Manifest.asset.unpackedSize -or $Total -gt 5368709120) { throw 'UPDATE_ARCHIVE_UNSAFE' }
      if ($NormalizedName.EndsWith('/')) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
        continue
      }
      $Parent = Split-Path -Parent $Destination
      New-Item -ItemType Directory -Path $Parent -Force | Out-Null
      if (Test-Path -LiteralPath $Destination) { throw 'UPDATE_ARCHIVE_UNSAFE' }
      $Input = $Entry.Open()
      $Output = [System.IO.File]::Open($Destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
      try { $Input.CopyTo($Output) } finally { $Output.Dispose(); $Input.Dispose() }
    }
  } finally {
    $Zip.Dispose()
  }
  if ($Total -ne [int64]$Manifest.asset.unpackedSize) { throw 'UPDATE_PAYLOAD_INVALID' }

  $SourceApp = $Extraction
  if (-not (Test-App $SourceApp $Transaction.targetVersion)) { throw 'UPDATE_PAYLOAD_INVALID' }
  $Build = Get-Content -LiteralPath (Join-Path $SourceApp 'BUILD-INFO.json') -Raw | ConvertFrom-Json
  if (
    $Build.builtAt -ne $Manifest.release.builtAt -or
    $Build.target -ne 'windows-x64-portable' -or
    $Build.sourceRepository -ne 'rizaljamhari/pbresults-scoreboard' -or
    $Build.updaterProtocolVersion -lt $Manifest.protocol.minimumUpdaterVersion
  ) { throw 'UPDATE_PAYLOAD_INVALID' }
  $Prepared = Join-Path $Staging 'prepared-app'
  Move-Item -LiteralPath $SourceApp -Destination $Prepared
  $Inventory = Get-AppInventory $Prepared
  $MarkerPath = Join-Path $Staging 'prepared-marker.json'
  Write-AtomicJson $MarkerPath ([ordered]@{
    schemaVersion = 1; transactionId = $Transaction.id; version = $Transaction.targetVersion
    fileCount = $Inventory.FileCount; inventorySha256 = $Inventory.Digest; preparedAt = [DateTime]::UtcNow.ToString('o')
  })
  $Transaction.preparedAppPath = Get-RootRelativePath $Prepared
  $Transaction.preparedMarkerPath = Get-RootRelativePath $MarkerPath
  $Transaction.stagedAt = [DateTime]::UtcNow.ToString('o')
  Save-Transaction $Transaction 'prepared'
}

function New-DataSnapshot([object]$Transaction) {
  $Data = Join-Path $Root 'data'
  $Stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
  $SafeId = ([string]$Transaction.id) -replace '[^A-Za-z0-9-]', ''
  $Name = "$Stamp-v$($Transaction.sourceVersion)-to-v$($Transaction.targetVersion)-$SafeId"
  $Partial = Join-Path $Root "backups\pre-update\$Name.partial"
  $Final = Join-Path $Root "backups\pre-update\$Name"
  New-Item -ItemType Directory -Path (Split-Path -Parent $Partial) -Force | Out-Null
  Remove-StaleSnapshotPartial $Partial
  if (Test-Path -LiteralPath $Final) {
    try {
      $Existing = Get-Content -LiteralPath (Join-Path $Final 'snapshot.json') -Raw | ConvertFrom-Json
      if ($Existing.complete -and $Existing.transactionId -eq $Transaction.id) {
        $Transaction.snapshotPath = Get-RootRelativePath $Final
        Save-Transaction $Transaction 'snapshot-created'
        return
      }
    } catch {}
    $Invalid = Join-Path $Updates "quarantine\invalid-snapshot-$SafeId-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path (Split-Path -Parent $Invalid) -Force | Out-Null
    Move-Item -LiteralPath $Final -Destination $Invalid
  }
  try {
    New-Item -ItemType Directory -Path (Join-Path $Partial 'data') -Force | Out-Null
    $Files = [System.Collections.Generic.List[object]]::new()
    $TotalBytes = [int64]0
    if (Test-Path -LiteralPath $Data) {
      foreach ($File in Get-ChildItem -LiteralPath $Data -File -Recurse) {
        $Relative = Get-ChildRelativePath $Data $File.FullName
        $Target = Join-Path (Join-Path $Partial 'data') $Relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $Target) -Force | Out-Null
        Copy-Item -LiteralPath $File.FullName -Destination $Target
        $TotalBytes += [int64]$File.Length
        $Files.Add([ordered]@{ path = $Relative; size = [int64]$File.Length; sha256 = Get-FileSha256 $Target })
      }
    }
    $Snapshot = [ordered]@{
      schemaVersion = 1; transactionId = $Transaction.id; sourceVersion = $Transaction.sourceVersion
      targetVersion = $Transaction.targetVersion; createdAt = [DateTime]::UtcNow.ToString('o')
      fileCount = $Files.Count; totalBytes = $TotalBytes; files = $Files; complete = $true
    }
    Write-AtomicJson (Join-Path $Partial 'snapshot.json') $Snapshot
    Move-Item -LiteralPath $Partial -Destination $Final
    $Transaction.snapshotPath = Get-RootRelativePath $Final
    Save-Transaction $Transaction 'snapshot-created'
  } catch {
    $SnapshotError = $_.Exception.Message
    Remove-StaleSnapshotPartial $Partial
    Write-UpdaterLog "Snapshot creation failed for transaction $($Transaction.id): $SnapshotError"
    throw "UPDATE_SNAPSHOT_FAILED: $SnapshotError"
  }
}

function Start-And-WaitForHealth([object]$Transaction, [string]$Version, [string]$Tag) {
  $Launcher = Join-Path $Root 'portable-launcher.ps1'
  $PreviousRecoveryFlag = $env:APP_UPDATER_RECOVERY
  $env:APP_UPDATER_RECOVERY = '1'
  try {
    $Process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$Launcher`"",'-Port',[string]$Transaction.port,'-NoBrowser') -PassThru
  } finally {
    $env:APP_UPDATER_RECOVERY = $PreviousRecoveryFlag
  }
  $Transaction.newLauncherPid = $Process.Id
  Save-Transaction $Transaction 'new-process-started'
  $Deadline = [DateTime]::UtcNow.AddSeconds(60)
  while ([DateTime]::UtcNow -lt $Deadline) {
    Start-Sleep -Milliseconds 750
    try {
      $Health = Invoke-RestMethod -Uri "http://127.0.0.1:$($Transaction.port)/api/health" -TimeoutSec 3
      if ($Health.ready -and $Health.appVersion -eq $Version -and $Health.releaseTag -eq $Tag) { return $true }
    } catch {}
    if ($Process.HasExited) { return $false }
  }
  return $false
}

function Stop-NewProcess([object]$Transaction) {
  if (-not $Transaction.newLauncherPid) { return }
  try {
    & taskkill.exe /PID ([string]$Transaction.newLauncherPid) /T /F 2>$null | Out-Null
  } catch {
    Write-UpdaterLog "Unable to stop process tree $($Transaction.newLauncherPid); it may already have exited."
  }
}

function Restore-Snapshot([object]$Transaction) {
  $Snapshot = Resolve-RootChild $Transaction.snapshotPath
  $SnapshotData = Join-Path $Snapshot 'data'
  $Data = Join-Path $Root 'data'
  $Quarantine = Join-Path $Updates "quarantine\failed-data-$($Transaction.id)"
  New-Item -ItemType Directory -Path (Split-Path -Parent $Quarantine) -Force | Out-Null
  if (Test-Path -LiteralPath $Data) { Move-Item -LiteralPath $Data -Destination $Quarantine }
  Copy-Item -LiteralPath $SnapshotData -Destination $Data -Recurse
}

function Remove-CompletedArtifacts([object]$Transaction) {
  foreach ($Candidate in @($Transaction.archivePath, $Transaction.stagingPath)) {
    if (-not $Candidate) { continue }
    try {
      $Resolved = Resolve-RootChild $Candidate
      if (Test-Path -LiteralPath $Resolved) {
        Remove-Item -LiteralPath $Resolved -Recurse -Force
        Write-UpdaterLog "Removed completed update artifact $Resolved."
      }
    } catch {
      Write-UpdaterLog "Deferred cleanup for ${Candidate}: $($_.Exception.Message)"
    }
  }
}

function Invoke-Install([object]$Transaction) {
  $Deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ($Transaction.serverPid -and (Get-Process -Id $Transaction.serverPid -ErrorAction SilentlyContinue)) {
    if ([DateTime]::UtcNow -ge $Deadline) { throw 'UPDATE_SHUTDOWN_TIMEOUT' }
    Start-Sleep -Milliseconds 250
  }
  Save-Transaction $Transaction 'old-process-stopped'
  New-DataSnapshot $Transaction

  $Prepared = Resolve-RootChild $Transaction.preparedAppPath
  $PreparedMarker = Resolve-RootChild $Transaction.preparedMarkerPath
  if (-not (Test-Path -LiteralPath $PreparedMarker -PathType Leaf)) { throw 'UPDATE_PAYLOAD_INVALID' }
  $Marker = Get-Content -LiteralPath $PreparedMarker -Raw | ConvertFrom-Json
  if (-not (Test-App $Prepared $Transaction.targetVersion)) { throw 'UPDATE_PAYLOAD_INVALID' }
  $Versions = Join-Path $Root 'versions'
  New-Item -ItemType Directory -Path $Versions -Force | Out-Null
  $Target = Join-Path $Versions "v$($Transaction.targetVersion)"
  if (Test-Path -LiteralPath $Target) {
    $ExistingInventory = Get-AppInventory $Target
    if (-not (Test-App $Target $Transaction.targetVersion) -or $ExistingInventory.Digest -ne $Marker.inventorySha256) {
      $Quarantine = Join-Path $Updates "quarantine\invalid-v$($Transaction.targetVersion)-$($Transaction.id)"
      New-Item -ItemType Directory -Path (Split-Path -Parent $Quarantine) -Force | Out-Null
      Move-Item -LiteralPath $Target -Destination $Quarantine
      throw 'UPDATE_ACTIVATION_FAILED'
    }
    Remove-Item -LiteralPath $Prepared -Recurse -Force
    Write-UpdaterLog "Reused identical prepared application at $Target."
  } else {
    Move-Item -LiteralPath $Prepared -Destination $Target
  }
  $Transaction.targetAppPath = Get-RootRelativePath $Target
  Save-Transaction $Transaction 'payload-finalized'

  $OldPointer = Get-Content -LiteralPath $PointerPath -Raw | ConvertFrom-Json
  $NewPointer = [ordered]@{
    schemaVersion = 1; generation = [int]$OldPointer.generation + 1
    active = [ordered]@{ version = $Transaction.targetVersion; releaseTag = "v$($Transaction.targetVersion)"; relativePath = $Transaction.targetAppPath }
    previous = $OldPointer.active; updatedAt = [DateTime]::UtcNow.ToString('o')
  }
  Write-AtomicJson $PointerPath $NewPointer
  Save-Transaction $Transaction 'pointer-activated'
  if (Start-And-WaitForHealth $Transaction $Transaction.targetVersion "v$($Transaction.targetVersion)") {
    Save-Transaction $Transaction 'health-confirmed'
    $Transaction.outcome = 'succeeded'
    $Transaction.completedAt = [DateTime]::UtcNow.ToString('o')
    Save-Transaction $Transaction 'committed'
    Remove-CompletedArtifacts $Transaction
    return
  }

  Stop-NewProcess $Transaction
  Save-Transaction $Transaction 'rollback-started'
  Write-AtomicJson $PointerPath ([ordered]@{
    schemaVersion = 1; generation = [int]$NewPointer.generation + 1; active = $NewPointer.previous; previous = $NewPointer.active; updatedAt = [DateTime]::UtcNow.ToString('o')
  })
  Restore-Snapshot $Transaction
  if (Start-And-WaitForHealth $Transaction $Transaction.sourceVersion $Transaction.sourceReleaseTag) {
    $Transaction.outcome = 'rolled-back'; $Transaction.completedAt = [DateTime]::UtcNow.ToString('o')
    Save-Transaction $Transaction 'rollback-completed'
    return
  }
  throw 'UPDATE_ROLLBACK_FAILED'
}

function Wait-ForOldServer([object]$Transaction) {
  $Deadline = [DateTime]::UtcNow.AddSeconds(20)
  while ($Transaction.serverPid -and (Get-Process -Id $Transaction.serverPid -ErrorAction SilentlyContinue)) {
    if ([DateTime]::UtcNow -ge $Deadline) { throw 'UPDATE_SHUTDOWN_TIMEOUT' }
    Start-Sleep -Milliseconds 250
  }
  Save-Transaction $Transaction 'old-process-stopped'
}

function Invoke-ManualRollback([object]$Transaction) {
  Wait-ForOldServer $Transaction
  New-DataSnapshot $Transaction
  $Pointer = Get-Content -LiteralPath $PointerPath -Raw | ConvertFrom-Json
  if ($null -eq $Pointer.previous) { throw 'UPDATE_ROLLBACK_FAILED' }
  $PreviousPath = Resolve-RootChild $Pointer.previous.relativePath
  if (-not (Test-App $PreviousPath $Pointer.previous.version)) { throw 'UPDATE_ROLLBACK_FAILED' }
  $Swapped = [ordered]@{
    schemaVersion = 1; generation = [int]$Pointer.generation + 1
    active = $Pointer.previous; previous = $Pointer.active; updatedAt = [DateTime]::UtcNow.ToString('o')
  }
  Write-AtomicJson $PointerPath $Swapped
  Save-Transaction $Transaction 'pointer-activated'
  if (Start-And-WaitForHealth $Transaction $Swapped.active.version $Swapped.active.releaseTag) {
    Save-Transaction $Transaction 'health-confirmed'
    $Transaction.outcome = 'succeeded'; $Transaction.completedAt = [DateTime]::UtcNow.ToString('o')
    Save-Transaction $Transaction 'committed'
    Remove-CompletedArtifacts $Transaction
    return
  }
  Stop-NewProcess $Transaction
  Save-Transaction $Transaction 'rollback-started'
  Write-AtomicJson $PointerPath $Pointer
  Restore-Snapshot $Transaction
  if (Start-And-WaitForHealth $Transaction $Pointer.active.version $Pointer.active.releaseTag) {
    $Transaction.outcome = 'rolled-back'; $Transaction.completedAt = [DateTime]::UtcNow.ToString('o')
    Save-Transaction $Transaction 'rollback-completed'
    return
  }
  throw 'UPDATE_ROLLBACK_FAILED'
}

function Invoke-Recovery([object]$Transaction) {
  if ($Transaction.recoveryAttempted) {
    throw 'UPDATE_ROLLBACK_FAILED'
  }
  $Transaction.recoveryAttempted = $true
  Write-AtomicJson $script:TransactionFullPath $Transaction

  if (@('prepared', 'staging', 'shutdown-requested', 'install-coordinator-started', 'rollback-coordinator-started', 'old-process-stopped', 'snapshot-created', 'payload-finalized') -contains $Transaction.phase) {
    $Transaction.errorCode = 'UPDATE_ACTIVATION_FAILED'
    $Transaction.errorMessage = "Update interrupted during $($Transaction.phase); the previous version remains active."
    $Transaction.outcome = 'failed'
    $Transaction.completedAt = [DateTime]::UtcNow.ToString('o')
    Save-Transaction $Transaction 'failed'
    return
  }
  if ($Transaction.phase -eq 'health-confirmed') {
    $Transaction.outcome = 'succeeded'
    $Transaction.completedAt = [DateTime]::UtcNow.ToString('o')
    Save-Transaction $Transaction 'committed'
    Remove-CompletedArtifacts $Transaction
    return
  }

  $Pointer = Get-Content -LiteralPath $PointerPath -Raw | ConvertFrom-Json
  if ($Transaction.phase -eq 'rollback-started') {
    if ($Pointer.active.version -ne $Transaction.sourceVersion -and $Pointer.previous.version -eq $Transaction.sourceVersion) {
      $Pointer = [ordered]@{
        schemaVersion = 1; generation = [int]$Pointer.generation + 1
        active = $Pointer.previous; previous = $Pointer.active; updatedAt = [DateTime]::UtcNow.ToString('o')
      }
      Write-AtomicJson $PointerPath $Pointer
    }
    if ($Transaction.snapshotPath) { Restore-Snapshot $Transaction }
    if (Start-And-WaitForHealth $Transaction $Transaction.sourceVersion $Transaction.sourceReleaseTag) {
      $Transaction.outcome = 'rolled-back'; $Transaction.completedAt = [DateTime]::UtcNow.ToString('o')
      Save-Transaction $Transaction 'rollback-completed'
      return
    }
    throw 'UPDATE_ROLLBACK_FAILED'
  }

  if (@('pointer-activated', 'new-process-started') -contains $Transaction.phase) {
    if (Start-And-WaitForHealth $Transaction $Transaction.targetVersion "v$($Transaction.targetVersion)") {
      Save-Transaction $Transaction 'health-confirmed'
      $Transaction.outcome = 'succeeded'; $Transaction.completedAt = [DateTime]::UtcNow.ToString('o')
      Save-Transaction $Transaction 'committed'
      Remove-CompletedArtifacts $Transaction
      return
    }
    Stop-NewProcess $Transaction
    Save-Transaction $Transaction 'rollback-started'
    $Pointer = Get-Content -LiteralPath $PointerPath -Raw | ConvertFrom-Json
    if ($Pointer.previous.version -ne $Transaction.sourceVersion) { throw 'UPDATE_ROLLBACK_FAILED' }
    Write-AtomicJson $PointerPath ([ordered]@{
      schemaVersion = 1; generation = [int]$Pointer.generation + 1
      active = $Pointer.previous; previous = $Pointer.active; updatedAt = [DateTime]::UtcNow.ToString('o')
    })
    Restore-Snapshot $Transaction
    if (Start-And-WaitForHealth $Transaction $Transaction.sourceVersion $Transaction.sourceReleaseTag) {
      $Transaction.outcome = 'rolled-back'; $Transaction.completedAt = [DateTime]::UtcNow.ToString('o')
      Save-Transaction $Transaction 'rollback-completed'
      return
    }
    throw 'UPDATE_ROLLBACK_FAILED'
  }
  throw 'UPDATE_ACTIVATION_FAILED'
}

try {
  $script:TransactionFullPath = Resolve-RootChild $TransactionPath
  $LockStream = [System.IO.File]::Open($LockPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $Transaction = Get-Content -LiteralPath $script:TransactionFullPath -Raw | ConvertFrom-Json
  Write-UpdaterLog "Starting transaction $($Transaction.id), protocol $ProtocolVersion."
  if ($Mode -eq 'Stage') { Invoke-Stage $Transaction }
  elseif ($Mode -eq 'Install') {
    Save-Transaction $Transaction 'install-coordinator-started'
    Invoke-Install $Transaction
  }
  elseif ($Mode -eq 'Rollback') {
    Save-Transaction $Transaction 'rollback-coordinator-started'
    Invoke-ManualRollback $Transaction
  }
  else { Invoke-Recovery $Transaction }
} catch {
  $FailureMessage = $_.Exception.Message
  $FailureCode = if ($FailureMessage -match '^(UPDATE_[A-Z_]+)') { $Matches[1] } else { 'UPDATE_ACTIVATION_FAILED' }
  Write-UpdaterLog "Transaction failed: $FailureMessage"
  if ($null -ne $Transaction) {
    $Transaction.errorCode = $FailureCode
    $Transaction.errorMessage = $FailureMessage
    $RetryPrepared = $Mode -eq 'Install' -and @('UPDATE_SHUTDOWN_TIMEOUT', 'UPDATE_SNAPSHOT_FAILED') -contains $FailureCode
    if ($FailureCode -eq 'UPDATE_SNAPSHOT_FAILED') {
      try {
        $Pointer = Get-Content -LiteralPath $PointerPath -Raw | ConvertFrom-Json
        if (Start-And-WaitForHealth $Transaction $Pointer.active.version $Pointer.active.releaseTag) {
          Write-UpdaterLog "Restarted $($Pointer.active.releaseTag) after the snapshot failure."
        } else {
          Write-UpdaterLog "Unable to restart $($Pointer.active.releaseTag) after the snapshot failure."
          $RetryPrepared = $false
        }
      } catch {
        Write-UpdaterLog "Unable to restart the current version after the snapshot failure: $($_.Exception.Message)"
        $RetryPrepared = $false
      }
      $Transaction.errorCode = $FailureCode
      $Transaction.errorMessage = $FailureMessage
    }
    if ($RetryPrepared) {
      $Transaction.outcome = $null
      $Transaction.completedAt = $null
      try { Save-Transaction $Transaction 'prepared' } catch {}
    } else {
      $Transaction.outcome = 'failed'
      $Transaction.completedAt = [DateTime]::UtcNow.ToString('o')
      try { Save-Transaction $Transaction 'failed' } catch {}
    }
  }
  exit 1
} finally {
  if ($null -ne $LockStream) { $LockStream.Dispose() }
  Remove-Item -LiteralPath $LockPath -Force -ErrorAction SilentlyContinue
}
