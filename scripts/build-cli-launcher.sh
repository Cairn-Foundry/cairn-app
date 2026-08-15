#!/usr/bin/env bash
set -euo pipefail

# Builds the `cairn-cli` launcher and stages it where Tauri's externalBin
# expects it: src-tauri/binaries/cairn-cli-<target-triple>.

cd "$(dirname "$0")/.."

TRIPLE="$(rustc -vV | awk '/^host:/ {print $2}')"

cargo build --manifest-path src-tauri/cli/Cargo.toml --bin cairn-cli --release

mkdir -p src-tauri/binaries
cp "src-tauri/target/release/cairn-cli" "src-tauri/binaries/cairn-cli-${TRIPLE}"
chmod +x "src-tauri/binaries/cairn-cli-${TRIPLE}"
echo "staged src-tauri/binaries/cairn-cli-${TRIPLE}"
