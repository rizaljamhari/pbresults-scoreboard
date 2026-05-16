#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${PROJECT_DIR}"
"${PROJECT_DIR}/scripts/setup.sh"

echo
read -r -p "Press Enter to close this window..."
