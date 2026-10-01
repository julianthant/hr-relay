/**
 * Vite wiring for the rebuild dashboard (1i-spine, ref frontend-backend-integration §2).
 *
 * Mirrors the legacy repo's `vite.dashboard.config.ts` shape (legacy commit
 * 793abe1f8265f3213ffe8a80d6cfd9860a32a1dc) with the rebuild's own isolation
 * values from `config/runtime-isolation.json`: frontend port 5174, backend
 * 3938. `vite-plugin-singlefile` is deliberately not mirrored — the rebuild
 * serves a normal multi-asset build. The dev server proxies `/api`, `/events`
 * and `/artifacts` to the rebuild BFF so the ONE typed client and its verified
 * byte routes can stay on a same-origin base URL.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { writeDashboardBuildIdentity } from "./src/backend/app/dashboard/build-identity.js";
import {
  DASHBOARD_FRONTEND_OWNER_PATH,
  DASHBOARD_LAUNCH_NONCE_ENV,
  DashboardLaunchNonceSchema,
} from "./src/backend/transports/dashboard/frontend-owner.js";

const BACKEND = "http://127.0.0.1:3938";
const ownerNonceInput = process.env[DASHBOARD_LAUNCH_NONCE_ENV];
const ownerNonce = ownerNonceInput === undefined
  ? undefined
  : DashboardLaunchNonceSchema.parse(ownerNonceInput);

export default defineConfig({
  root: "src/dashboard",
  plugins: [{
    name: "hrauto-dashboard-launch-owner",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== "GET" || request.url !== DASHBOARD_FRONTEND_OWNER_PATH) {
          next();
          return;
        }
        if (ownerNonce === undefined) {
          response.statusCode = 404;
          response.end();
          return;
        }
        response.statusCode = 200;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.setHeader("cache-control", "no-store");
        response.end(ownerNonce);
      });
    },
  }, {
    name: "hrauto-dashboard-build-identity",
    apply: "build",
    closeBundle() {
      writeDashboardBuildIdentity({
        repoRoot: import.meta.dirname,
        distDir: resolve(import.meta.dirname, "dist/dashboard"),
      });
    },
  }, react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/dashboard"),
    },
  },
  build: {
    outDir: "../../dist/dashboard",
    emptyOutDir: true,
    /**
     * The dashboard, DS specimen and isolated Logs preview share one build.
     *
     * `index.html` is the operator dashboard. `kit.html` is the design-system specimen page (ledger 3 UK146–UK157). It
     * is an entry for the same closure reason read the other way round: what it
     * renders is `ds/**` and nothing else, and an entry is what lets
     * `dashboard-wire-boundary` say so. It is BUILT rather than left to the dev
     * server — ref frontend-backend-integration §7's parity lane serves `dist/dashboard` as
     * static files, so a specimen page absent from the build is a page the
     * parity corpus can never photograph, and `DESIGN.md` is binding while
     * pointing at it.
     */
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "src/dashboard/index.html"),
        kit: resolve(import.meta.dirname, "src/dashboard/kit.html"),
        logs: resolve(import.meta.dirname, "src/dashboard/logs.html"),
      },
    },
    manifest: true,
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": { target: BACKEND, changeOrigin: false },
      "/artifacts": { target: BACKEND, changeOrigin: false },
      "/events": { target: BACKEND, changeOrigin: false },
    },
  },
  preview: {
    port: 5174,
    strictPort: true,
  },
});
