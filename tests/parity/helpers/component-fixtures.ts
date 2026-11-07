import { resolve } from "node:path";
import { build, preview } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const fixtures = ["account", "approved-controls", "assistant", "hub-assistant"] as const;
type ComponentFixture = typeof fixtures[number];
const fixtureRoot = resolve(import.meta.dirname, "../fixtures");
const outputRoot = resolve(import.meta.dirname, "../../../dist/parity-components");

export async function buildComponentFixtures(): Promise<void> {
  for (const fixture of fixtures) {
    await build({ configFile: false, root: resolve(fixtureRoot, fixture), plugins: [react(), tailwindcss()],
      logLevel: "warn", build: { outDir: resolve(outputRoot, fixture), emptyOutDir: true } });
  }
}

export function previewComponentFixture(fixture: ComponentFixture) {
  return preview({ configFile: false, root: resolve(fixtureRoot, fixture), logLevel: "warn",
    build: { outDir: resolve(outputRoot, fixture) }, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
}
