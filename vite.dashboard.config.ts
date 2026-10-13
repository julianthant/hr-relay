/** Development proxies keep the typed client on the BFF's same origin. */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";
import { writeDashboardBuildIdentity, DASHBOARD_BUILD_COMMAND, type DashboardBuildCommand } from "./src/backend/app/composition/dashboard/build-identity.js";
import {
  DASHBOARD_FRONTEND_OWNER_PATH,
  DASHBOARD_LAUNCH_NONCE_ENV,
  DashboardLaunchNonceSchema,
} from "./src/backend/transports/http/frontend-owner.js";

const BACKEND = "http://127.0.0.1:3938";
const ownerNonceInput = process.env[DASHBOARD_LAUNCH_NONCE_ENV];
const ownerNonce = ownerNonceInput === undefined
  ? undefined
  : DashboardLaunchNonceSchema.parse(ownerNonceInput);

export function dashboardConfig(distDir = resolve(import.meta.dirname, "dist/dashboard"), buildScript: DashboardBuildCommand = DASHBOARD_BUILD_COMMAND) {
return defineConfig({
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
        distDir,
        buildScript,
      });
    },
  }, react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src/dashboard"),
    },
  },
  build: {
    outDir: distDir,
    emptyOutDir: true,
    // Build the dashboard and design-system specimen together.
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "src/dashboard/index.html"),
        kit: resolve(import.meta.dirname, "src/dashboard/kit.html"),
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

}

export default dashboardConfig();
