import { defineRuntimeIsolation } from "./define-runtime-isolation.js";

export const rebuildRuntimeIsolation = defineRuntimeIsolation({
  stateRoot: ".tracker-rebuild",
  artifactRoot: ".tracker-rebuild/artifacts",
  backendPort: 3938,
  frontendPort: 5174,
  processLockRoot: ".tracker-rebuild/locks",
  browserProfileRoot: ".auth-rebuild",
  browserSessionNamespace: "hrauto-rebuild",
});
