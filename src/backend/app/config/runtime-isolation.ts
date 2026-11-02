import { userInfo } from "node:os";
import { isAbsolute,join,resolve } from "node:path";
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

export function applicationDataWorkspace(homeDirectory = userInfo().homedir): string {
  if (!isAbsolute(homeDirectory) || resolve(homeDirectory) !== homeDirectory) throw new Error("application-data-home-invalid");
  return join(homeDirectory, "Library", "Application Support", "Relay");
}
