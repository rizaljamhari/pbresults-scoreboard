#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

has_command() {
  command -v "$1" >/dev/null 2>&1
}

if has_command fnm; then
  # shellcheck disable=SC2046
  eval "$(fnm env --use-on-cd)"
  fnm use 22 >/dev/null
fi

if ! has_command pnpm; then
  if has_command corepack; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@10.16.1 --activate >/dev/null 2>&1 || true
  fi
fi

if ! has_command pnpm; then
  echo "[run] pnpm is not available. Run ./setup.command first." >&2
  exit 1
fi

cd "${PROJECT_DIR}"

if [[ ! -d node_modules ]]; then
  echo "[run] Dependencies are missing. Running setup first."
  "${PROJECT_DIR}/scripts/setup.sh"
fi

APP_OPEN_BROWSER=1 pnpm dev
