import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { WindowsPrivatePathError } from "./windows-private-path.js";

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const fixedInputs = new Set([
  "src/backend/storage/private-path.ts", "src/backend/storage/windows-private-path.ts", "src/backend/storage/source-closure.ts",
  "src/models/failures/boundary-failure.ts", "src/models/failures/error-catalog.ts", "src/rules/identity/ids.ts",
  "scripts/build/windows-observer-policy.ts", "package.json", "package-lock.json", "node_modules/esbuild/package.json",
]);
const inputPath = z.string().refine(path => fixedInputs.has(path)
  || /^node_modules\/zod\/(?:[\w-]+\/)*[\w-]+\.js$/u.test(path));
const metadataSchema = z.strictObject({
  version: z.literal(1),
  artifact: z.string().regex(/^[a-f0-9]{64}$/u),
  inputs: z.array(z.strictObject({ path: inputPath, digest: z.string().regex(/^[a-f0-9]{64}$/u) })).min(1),
});

// The source build asset is separate from its locator and metadata.
export function windowsObserverPolicyPrelude(observer: "snapshot" | "binding"): string {
  try {
    const root = realpathSync(resolve(import.meta.dirname, "../../.."));
    const read = (path: string) => {
      if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error("aliased-build-input");
      return readFileSync(path);
    };
    const artifact = resolve(root, "node_modules/.cache/relay/windows-observer-policy.cjs");
    const metadata = metadataSchema.parse(JSON.parse(read(`${artifact}.json`).toString("utf8")));
    const paths = new Set(metadata.inputs.map(input => input.path));
    if (paths.size !== metadata.inputs.length || [...fixedInputs].some(path => !paths.has(path))) throw new Error("invalid-input-binding");
    for (const input of metadata.inputs) {
      if (digest(read(resolve(root, input.path))) !== input.digest) throw new Error("stale-input");
    }
    if (digest(read(artifact)) !== metadata.artifact) throw new Error("changed-artifact");
    return `
let privatePathRejects;
try {
  const artifact = ${JSON.stringify(artifact)};
  const bytes = require("node:fs").readFileSync(artifact);
  if (require("node:crypto").createHash("sha256").update(bytes).digest("hex") !== ${JSON.stringify(metadata.artifact)}) throw new Error("changed-artifact");
  const policy = { exports: {} };
  const wrapper = new (require("node:vm").Script)("(function(exports, require, module, __filename, __dirname) {" + bytes.toString("utf8") + "\\n})", { filename: artifact }).runInThisContext();
  wrapper(policy.exports, require("node:module").createRequire(artifact), policy, artifact, require("node:path").dirname(artifact));
  ({ privatePathRejects } = policy.exports);
  if (typeof privatePathRejects !== "function") throw new Error("invalid-policy-export");
} catch {
  process.stdout.write(JSON.stringify(${JSON.stringify({ ...(observer === "binding" ? { state: "refused" } : {}), message: "windows-observer-policy-refused" })}));
  process.exit(1);
}
`;
  } catch (cause) {
    throw new WindowsPrivatePathError(`observer-policy-unavailable:${cause instanceof Error ? cause.message : "unknown"}`);
  }
}
