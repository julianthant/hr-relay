import { PARITY_BUILD_COMMAND } from "./src/backend/app/composition/dashboard/build-identity.js";
import { mergeConfig } from "vite";
import { resolve } from "node:path";
import { dashboardConfig } from "./vite.dashboard.config.js";

const entry = resolve(import.meta.dirname, "tests/parity/app-entry.tsx");
export default mergeConfig(dashboardConfig(resolve(import.meta.dirname, "dist/parity-dashboard"), PARITY_BUILD_COMMAND), {
  plugins: [{
    name: "hrauto-parity-composition",
    transformIndexHtml: { order: "pre", handler: (html: string) => html.replace('src="/app/main.tsx"', `src="/@fs/${entry}"`) },
  }],
});
