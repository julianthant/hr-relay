import { defineRuntimeIsolation } from "./define-runtime-isolation.js";

export const rebuildRuntimeIsolation = defineRuntimeIsolation({
  stateRoot: ".tracker",
  archiveDatabaseFile: "archive.sqlite",
  artifactRoot: ".tracker/artifacts",
  backendPort: 3938,
  frontendPort: 5174,
  processLockRoot: ".tracker/locks",
  browserProfileRoot: ".auth",
  browserSessionNamespace: "hrauto-rebuild",
});
