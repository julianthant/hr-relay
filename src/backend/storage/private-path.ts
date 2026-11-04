import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, writeFileSync, type BigIntStats } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { assertWindowsNoReparse, assertWindowsPrivateParent, createWindowsPrivateDirectory, flushWindowsPath, windowsPrivatePathRejects } from "./windows-private-path.js";
import { retainAuthoritySourceClosure } from "./source-closure.js";

export type PrivacyRule = "owner" | "ancestor" | "group-write" | "directory-0700" | "file-0600" | "file-0400" | "private" | "private-read-write" | "owner-write-only";

export interface PathStat {
  readonly mode: number | bigint;
  readonly uid: number | bigint;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  isSymbolicLink(): boolean;
}

export function privatePathRejects(path: string, stat: PathStat, rule: PrivacyRule): boolean {
  if (process.platform === "win32") return windowsPrivatePathRejects(path, stat, rule);
  return posixPrivatePathRejects(path, stat, rule);
}

export function posixPrivatePathRejects(_path: string, stat: PathStat, rule: PrivacyRule): boolean {
  if (stat.isSymbolicLink() || typeof process.getuid !== "function") return true;
  const owner = BigInt(stat.uid), current = BigInt(process.getuid());
  const mode = Number(stat.mode);
  if (rule === "ancestor") {
    return (owner !== current && owner !== 0n) || ((mode & 0o022) !== 0 && (mode & 0o1000) === 0);
  }
  if (owner !== current) return true;
  if (rule === "owner") return false;
  if (rule === "group-write") return (mode & 0o022) !== 0;
  if (rule === "private-read-write") return (mode & 0o077) !== 0 || (mode & 0o600) !== 0o600;
  if (rule === "private") return (mode & 0o077) !== 0;
  if (rule === "file-0400") return (mode & 0o7777) !== 0o400;
  if (rule === "directory-0700") return (mode & 0o7777) !== 0o700;
  if (rule === "file-0600") return (mode & 0o7777) !== 0o600;
  return (mode & 0o222) !== 0o200;
}

export function fsyncPath(path: string): void {
  if (process.platform === "win32") { flushWindowsPath(path); return; }
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let primary: { error: unknown } | undefined;
  let descriptorIdentity: ReturnType<typeof fstatSync> | undefined;
  try { descriptorIdentity = fstatSync(descriptor); fsyncSync(descriptor); }
  catch (error) { primary = { error }; }
  try { closeSync(descriptor); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
    { descriptor: { descriptor, ...(descriptorIdentity === undefined ? {} : { identity: descriptorIdentity }) } }); }
  if (primary !== undefined) throw primary.error;
}

export function writePrivateStage(path: string, bytes: Uint8Array): void {
  if (process.platform === "win32") {
    assertWindowsPrivateParent(dirname(path));
    const descriptor = openSync(path, "wx", 0o600);
    let primary: { error: unknown } | undefined;
    let identity: BigIntStats | undefined;
    try {
      identity = fstatSync(descriptor, { bigint: true });
      if (privatePathRejects(path, fstatSync(descriptor, { bigint: true }), "file-0600")) throw new Error("private-stage-unsafe");
      writeFileSync(descriptor, bytes); fsyncSync(descriptor);
    } catch (error) { primary = { error }; }
    try { closeSync(descriptor); }
    catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
      { descriptor: { descriptor, ...(identity === undefined ? {} : { identity }) } }); }
    if (primary !== undefined) throw primary.error;
    return;
  }
  writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
  fsyncPath(path);
}

export function replacePrivateFile(stage: string, path: string): void { renameSync(stage, path); }

let exclusiveDirectoryMove: ((source: string, target: string, flags: number) => unknown) | undefined;
export function movePrivateDirectoryExclusive(source: string, target: string): void {
  if (process.platform !== "darwin") throw new Error("private-directory-exclusive-move-unavailable");
  if (exclusiveDirectoryMove === undefined) {
    const native: unknown = createRequire(import.meta.url)("koffi");
    if (typeof native !== "object" || native === null || !("version" in native) || native.version !== "3.3.6"
      || !("load" in native) || typeof native.load !== "function") throw new Error("private-directory-native-bridge-unavailable");
    const library: unknown = Reflect.apply(native.load, native, ["/usr/lib/libSystem.B.dylib"]);
    if (typeof library !== "object" || library === null || !("func" in library) || typeof library.func !== "function") throw new Error("private-directory-native-bridge-unavailable");
    const move: unknown = Reflect.apply(library.func, library, ["int renamex_np(const char *source, const char *target, unsigned int flags)"]);
    if (typeof move !== "function") throw new Error("private-directory-native-bridge-unavailable");
    exclusiveDirectoryMove = (from, to, flags): unknown => Reflect.apply(move, library, [from, to, flags]);
  }
  if (exclusiveDirectoryMove(source, target, 0x00000004) !== 0) throw new Error("private-directory-exclusive-move-refused");
}

export function assertNoReparsePath(path: string): void {
  if (process.platform === "win32") { assertWindowsNoReparse(path); return; }
  if (lstatSync(path).isSymbolicLink()) throw new Error("private-path-reparse-refused");
}

export function createPrivateDirectory(path: string, options: { recursive?: boolean; mode: number }): void {
  if (process.platform !== "win32") { mkdirSync(path, options); return; }
  const existing = lstatSync(path, { bigint: true, throwIfNoEntry: false });
  if (existing !== undefined) {
    assertNoReparsePath(path);
    if (options.recursive) {
      if (!existing.isDirectory() || windowsPrivatePathRejects(path, existing, "directory-0700")) throw new Error("private-directory-unsafe");
      return;
    }
    throw Object.assign(new Error("private-directory-already-exists"), { code: "EEXIST" });
  }
  const parent = dirname(path);
  if (options.recursive && lstatSync(parent, { throwIfNoEntry: false }) === undefined) createPrivateDirectory(parent, options);
  createWindowsPrivateDirectory(path);
}
