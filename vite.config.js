import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { readFileSync } from "node:fs";
const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));

const vitestConfig = {
  include: ["src/**/*.{test,spec}.{js,ts}"],
  environment: "jsdom",
  setupFiles: ["src/test/setup.ts"],
  coverage: {
    provider: "istanbul",
    reporter: ["text", "cobertura"],
    all: true,
    include: ["src/lib/**/*.ts"],
    exclude: [
      "src/lib/**/*.test.ts",
      "src/lib/**/*.d.ts",
      "src/lib/utils/git/diff-highlight.worker.ts",
    ],
  },
};

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: vitestConfig,

  optimizeDeps: {
    include: ["@codemirror/language-data", "@codemirror/language-data > *"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
