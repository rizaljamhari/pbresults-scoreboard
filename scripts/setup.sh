#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR_REQUIRED=22
PNPM_VERSION=10.16.1

log() {
  printf '\n[setup] %s\n' "$1"
}

fail() {
  printf '\n[setup] ERROR: %s\n' "$1" >&2
  exit 1
}

has_command() {
  command -v "$1" >/dev/null 2>&1
}

ensure_fnm_in_shell() {
  if has_command fnm; then
    # shellcheck disable=SC2046
    eval "$(fnm env --use-on-cd)"
  fi
}

install_fnm_with_brew() {
  if ! has_command brew; then
    fail "Node.js 22 is required. Install Homebrew or fnm first, then rerun setup."
  fi

  log "Installing fnm with Homebrew"
  brew install fnm
  ensure_fnm_in_shell
}

ensure_node22() {
  ensure_fnm_in_shell

  if has_command node; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "$major" == "$NODE_MAJOR_REQUIRED" ]]; then
      log "Using existing Node $(node -v)"
      return
    fi
  fi

  if ! has_command fnm; then
    install_fnm_with_brew
  fi

  ensure_fnm_in_shell
  log "Installing and activating Node ${NODE_MAJOR_REQUIRED}"
  fnm install "${NODE_MAJOR_REQUIRED}"
  fnm use "${NODE_MAJOR_REQUIRED}"
  log "Using Node $(node -v)"
}

ensure_pnpm() {
  if ! has_command corepack; then
    fail "corepack is not available even though Node is installed. Please reinstall Node 22."
  fi

  log "Activating pnpm ${PNPM_VERSION}"
  corepack enable
  corepack prepare "pnpm@${PNPM_VERSION}" --activate
  pnpm --version
}

prepare_directories() {
  log "Preparing local data folders"
  mkdir -p "${PROJECT_DIR}/data/uploads"
}

install_and_build() {
  cd "${PROJECT_DIR}"
  log "Installing dependencies"
  pnpm install

  log "Building the application"
  pnpm build
}

print_next_steps() {
  cat <<EOF

[setup] Setup complete.

Next:
  1. Run ./run.command on macOS, or:
  2. Run:
       eval "\$(fnm env --use-on-cd)"
       fnm use ${NODE_MAJOR_REQUIRED}
       pnpm dev

Admin UI:
  the dev launcher will print the selected admin URL

Live overlay:
  use the same printed client port, for example:
  http://localhost:5173/overlay/live
EOF
}

main() {
  log "Starting one-click setup"
  ensure_node22
  ensure_pnpm
  prepare_directories
  install_and_build
  print_next_steps
}

main "$@"
