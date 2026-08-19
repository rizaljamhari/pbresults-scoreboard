[CmdletBinding()]
# PBRESULTS_COORDINATOR_VERSION: 2
param(
  [int]$Port = 3000,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProtocolVersion = 1
$RequireRequestedPort = $PSBoundParameters.ContainsKey('Port')
$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$PointerPath = Join-Path $Root 'current-version.json'
$LogDir = Join-Path $Root 'logs'
$LogPath = Join-Path $LogDir 'updater.log'

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Write-UpdaterLog([string]$Message) {
  Add-Content -LiteralPath $LogPath -Value "$([DateTime]::UtcNow.ToString('o')) [launcher] $Message"
}

function Resolve-RootChild([string]$RelativePath) {
  if ([string]::IsNullOrWhiteSpace($RelativePath) -or [System.IO.Path]::IsPathRooted($RelativePath)) {
    throw 'Application pointer contains an invalid path.'
  }
  $Resolved = [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
  $Prefix = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $Resolved.StartsWith($Prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Application pointer escapes the portable root.'
  }
  return $Resolved
}

function Test-Application([string]$ApplicationPath) {
  return (
    (Test-Path -LiteralPath (Join-Path $ApplicationPath 'node\node.exe') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $ApplicationPath 'start-portable.mjs') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $ApplicationPath 'dist\server\server\index.js') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $ApplicationPath 'dist\client\index.html') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $ApplicationPath 'BUILD-INFO.json') -PathType Leaf)
  )
}

if ($env:APP_UPDATER_RECOVERY -ne '1') {
  $TransactionDir = Join-Path $Root 'updates\transactions'
  if (Test-Path -LiteralPath $TransactionDir -PathType Container) {
    $TerminalPhases = @('committed', 'rollback-completed', 'failed')
    $LatestTransactionFile = Get-ChildItem -LiteralPath $TransactionDir -Filter '*.json' -File |
      Sort-Object LastWriteTimeUtc -Descending |
      Select-Object -First 1
    if ($null -ne $LatestTransactionFile) {
      try {
        $PendingTransaction = Get-Content -LiteralPath $LatestTransactionFile.FullName -Raw | ConvertFrom-Json
        if ($TerminalPhases -notcontains $PendingTransaction.phase) {
          $RecoveryStartsApplication = @('pointer-activated', 'new-process-started', 'rollback-started') -contains $PendingTransaction.phase
          $Updater = Join-Path $Root 'portable-updater.ps1'
          Write-UpdaterLog "Recovering interrupted transaction $($PendingTransaction.id) from phase $($PendingTransaction.phase)."
          & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Updater -Mode Recover -TransactionPath $LatestTransactionFile.FullName
          if ($RecoveryStartsApplication) { exit $LASTEXITCODE }
        }
      } catch {
        Write-UpdaterLog "Unable to inspect interrupted transaction: $($_.Exception.Message)"
      }
    }
  }
}

if (-not (Test-Path -LiteralPath $PointerPath -PathType Leaf)) {
  throw "Missing active version pointer: $PointerPath"
}

$Pointer = Get-Content -LiteralPath $PointerPath -Raw | ConvertFrom-Json
$Selected = $Pointer.active
$AppPath = Resolve-RootChild $Selected.relativePath
if (-not (Test-Application $AppPath)) {
  if ($null -eq $Pointer.previous) {
    throw "Active application is invalid and no previous version is available: $AppPath"
  }
  $Selected = $Pointer.previous
  $AppPath = Resolve-RootChild $Selected.relativePath
  if (-not (Test-Application $AppPath)) {
    throw 'Neither active nor previous application is structurally valid.'
  }
  Write-UpdaterLog "Falling back to previous application $($Selected.releaseTag)."
}

$env:APP_ROOT_DIR = $Root
$env:APP_SERVER_PORT = [string]$Port
$env:APP_REQUIRE_PORT = if ($RequireRequestedPort) { '1' } else { '0' }
$env:APP_OPEN_BROWSER = if ($NoBrowser) { '0' } else { '1' }
$env:APP_ACTIVE_DIR = $AppPath
$env:APP_BUILD_INFO_PATH = Join-Path $AppPath 'BUILD-INFO.json'
$env:APP_UPDATER_PROTOCOL_VERSION = [string]$ProtocolVersion

$Node = Join-Path $AppPath 'node\node.exe'
$Launcher = Join-Path $AppPath 'start-portable.mjs'
Write-UpdaterLog "Starting $($Selected.releaseTag) from $AppPath on port $Port."
& $Node $Launcher
exit $LASTEXITCODE
