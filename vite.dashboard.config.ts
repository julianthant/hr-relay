/**
 * Vite wiring for the rebuild dashboard (1i-spine, doc 13 §2).
 *
 * Mirrors the legacy repo's `vite.dashboard.config.ts` shape (legacy commit
 * 793abe1f8265f3213ffe8a80d6cfd9860a32a1dc) with the rebuild's own isolation
 * values from `config/runtime-isolation.json`: frontend port 5174, backend
 * 3938. `vite-plugin-singlefile` is deliberately not mirrored — the rebuild
 * serves a normal multi-asset build. The dev server and `vite preview` proxy
 * `/api` and `/events` to the rebuild BFF so the ONE typed client can stay on
 * a same-origin base URL.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

const BACKEND = "http://127.0.0.1:3938";

export default defineConfig({
  root: "src/dashboard",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/dashboard"),
    },
  },
  build: {
    outDir: "../../dist/dashboard",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": BACKEND,
      "/events": BACKEND,
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
});
