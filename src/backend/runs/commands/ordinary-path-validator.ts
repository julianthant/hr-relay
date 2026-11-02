import { lstatSync,readFileSync } from "node:fs";
import { dirname,isAbsolute,join,resolve,sep } from "node:path";
import type { Config } from "../../../models/config/schema.js";

type PathKey = "paths.browserProfileRoot" | "paths.duoCredential" | "paths.duoExtensionDir";

export class OrdinaryPathValidationError extends Error {
  constructor(readonly key: PathKey, readonly reason: string) {
    super(`ordinary-path-invalid:${key}:${reason}`);
    this.name = "OrdinaryPathValidationError";
  }
}

function fail(key: PathKey, reason: string): never {
  throw new OrdinaryPathValidationError(key, reason);
}

function requiredPath(key: PathKey, path: string): void {
  if (!isAbsolute(path) || resolve(path) !== path || path === sep) fail(key, "canonical-absolute-path-required");
  for (let cursor = dirname(path); cursor !== dirname(cursor); cursor = dirname(cursor)) {
    try {
      if (lstatSync(cursor).isSymbolicLink()) fail(key, "symlink-ancestor");
    } catch (error) {
      if (error instanceof OrdinaryPathValidationError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") fail(key, "parent-unavailable");
    }
  }
}

function ownedDirectory(key: PathKey, path: string, allowMissing: boolean): boolean {
  let metadata;
  try { metadata = lstatSync(path); }
  catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
    fail(key, "directory-unavailable");
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) fail(key, "regular-directory-required");
  if (metadata.uid !== (process.getuid?.() ?? -1) || (metadata.mode & 0o700) !== 0o700
    || (metadata.mode & 0o022) !== 0) {
    fail(key, "owned-nonwritable-directory-required");
  }
  return true;
}

function validateExtension(path: string): void {
  const key = "paths.duoExtensionDir";
  requiredPath(key, path);
  ownedDirectory(key, path, false);
  const manifestPath = join(path, "workflow-manifest.json");
  try {
    const metadata = lstatSync(manifestPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 64_000) fail(key, "unpacked-manifest-required");
    const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)
      || Reflect.get(manifest, "manifest_version") !== 3
      || typeof Reflect.get(manifest, "name") !== "string"
      || String(Reflect.get(manifest, "name")).trim().length === 0) fail(key, "unpacked-manifest-required");
  } catch (error) {
    if (error instanceof OrdinaryPathValidationError) throw error;
    fail(key, "unpacked-manifest-required");
  }
}

export function validateOrdinaryPathChanges(
  previous: Config,
  candidate: Config,
): void {
  if (previous.paths.duoCredential !== candidate.paths.duoCredential) fail("paths.duoCredential", "retired-setting");
  if (previous.paths.browserProfileRoot !== candidate.paths.browserProfileRoot) {
    fail("paths.browserProfileRoot", "fixed-root");
  }
  if (previous.paths.duoExtensionDir !== candidate.paths.duoExtensionDir) validateExtension(candidate.paths.duoExtensionDir);
}
