import { join, resolve } from "node:path";
import { ConfigPathsSchema,type ConfigPaths } from "../../../models/config/schema.js";
import { applicationDataWorkspace,rebuildRuntimeIsolation } from "./runtime-isolation.js";

export function defaultBrowserProfileRoot(): string {
  return join(applicationDataWorkspace(), rebuildRuntimeIsolation.browserProfileRoot);
}

export function defaultRuntimePaths(): ConfigPaths {
  const workspace = applicationDataWorkspace();
  const stateRoot = join(workspace, rebuildRuntimeIsolation.stateRoot);
  return ConfigPathsSchema.parse({
    reportsDir: join(stateRoot, "files", "reports"),
    downloadsDir: join(stateRoot, "files", "downloads"),
    onboardingDocsDir: join(stateRoot, "files", "onboarding"),
    i9CheckTrackerPath: join(stateRoot, "files", "reports", "i9-check-tracker.xlsx"),
    stateRoot,
    artifactRoot: join(workspace, rebuildRuntimeIsolation.artifactRoot),
    browserProfileRoot: defaultBrowserProfileRoot(),
    duoCredential: join(stateRoot, "credentials", "duo-webauthn.json"),
    duoExtensionDir: resolve(import.meta.dirname, "../../../../fast-duo"),
  });
}
