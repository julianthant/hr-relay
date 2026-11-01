import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import type { Config } from "../../../models/config/schema.js";
import { defaultBrowserProfileRoot } from "../../app/config/runtime-paths.js";
import { resolveSecretFileIdentity } from "../../../models/config/secrets.js";

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

function validateProfile(path: string, installationDefault: string, config: Config): void {
  const key = "paths.browserProfileRoot";
  requiredPath(key, path);
  const internal = path === join(config.paths.stateRoot, "browsers");
  const protectedRoots = [
    ...(internal ? [] : [config.paths.stateRoot]), config.paths.artifactRoot,
    join(config.paths.stateRoot, "locks"), join(config.paths.stateRoot, "credentials"), config.paths.duoExtensionDir,
  ];
  if (protectedRoots.some(root => path === root || path.startsWith(`${root}${sep}`) || root.startsWith(`${path}${sep}`))) {
    fail(key, "overlaps-runtime-location");
  }
  if (path !== installationDefault
    && (path === config.paths.duoCredential || config.paths.duoCredential.startsWith(`${path}${sep}`))) {
    fail(key, "contains-duo-credential");
  }
  if (ownedDirectory(key, path, true)) {
    if (path !== installationDefault) {
      let entries;
      try { entries = readdirSync(path); }
      catch { fail(key, "directory-unreadable"); }
      if (entries.length !== 0) fail(key, "fresh-empty-profile-required");
    }
    return;
  }
  let ancestor = dirname(path);
  while (true) {
    try {
      const metadata = lstatSync(ancestor);
      const ownedSafe = metadata.uid === (process.getuid?.() ?? -1)
        && (metadata.mode & 0o700) === 0o700 && (metadata.mode & 0o022) === 0;
      const stickyTemporary = (metadata.mode & 0o1000) !== 0 && (metadata.mode & 0o002) !== 0;
      if (!metadata.isDirectory() || metadata.isSymbolicLink()
        || (!ownedSafe && !stickyTemporary)) {
        fail(key, "unsafe-profile-parent");
      }
      break;
    } catch (error) {
      if (error instanceof OrdinaryPathValidationError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") fail(key, "parent-unavailable");
      const next = dirname(ancestor);
      if (next === ancestor) fail(key, "parent-unavailable");
      ancestor = next;
    }
  }
}

function validateCredential(config: Config): void {
  const key = "paths.duoCredential";
  const path = config.paths.duoCredential;
  requiredPath(key, path);
  let descriptor: number;
  try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { fail(key, "private-file-unavailable"); }
  try {
    const named = lstatSync(path);
    const opened = fstatSync(descriptor);
    if (!named.isFile() || !opened.isFile() || named.isSymbolicLink() || named.dev !== opened.dev || named.ino !== opened.ino
      || opened.nlink !== 1 || opened.uid !== (process.getuid?.() ?? -1) || (opened.mode & 0o777) !== 0o600
      || opened.size < 1 || opened.size > 64_000) fail(key, "private-file-required");
  } catch (error) {
    if (error instanceof OrdinaryPathValidationError) throw error;
    fail(key, "private-file-unavailable");
  } finally { closeSync(descriptor); }
  try { resolveSecretFileIdentity("duoWebauthnCredential", config); }
  catch { fail(key, "credential-identity-unavailable"); }
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
  installationDefault: () => string = defaultBrowserProfileRoot,
): void {
  if (previous.paths.browserProfileRoot !== candidate.paths.browserProfileRoot) {
    validateProfile(candidate.paths.browserProfileRoot, installationDefault(), candidate);
  }
  if (previous.paths.duoCredential !== candidate.paths.duoCredential) validateCredential(candidate);
  if (previous.paths.duoExtensionDir !== candidate.paths.duoExtensionDir) validateExtension(candidate.paths.duoExtensionDir);
}
