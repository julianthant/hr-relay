import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { z } from "zod";
import { assertDashboardBuildCurrent } from "../../src/backend/app/composition/dashboard/build-identity.js";

export const BUNDLE_MANIFEST = "relay-bundle.json";
export const MAX_BUNDLE_RELATIVE_PATH = 180;
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const BundleFileSchema = z.strictObject({ path: z.string().min(1), bytes: z.number().int().nonnegative(), sha256: DigestSchema });
export const BundleManifestSchema = z.strictObject({
  version: z.literal(1), platform: z.literal("win32-x64"), revision: z.string().regex(/^[a-f0-9]{40}$/u),
  node: z.string().regex(/^v26\./u), files: z.array(BundleFileSchema).min(1),
});
export type BundleManifest = z.infer<typeof BundleManifestSchema>;

export function assertBundlePath(path: string): void {
  const parts = path.split("/");
  if (path.length > MAX_BUNDLE_RELATIVE_PATH || parts.some(part => !part || part === "." || part === ".."
    || /[<>:"\\|?*]/u.test(part) || [...part].some(character => character.charCodeAt(0) < 32) || /[. ]$/u.test(part)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw new Error("relay-bundle-path-refused");
  if (parts.some(part => /^\.env(?:\.|$)/iu.test(part) || [".tracker", ".auth", ".git", ".work", "credentials"].includes(part.toLowerCase()))
    || /(?:\.sqlite(?:3)?|\.db|\.pem|\.pfx|\.key|\.cpuprofile)$/iu.test(path)
    || /(?:^|\/)test-data\.local/iu.test(path)) throw new Error("relay-bundle-private-content-refused");
}

export function bundleFiles(root: string): BundleManifest["files"] {
  const files: BundleManifest["files"] = [];
  const visit = (directory: string): void => {
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error("relay-bundle-entry-refused");
    for (const entry of readdirSync(directory).sort()) {
      const target = join(directory, entry);
      const path = relative(root, target).split(sep).join("/");
      assertBundlePath(path);
      const stat = lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error("relay-bundle-entry-refused");
      if (stat.isDirectory()) visit(target);
      else if (stat.isFile()) {
        if (path === BUNDLE_MANIFEST) continue;
        files.push({ path, bytes: stat.size, sha256: createHash("sha256").update(readFileSync(target)).digest("hex") });
      } else throw new Error("relay-bundle-entry-refused");
    }
  };
  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function assertRequiredBundleAssets(paths: readonly string[]): void {
  const exact = ["relay.cmd", "tools/node/node.exe", "src/cli.ts", "scripts/dev/relay.ts", "scripts/dev/relay-backend.ts",
    "scripts/packaging/relay-bundle.ts", "src/workflow-kit/validation/generated-build-manifest.ts",
    "node_modules/.cache/relay/windows-observer-policy.cjs", "node_modules/.cache/relay/windows-observer-policy.cjs.json",
    "node_modules/tsx/dist/loader.mjs", "node_modules/playwright-core/browsers.json", "dist/dashboard/index.html",
    "dist/dashboard/dashboard-build-identity.json", "fast-duo/workflow-manifest.json"];
  if (exact.some(path => !paths.includes(path))
    || !paths.some(path => /^node_modules\/koffi\/.*win32.*\.node$/u.test(path))
    || !paths.some(path => /^node_modules\/@napi-rs\/canvas-win32-x64-msvc\/.*\.node$/u.test(path))
    || !paths.some(path => /^node_modules\/@napi-rs\/keyring-win32-x64-msvc\/.*\.node$/u.test(path))
    || !paths.some(path => /^tools\/browsers\/chromium-\d+\/chrome-win64\/chrome.exe$/u.test(path))) throw new Error("relay-bundle-required-asset-missing");
}

export function assertBundleCurrent(root: string): BundleManifest {
  const manifest = BundleManifestSchema.parse(JSON.parse(readFileSync(join(root, BUNDLE_MANIFEST), "utf8")));
  const seen = new Set<string>();
  for (const file of manifest.files) {
    assertBundlePath(file.path);
    const key = file.path.toLowerCase();
    if (seen.has(key) || file.path === BUNDLE_MANIFEST) throw new Error("relay-bundle-manifest-invalid");
    seen.add(key);
    if (join(root, file.path).length >= 260) throw new Error("relay-bundle-extract-to-shorter-path");
  }
  assertRequiredBundleAssets(manifest.files.map(file => file.path));
  if (JSON.stringify(manifest.files) !== JSON.stringify(bundleFiles(root))) throw new Error("relay-bundle-files-changed");
  assertDashboardBuildCurrent({ repoRoot: root, distDir: join(root, "dist/dashboard") });
  return manifest;
}
