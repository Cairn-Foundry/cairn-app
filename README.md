# Cairn

An AI-augmented IDE built with Tauri, SvelteKit, and TypeScript.

## Prerequisites

### All platforms
- [Rust](https://rustup.rs/)
- [Bun](https://bun.sh/)

### Linux (Ubuntu / Debian)

Install the C toolchain, `pkg-config`, and the GTK/WebKit libraries required by Tauri:

```bash
sudo apt install build-essential pkg-config \
  libglib2.0-dev libgtk-3-dev \
  libwebkit2gtk-4.1-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev librsvg2-dev \
  libssl-dev libayatana-appindicator3-dev
```

## Development

```bash
bun install
bun run tauri dev
```

## Build

Building a Tauri app produces native installers for the host platform. Cross-compiling
is not supported out of the box: build each target on its matching operating system
(or CI runner).

### Linux

```bash
bun run tauri build
```

Produces a `.deb`, `.rpm`, and an AppImage under `src-tauri/target/release/bundle/`.

### Windows

Run from Windows with the MSVC toolchain and WebView2 installed:

```bash
bun run tauri build
```

Produces an `.msi` (WiX) and an `.exe` (NSIS) installer under
`src-tauri\target\release\bundle\`.

### macOS

```bash
# Intel
bun run tauri build --target x86_64-apple-darwin

# Apple Silicon
bun run tauri build --target aarch64-apple-darwin

# Universal binary (both architectures)
bun run tauri build --target universal-apple-darwin
```

Produces a `.app` and a `.dmg` under `src-tauri/target/release/bundle/`.
