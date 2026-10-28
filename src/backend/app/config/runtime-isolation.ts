import { defineRuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";

export const rebuildRuntimeIsolation = defineRuntimeIsolation({
  stateRoot: ".tracker/data",
  artifactRoot: ".tracker/data/artifacts",
  backendPort: 3938,
  lockPort: 3939,
  frontendPort: 5174,
  processLockRoot: ".tracker/data/locks",
  browserProfileRoot: ".tracker/data/browsers",
  browserSessionNamespace: "hrauto-rebuild",
});
