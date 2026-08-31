#!/usr/bin/env bash
set -euo pipefail

# Builds the `cairn-cli` launcher and stages it where Tauri's externalBin
# expects it: src-tauri/binaries/cairn-cli-<target-triple>.
# Pass one or more target triples to cross-compile; defaults to the host.
# `universal-apple-darwin` builds both Apple arches and lipos them together,
# because that is the single fat binary Tauri looks for under that name.

cd "$(dirname "$0")/.."

TARGETS=("$@")
if [ ${#TARGETS[@]} -eq 0 ]; then
  TARGETS=("$(rustc -vV | awk '/^host:/ {print $2}')")
fi

mkdir -p src-tauri/binaries

build_one() {
  cargo build --manifest-path src-tauri/cli/Cargo.toml --bin cairn-cli --release --target "$1"
}

for TRIPLE in "${TARGETS[@]}"; do
  if [ "$TRIPLE" = "universal-apple-darwin" ]; then
    # Tauri compiles each arch separately before lipoing the app, and each
    # per-arch pass resolves externalBin against its own triple - so the
    # per-arch binaries must be staged alongside the fat one.
    for ARCH in aarch64-apple-darwin x86_64-apple-darwin; do
      build_one "$ARCH"
      cp "src-tauri/target/${ARCH}/release/cairn-cli" "src-tauri/binaries/cairn-cli-${ARCH}"
      chmod +x "src-tauri/binaries/cairn-cli-${ARCH}"
    done
    lipo -create \
      "src-tauri/target/aarch64-apple-darwin/release/cairn-cli" \
      "src-tauri/target/x86_64-apple-darwin/release/cairn-cli" \
      -output "src-tauri/binaries/cairn-cli-${TRIPLE}"
  else
    build_one "$TRIPLE"
    EXT=""
    case "$TRIPLE" in *windows*) EXT=".exe" ;; esac
    cp "src-tauri/target/${TRIPLE}/release/cairn-cli${EXT}" "src-tauri/binaries/cairn-cli-${TRIPLE}${EXT}"
  fi
  EXT=""
  case "$TRIPLE" in *windows*) EXT=".exe" ;; esac
  chmod +x "src-tauri/binaries/cairn-cli-${TRIPLE}${EXT}"
  echo "staged src-tauri/binaries/cairn-cli-${TRIPLE}${EXT}"
done
