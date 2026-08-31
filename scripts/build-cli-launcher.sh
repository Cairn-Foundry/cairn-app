#!/usr/bin/env bash
set -euo pipefail

# Builds the `cairn-cli` launcher and stages it where Tauri's externalBin
# expects it: src-tauri/binaries/cairn-cli-<target-triple>.
# Pass one or more target triples to cross-compile; defaults to the host.

cd "$(dirname "$0")/.."

TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=("$(rustc -vV | awk '/^host:/ {print $2}')")
fi

mkdir -p src-tauri/binaries

for TRIPLE in "${TARGETS[@]}"; do
  cargo build --manifest-path src-tauri/cli/Cargo.toml --bin cairn-cli --release --target "$TRIPLE"
  EXT=""
  case "$TRIPLE" in *windows*) EXT=".exe" ;; esac
  cp "src-tauri/target/${TRIPLE}/release/cairn-cli${EXT}" "src-tauri/binaries/cairn-cli-${TRIPLE}${EXT}"
  chmod +x "src-tauri/binaries/cairn-cli-${TRIPLE}${EXT}"
  echo "staged src-tauri/binaries/cairn-cli-${TRIPLE}${EXT}"
done
