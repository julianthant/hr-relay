import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";

class FastDuoExtensionError extends Error {
  constructor() { super("Fast Duo extension files are unavailable or unsafe."); this.name = "FastDuoExtensionError"; }
}

const WORKFLOW_EXTENSION_FILES = ["workflow-manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "src/workflow-background.js",
  "src/workflow-inpage.js", "src/workflow-content.js", "src/username.js", "src/duo-origin.js"] as const;

const RELAY_EXTENSION_FILES = ["relay-manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "src/relay-background.js", "src/relay-content.js", "src/relay-inpage.js", "src/relay-native.js",
  "src/service.js", "src/crypto.js", "src/accounts.js", "src/duo-origin.js", "src/sign-count.js", "src/username.js",
  "src/options.html", "src/options.js", "src/popup.html", "src/popup.js", "src/relay-options.js", "src/styles.css", "src/icons/autopilot.svg", "src/icons/key-round.svg", "src/icons/plus.svg", "src/icons/shield-check.svg"] as const;

export function stageFastDuoExtension(sourceRoot: string, destination: string, mode: "onboarding" | "workflow"): void {
  if (realpathSync(sourceRoot) !== sourceRoot) throw new FastDuoExtensionError();
  mkdirSync(join(destination, "src", "icons"), { recursive: true, mode: 0o700 });
  for (const name of mode === "onboarding" ? RELAY_EXTENSION_FILES : WORKFLOW_EXTENSION_FILES) {
    const path = join(sourceRoot, name);
    if (realpathSync(path) !== path) throw new FastDuoExtensionError();
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(descriptor);
      if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o022) !== 0) throw new FastDuoExtensionError();
      const bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor);
      const observed = lstatSync(path);
      const check = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const checked = fstatSync(check);
        const hash = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");
        if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs
          || observed.ino !== after.ino || observed.dev !== after.dev || observed.isSymbolicLink() || observed.nlink !== 1
          || checked.ino !== after.ino || checked.dev !== after.dev || checked.nlink !== 1 || !checked.isFile()
          || hash(bytes) !== hash(readFileSync(check))) throw new FastDuoExtensionError();
      } finally { closeSync(check); }
      writeFileSync(join(destination, name.endsWith("-manifest.json") ? "manifest.json" : name), bytes, { flag: "wx", mode: 0o600 });
    } finally { closeSync(descriptor); }
  }
}
