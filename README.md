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

```bash
bun run tauri build
```
