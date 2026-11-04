import { join, resolve } from "node:path";
import { ConfigPathsSchema,ONBOARDING_DOCUMENTS_DIRECTORY_NAME,type ConfigPaths } from "../../../models/config/schema.js";
import { applicationDataWorkspace,rebuildRuntimeIsolation } from "./runtime-isolation.js";

export function defaultRuntimePaths(admittedPair?: Pick<ConfigPaths, "stateRoot" | "artifactRoot">): ConfigPaths {
  const stateRoot = admittedPair === undefined ? join(applicationDataWorkspace(), rebuildRuntimeIsolation.stateRoot) : admittedPair.stateRoot;
  return ConfigPathsSchema.parse({
    reportsDir: join(stateRoot, "files", "reports"),
    downloadsDir: join(stateRoot, "files", "downloads"),
    onboardingDocsDir: join(stateRoot, "files", ONBOARDING_DOCUMENTS_DIRECTORY_NAME),
    i9CheckTrackerPath: join(stateRoot, "files", "reports", "i9-check-tracker.xlsx"),
    stateRoot,
    artifactRoot: admittedPair?.artifactRoot ?? join(stateRoot, "artifacts"),
    browserProfileRoot: join(stateRoot, "browsers"),
    duoCredential: join(stateRoot, "credentials", "duo-webauthn.json"),
    duoExtensionDir: resolve(import.meta.dirname, "../../../../fast-duo"),
  });
}
