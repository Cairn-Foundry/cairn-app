#!/usr/bin/env bash
# Copyright (C) 2026 Benjamin Bonneton and the Cairn Foundry contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Removes the libraries an AppImage has no business imposing on its children,
# then repacks and re-signs it.
#
# An AppImage exports its own lib directory through LD_LIBRARY_PATH, and every
# process the app launches inherits it: git, the coding CLIs, the dev servers a
# terminal starts. A bundled library that is older than the host's copy of what
# links against it therefore breaks tools that were working fine outside Cairn -
# libnghttp2 against the host libcurl being the case that surfaced:
#
#   /usr/lib/git-core/git-remote-https: symbol lookup error:
#   /lib/x86_64-linux-gnu/libcurl-gnutls.so.4: undefined symbol:
#   nghttp2_option_set_no_rfc9113_leading_and_trailing_ws_validation
#
# Cairn does not link these itself: they arrive as transitive dependencies that
# linuxdeploy pulled in. Dropping them leaves the host's own copy to answer,
# which is the one its libcurl was built against.

set -euo pipefail

BUNDLE_DIR=${1:?usage: strip-appimage-libs.sh <appimage bundle dir>}

# Every library removed must be one the app itself does not link, or the bundle
# stops starting on a host that lacks it.
STRIP_LIBS=(libnghttp2.so.14)

shopt -s nullglob
images=("$BUNDLE_DIR"/*.AppImage)
shopt -u nullglob

if [ ${#images[@]} -eq 0 ]; then
  echo "No AppImage in $BUNDLE_DIR" >&2
  exit 1
fi

for image in "${images[@]}"; do
  work=$(mktemp -d)
  chmod +x "$image"

  # --appimage-extract writes squashfs-root into the current directory, so the
  # extraction runs in a scratch directory of its own.
  (cd "$work" && "$image" --appimage-extract >/dev/null)

  removed=0
  for lib in "${STRIP_LIBS[@]}"; do
    while IFS= read -r found; do
      rm -f "$found"
      removed=1
      echo "Removed $(basename "$image"): ${found#"$work"/squashfs-root/}"
    done < <(find "$work/squashfs-root" -name "$lib*" -type f)
  done

  if [ "$removed" -eq 0 ]; then
    echo "$(basename "$image"): nothing to strip, left as built"
    rm -rf "$work"
    continue
  fi

  # appimagetool is what the Tauri bundler itself used, and linuxdeploy left it
  # in the build cache; falling back to a download keeps the step working if the
  # bundler ever stops caching it.
  tool=$(find "$HOME/.cache/tauri" -name 'appimagetool*.AppImage' -type f 2>/dev/null | head -n 1 || true)
  if [ -z "$tool" ]; then
    arch=$(uname -m)
    tool="$work/appimagetool"
    curl -fsSL -o "$tool" \
      "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-${arch}.AppImage"
  fi
  chmod +x "$tool"

  ARCH=$(uname -m) "$tool" --no-appstream "$work/squashfs-root" "$image" >/dev/null

  # The bundle changed, so the signature the bundler produced no longer matches
  # it. The updater checks that signature, so it is regenerated here.
  rm -f "$image.sig"
  bunx tauri signer sign "$image" >/dev/null

  rm -rf "$work"
done
