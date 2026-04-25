#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
export PATH="$HOME/.cargo/bin:$PATH"

npx tauri build --no-bundle

exec ./src-tauri/target/release/whats "$@"
