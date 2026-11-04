import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildSync } from "esbuild";

const OUTPUT = "node_modules/.cache/relay/windows-observer-policy.cjs";
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function outputs(root: string): ReadonlyMap<string, Uint8Array> {
  const build = buildSync({
    absWorkingDir: root,
    stdin: { contents: 'export { privatePathRejects } from "./src/backend/storage/private-path.ts";', resolveDir: root },
    bundle: true, platform: "node", target: "node26", format: "cjs", write: false, metafile: true,
    external: ["koffi"], preserveSymlinks: true,
    define: { "import.meta.url": "__relayPolicyModuleUrl" },
    banner: { js: 'const __relayPolicyModuleUrl = require("node:url").pathToFileURL(__filename).href;' },
  });
  const bytes = build.outputFiles[0]?.contents;
  if (bytes === undefined) throw new Error("windows-observer-policy-build-missing");
  const inputs = [...new Set([...Object.keys(build.metafile.inputs).filter(path => path !== "<stdin>"),
    "scripts/build/windows-observer-policy.ts", "package.json", "package-lock.json", "node_modules/esbuild/package.json"])]
    .sort().map(path => ({ path, digest: digest(readFileSync(resolve(root, path))) }));
  const metadata = Buffer.from(`${JSON.stringify({ version: 1, artifact: digest(bytes), inputs }, null, 2)}\n`);
  return new Map([[OUTPUT, bytes], [`${OUTPUT}.json`, metadata]]);
}

export function prepareWindowsObserverPolicy(root: string): void {
  for (const [path, bytes] of outputs(root)) {
    const target = resolve(root, path);
    if (existsSync(target) && readFileSync(target).equals(bytes)) continue;
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try { writeFileSync(temporary, bytes, { flag: "wx" }); renameSync(temporary, target); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
}

export function auditWindowsObserverPolicy(root: string): readonly string[] {
  return [...outputs(root)].filter(([path, bytes]) => {
    const target = resolve(root, path);
    return !existsSync(target) || !readFileSync(target).equals(bytes);
  }).map(([path]) => `${path} is missing or stale — run npm run build:manifest:prepare`);
}
