
import { resolve } from "node:path";
import { rebuildRuntimeIsolation } from "./runtime-isolation.js";
import { ConfigPathsSchema, type ConfigPaths } from "../../../models/config/schema.js";

// Resolve the isolation-pinned profile root from the repository before opening Chromium.
let browserProfileRootMemo: string | undefined;

export function defaultBrowserProfileRoot(): string {
  browserProfileRootMemo ??= resolve(rebuildRuntimeIsolation.browserProfileRoot);
  return browserProfileRootMemo;
}

/** Parsed, not asserted: a default that failed to resolve absolute fails loud here. */
export function defaultRuntimePaths(): ConfigPaths {
  const profileRoot = defaultBrowserProfileRoot();
  return ConfigPathsSchema.parse({
    reportsDir: resolve("data/reports"),
    downloadsDir: resolve("data/downloads"),
    onboardingDocsDir: resolve("data/onboarding"),
    i9CheckTrackerPath: resolve("data/reports/i9-check-tracker.xlsx"),
    stateRoot: resolve(rebuildRuntimeIsolation.stateRoot),
    artifactRoot: resolve(rebuildRuntimeIsolation.artifactRoot),
    browserProfileRoot: profileRoot,
    duoExtensionDir: resolve("fast-duo"),
  });
}
