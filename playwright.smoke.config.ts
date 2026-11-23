/** Browser smoke checks for the built dashboard on the seeded backend and the state gallery's check loop. */
import "./tests/support/helpers/credential-keychain-process-preload.mjs";
import { availableParallelism } from "node:os";
import { defineConfig, type Project } from "@playwright/test";

const gallery: Project = { name: "gallery", testMatch: "**/*.gallery.ts", workers: 1 };
const smoke: Project = { name: "smoke", testMatch: "**/*.smoke.ts", workers: 2 };

function projects(shard: string | undefined): Project[] {
  switch (shard) {
    case undefined: return [gallery, smoke];
    case "traces": return [smoke];
    case "independent": return [{ ...gallery, grep: /@gallery-independent\b/u }];
    case "shared": return [{ ...gallery, grepInvert: /@gallery-independent\b/u }];
    default: throw new Error(`Unknown smoke shard: ${shard}`);
  }
}

export default defineConfig({
  testDir: "tests/smoke",
  outputDir: "tests/smoke/.output",
  fullyParallel: false,
  workers: Math.min(3, availableParallelism()),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    browserName: "chromium",
    headless: true,
    timezoneId: "America/Los_Angeles",
    viewport: { width: 1280, height: 720 },
  },
  projects: projects(process.env.RELAY_SMOKE_SHARD),
  reporter: [["list"], ["json", { outputFile: "tests/smoke/.output/results.json" }]],
});
