import { createHash } from "node:crypto";
import { cpSync, createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { assertDashboardBuildCurrent } from "../../src/backend/app/composition/dashboard/build-identity.js";
import { BUNDLE_MANIFEST, BundleManifestSchema, assertBundleCurrent, assertBundlePath, assertRequiredBundleAssets, bundleFiles } from "./bundle-manifest.js";

export async function buildWindowsBundle(input: { root: string; output: string; browsers: string; revision: string }): Promise<string> {
  if (process.platform !== "win32" || process.arch !== "x64" || !process.version.startsWith("v26.")) throw new Error("relay-bundle-build-requires-windows-node26-x64");
  const root = resolve(input.root);
  const output = resolve(input.output);
  if (!isAbsolute(input.output) || output === root || output.startsWith(`${root}${sep}`) || existsSync(output)) throw new Error("relay-bundle-output-must-be-new-external-folder");
  assertDashboardBuildCurrent({ repoRoot: root, distDir: join(root, "dist/dashboard") });
  mkdirSync(output, { recursive: true });
  const stage = join(output, "relay");
  mkdirSync(stage);
  for (const path of ["src", "scripts", "fast-duo/src", "fast-duo/workflow-manifest.json", "fast-duo/relay-manifest.json",
    "fast-duo/LICENSE", "fast-duo/THIRD_PARTY_NOTICES.md", "dist/dashboard", "package.json", "package-lock.json",
    "tsconfig.json", "vite.dashboard.config.ts", "relay.cmd", "config/dashboard-workflow-sources.json", "config/runtime-isolation.json"]) {
    cpSync(join(root, path), join(stage, path), { recursive: true, dereference: false });
  }
  cpSync(join(root, "node_modules"), join(stage, "node_modules"), { recursive: true, dereference: false,
    filter: source => {
      const path = relative(join(root, "node_modules"), source).split(sep).join("/");
      if (path === "") return true;
      const parts = path.split("/");
      if (parts.some(part => [".bin", "test", "tests", "__tests__", "fixtures", ".github"].includes(part))) return false;
      if (path.startsWith(".cache/") && path !== ".cache/relay" && !path.startsWith(".cache/relay/")) return false;
      assertBundlePath(`node_modules/${path}`);
      if (lstatSync(source).isSymbolicLink()) throw new Error("relay-bundle-dependency-link-refused");
      return true;
    } });
  mkdirSync(join(stage, "tools/node"), { recursive: true });
  cpSync(process.execPath, join(stage, "tools/node/node.exe"));
  cpSync(input.browsers, join(stage, "tools/browsers"), { recursive: true, dereference: false,
    filter: source => !relative(input.browsers, source).split(sep).includes(".links") });
  const files = bundleFiles(stage);
  assertRequiredBundleAssets(files.map(file => file.path));
  const manifest = BundleManifestSchema.parse({ version: 1, platform: "win32-x64", revision: input.revision, node: process.version, files });
  writeFileSync(join(stage, BUNDLE_MANIFEST), `${JSON.stringify(manifest)}\n`, { flag: "wx" });
  assertBundleCurrent(stage);
  const archive = join(output, `relay-win-x64-${manifest.revision}.zip`);
  const zip = new JSZip();
  for (const file of [...files, { path: BUNDLE_MANIFEST }]) {
    zip.file(`relay/${file.path}`, createReadStream(join(stage, file.path)), { binary: true, createFolders: false });
  }
  await pipeline(zip.generateNodeStream({ streamFiles: true, compression: "DEFLATE", compressionOptions: { level: 1 } }), createWriteStream(archive, { flags: "wx" }));
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(archive)) {
    if (!(bytes instanceof Buffer)) throw new Error("relay-bundle-archive-read-refused");
    digest.update(bytes);
  }
  writeFileSync(`${archive}.sha256`, `${digest.digest("hex")}  ${relative(dirname(archive), archive)}\n`, { flag: "wx" });
  return archive;
}

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const [output, browsers, revision] = process.argv.slice(2);
  if (output === "--check" && browsers !== undefined && revision === undefined) assertBundleCurrent(resolve(browsers));
  else {
    if (output === undefined || browsers === undefined || revision === undefined) throw new Error("Usage: build-windows-bundle <new-absolute-output> <browser-root> <revision>");
    await buildWindowsBundle({ root: resolve(import.meta.dirname, "../.."), output, browsers, revision });
  }
}
