import { userInfo } from "node:os";
import { posix, win32 } from "node:path";
import { windowsLocalApplicationData } from "../../../models/config/secrets.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
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

export type ApplicationDataHostFacts =
  | { readonly platform: "win32"; readonly localAppData: string | undefined }
  | { readonly platform: Exclude<NodeJS.Platform, "win32">; readonly homeDirectory: string };

export class ApplicationDataWorkspaceRefusedError extends Error {
  readonly code = "APPLICATION_DATA_WORKSPACE_REFUSED";
  constructor(readonly reason: "missing-local-appdata" | "invalid-local-appdata") {
    super(ERROR_CATALOG.APPLICATION_DATA_WORKSPACE_REFUSED.text);
    this.name = "ApplicationDataWorkspaceRefusedError";
  }
}

function currentApplicationDataHostFacts(): ApplicationDataHostFacts {
  const platform = process.platform;
  return platform === "win32"
    ? { platform, localAppData: windowsLocalApplicationData() }
    : { platform, homeDirectory: userInfo().homedir };
}

export function applicationDataWorkspace(host: ApplicationDataHostFacts = currentApplicationDataHostFacts()): string {
  if (host.platform !== "win32") {
    if (!posix.isAbsolute(host.homeDirectory) || posix.resolve(host.homeDirectory) !== host.homeDirectory) throw new Error("application-data-home-invalid");
    return posix.join(host.homeDirectory, "Library", "Application Support", "Relay");
  }
  const local = host.localAppData;
  if (local === undefined) throw new ApplicationDataWorkspaceRefusedError("missing-local-appdata");
  const parts = local.slice(3).split("\\");
  if (!/^[a-z]:\\/iu.test(local) || win32.resolve(local) !== local || parts.some(part => {
    const base = part.split(".")[0].replace(/ +$/u, "");
    return part === "" || part.startsWith(" ") || /[. ]$/u.test(part) || /[<>:"/|?*]/u.test(part)
      || [...part].some(character => character.charCodeAt(0) < 32)
      || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/iu.test(base);
  })) throw new ApplicationDataWorkspaceRefusedError("invalid-local-appdata");
  return win32.join(local, "Relay");
}
