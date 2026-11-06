/** The app build id: worker-runnable source bytes, the resolved lock entries that code loads, and the Node version. It binds write approval, never contract identity. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, resolve } from "node:path";
import { z } from "zod";
import { FingerprintSchema, type Fingerprint } from "../../rules/identity/ids.js";
import { digestFiles, filesUnder } from "./source-digest.js";

export const PARENT_BUILD_ID_ENV = "RELAY_PARENT_BUILD_ID";
const WORKER_SOURCE_ROOTS = ["src/backend", "src/workflow-kit", "src/workflows", "src/models", "src/rules"] as const;
const WORKER_SOURCE_FILES = ["src/cli.ts"] as const;
const RUNTIME_LOADER_PACKAGES = ["tsx"] as const;
const BUILTINS = new Set(builtinModules);
const PACKAGE_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/u;
// Static import/export statements start a line; dynamic import() and require() may appear anywhere.
const SPECIFIERS = /^[ \t]*(?:import|export)\b[^;"'`]*?\bfrom[ \t]*["']([^"']+)["']|^[ \t]*import[ \t]*["']([^"']+)["']|(?<![.\w$])import\(\s*["']([^"']+)["']\s*\)|(?<![.\w$])require\(\s*["']([^"']+)["']\s*\)/gmu;

const LockEntrySchema = z.object({
  version: z.string().optional(),
  integrity: z.string().optional(),
  os: z.array(z.string()).optional(),
  cpu: z.array(z.string()).optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  peerDependenciesMeta: z.record(z.string(), z.object({ optional: z.boolean().optional() })).optional(),
});
const LockSchema = z.object({ packages: z.record(z.string(), LockEntrySchema) });
type Lock = z.infer<typeof LockSchema>;

export class BuildIdError extends Error {
  constructor(readonly code: "relay-build-id-unavailable" | "relay-build-id-dependency-unresolved" | "relay-build-changed-under-running-app", detail: string) {
    super(`${code}: ${detail}`);
    this.name = "BuildIdError";
  }
}

/** The package a bare specifier loads; undefined for relative paths and Node builtins. */
export function packageOfSpecifier(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:") || BUILTINS.has(specifier)) return undefined;
  const parts = specifier.split("/");
  const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? "";
  if (!PACKAGE_NAME.test(name)) throw new BuildIdError("relay-build-id-dependency-unresolved", `unclassifiable import specifier "${specifier}"`);
  return name;
}

/** Node's nested lookup: the importer's own node_modules first, then each enclosing level up to the root. */
function resolveLockPath(lock: Lock, from: string, name: string): string | undefined {
  let base = from;
  for (;;) {
    const candidate = `${base === "" ? "" : `${base}/`}node_modules/${name}`;
    if (lock.packages[candidate] !== undefined) return candidate;
    if (base === "") return undefined;
    const index = base.lastIndexOf("/node_modules/");
    base = index === -1 ? "" : base.slice(0, index);
  }
}

/** The lock entries reachable from the root packages over required, optional and peer edges. */
export function runtimeLockEntries(lock: Lock, roots: readonly string[]): ReadonlyMap<string, z.infer<typeof LockEntrySchema>> {
  const selected = new Map<string, z.infer<typeof LockEntrySchema>>();
  const pending: string[] = [];
  const require = (from: string, name: string, optional: boolean) => {
    const path = resolveLockPath(lock, from, name);
    if (path === undefined) {
      if (optional) return;
      throw new BuildIdError("relay-build-id-dependency-unresolved", `${name} (needed by ${from === "" ? "worker code" : from}) has no lock entry`);
    }
    if (!selected.has(path)) { selected.set(path, lock.packages[path] ?? {}); pending.push(path); }
  };
  for (const root of roots) require("", root, false);
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    const entry = lock.packages[path] ?? {};
    for (const name of Object.keys(entry.dependencies ?? {})) require(path, name, false);
    for (const name of Object.keys(entry.optionalDependencies ?? {})) require(path, name, true);
    for (const name of Object.keys(entry.peerDependencies ?? {})) require(path, name, entry.peerDependenciesMeta?.[name]?.optional === true);
  }
  return selected;
}

export function computeBuildId(repoRoot: string, nodeVersion: string = process.version): Fingerprint {
  const root = resolve(repoRoot);
  const files: string[] = [];
  try {
    for (const directory of WORKER_SOURCE_ROOTS) filesUnder(join(root, directory), files);
    for (const file of WORKER_SOURCE_FILES) {
      if (!existsSync(join(root, file))) throw new Error(`${file} is missing`);
      files.push(join(root, file));
    }
  } catch (cause) {
    throw new BuildIdError("relay-build-id-unavailable", cause instanceof Error ? cause.message : String(cause));
  }
  files.sort();
  const packages = new Set<string>(RUNTIME_LOADER_PACKAGES);
  for (const file of files) {
    if (!/\.[cm]?tsx?$/u.test(file)) continue;
    for (const match of readFileSync(file, "utf8").matchAll(SPECIFIERS)) {
      const name = packageOfSpecifier(match[1] ?? match[2] ?? match[3] ?? match[4] ?? "");
      if (name !== undefined) packages.add(name);
    }
  }
  const lockPath = join(root, "package-lock.json");
  if (!existsSync(lockPath)) throw new BuildIdError("relay-build-id-unavailable", "package-lock.json is missing");
  const lock = LockSchema.parse(JSON.parse(readFileSync(lockPath, "utf8")));
  const dependencies = [...runtimeLockEntries(lock, [...packages].sort())]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, entry]) => ({ path, version: entry.version ?? null, integrity: entry.integrity ?? null, os: entry.os ?? null, cpu: entry.cpu ?? null }));
  return FingerprintSchema.parse(createHash("sha256").update(JSON.stringify({
    kind: "relay-build-id", version: 1, node: nodeVersion, sources: digestFiles(root, files), dependencies,
  })).digest("hex"));
}

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
let captured: Fingerprint | undefined;

/** Freeze this process's build id before the application graph loads; a worker must match its parent. */
export function captureBuildId(env: NodeJS.ProcessEnv = process.env): Fingerprint {
  captured ??= computeBuildId(REPO_ROOT);
  const parent = env[PARENT_BUILD_ID_ENV];
  if (parent !== undefined && parent !== captured) {
    throw new BuildIdError("relay-build-changed-under-running-app", `worker build ${captured} differs from parent build ${parent}`);
  }
  return captured;
}

/** The frozen build id; processes without a bootstrap (tests, scripts) capture on first use. */
export function currentBuildId(): Fingerprint {
  captured ??= computeBuildId(REPO_ROOT);
  return captured;
}
