import { PROFILE_ENROLLMENT_EXTENSION_MODE } from "../../../models/config/duo-credential-store.js";
import { privatePathRejects } from "../../storage/private-path.js";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, lstatSync, mkdirSync, realpathSync, writeFileSync, type Stats, type BigIntStats } from "node:fs";
import { join } from "node:path";

class FastDuoExtensionError extends Error {
  constructor() { super("Fast Duo extension files are unavailable or unsafe."); this.name = "FastDuoExtensionError"; }
}

const WORKFLOW_EXTENSION_FILES = ["workflow-manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "src/workflow-background.js",
  "src/workflow-inpage.js", "src/workflow-content.js", "src/username.js", "src/duo-origin.js"] as const;

const RELAY_EXTENSION_FILES = ["relay-manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "src/relay-background.js", "src/relay-content.js", "src/relay-inpage.js", "src/relay-native.js",
  "src/service.js", "src/crypto.js", "src/accounts.js", "src/duo-origin.js", "src/username.js",
  "src/options.html", "src/options.js", "src/relay-options.js", "src/styles.css", "src/icons/autopilot.svg", "src/icons/shield-check.svg"] as const;

function descriptorStat(descriptor: number): Stats | BigIntStats {
  return process.platform === "win32" ? fstatSync(descriptor, { bigint: true }) : fstatSync(descriptor);
}
function singleLink(links: number | bigint): boolean { return links === 1 || links === 1n; }
function modified(stat: Stats | BigIntStats): number | bigint { return "mtimeNs" in stat ? stat.mtimeNs : stat.mtimeMs; }

export function stageFastDuoExtension(sourceRoot: string, destination: string, mode: typeof PROFILE_ENROLLMENT_EXTENSION_MODE | "workflow"): void {
  if (realpathSync(sourceRoot) !== sourceRoot) throw new FastDuoExtensionError();
  mkdirSync(join(destination, "src", "icons"), { recursive: true, mode: 0o700 });
  for (const name of mode === PROFILE_ENROLLMENT_EXTENSION_MODE ? RELAY_EXTENSION_FILES : WORKFLOW_EXTENSION_FILES) {
    const path = join(sourceRoot, name);
    if (realpathSync(path) !== path) throw new FastDuoExtensionError();
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = descriptorStat(descriptor);
      if (!before.isFile() || !singleLink(before.nlink) || privatePathRejects(path, before, "group-write")) throw new FastDuoExtensionError();
      const bytes = readFileSync(descriptor);
      const after = descriptorStat(descriptor);
      const observed = process.platform === "win32" ? lstatSync(path, { bigint: true }) : lstatSync(path);
      const check = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const checked = descriptorStat(check);
        const hash = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");
        if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || !singleLink(after.nlink) || modified(before) !== modified(after)
          || ("ctimeNs" in before && "ctimeNs" in after && before.ctimeNs !== after.ctimeNs)
          || observed.ino !== after.ino || observed.dev !== after.dev || observed.isSymbolicLink() || !singleLink(observed.nlink)
          || checked.ino !== after.ino || checked.dev !== after.dev || !singleLink(checked.nlink) || !checked.isFile()
          || hash(bytes) !== hash(readFileSync(check))) throw new FastDuoExtensionError();
      } finally { closeSync(check); }
      writeFileSync(join(destination, name.endsWith("-manifest.json") ? "manifest.json" : name), bytes, { flag: "wx", mode: 0o600 });
    } finally { closeSync(descriptor); }
  }
}
