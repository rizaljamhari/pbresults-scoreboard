$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. Install Node.js 22 and rerun setup."
  }
}

Write-Host "[setup] Starting Windows setup"
Require-Command "node"
Require-Command "corepack"

$nodeMajor = node -p "process.versions.node.split('.')[0]"
if ($nodeMajor -ne "22") {
  throw "Node.js 22 is required. Current version: $(node -v)"
}

corepack enable
corepack prepare pnpm@10.16.1 --activate

New-Item -ItemType Directory -Force -Path "$ProjectDir\data\uploads" | Out-Null

pnpm install
pnpm build

Write-Host ""
Write-Host "[setup] Setup complete."
Write-Host "Run .\run.bat to start the app."
