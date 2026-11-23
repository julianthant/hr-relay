/** Browser smoke checks for the built dashboard on the seeded backend, and the state gallery's check loop. */
import "./tests/support/helpers/credential-keychain-process-preload.mjs";
import { defineConfig } from "@playwright/test";

const ciProject = process.env.RELAY_SMOKE_PROJECT;
const projects = [
  { name: "smoke", testMatch: "**/*.smoke.ts" },
  { name: "gallery", testMatch: "**/*.gallery.ts" },
].filter(project => ciProject === undefined || project.name === ciProject);
if (!projects.length) throw new Error(`Unknown RELAY_SMOKE_PROJECT: ${ciProject}`);

export default defineConfig({
  testDir: "tests/smoke",
  outputDir: "tests/smoke/.output",
  fullyParallel: false,
  workers: ciProject === "smoke" ? 2 : 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    browserName: "chromium",
    headless: true,
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1280, height: 720 },
  },
  projects,
  reporter: process.env.PLAYWRIGHT_JSON_OUTPUT_FILE ? [["list"], ["json"]] : [["list"]],
});
