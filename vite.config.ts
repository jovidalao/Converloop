import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Don't run the vendored design-reference checkouts' test suites
  // (cherry-studio-main, craft-agents-oss-main — the latter uses bun:test).
  test: {
    exclude: [
      ...configDefaults.exclude,
      "cherry-studio-main/**",
      "craft-agents-oss-main/**",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    headers: {
      // Mirror of app.security.csp in src-tauri/tauri.conf.json — Tauri only
      // injects that CSP into production (tauri://) pages, so the dev server
      // must send it itself for dev parity. Dev-only differences: ws: source
      // for Vite HMR (WebKit doesn't match ws: under 'self'), script-src
      // 'unsafe-inline' for the react-refresh preamble (in production Tauri
      // allows inline scripts in bundled HTML via generated hashes), and
      // worker-src blob: for the HMR client's ping worker.
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; worker-src blob:; connect-src 'self' ws://localhost:1420 ipc: http://ipc.localhost",
    },
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
