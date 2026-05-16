$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

if (-not (Test-Path "$ProjectDir\node_modules")) {
  Write-Host "[run] Dependencies are missing. Running setup first."
  & "$ProjectDir\setup.ps1"
}

$env:APP_OPEN_BROWSER = "1"
pnpm dev
