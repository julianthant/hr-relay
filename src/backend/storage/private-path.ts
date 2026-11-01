import { closeSync, constants, fstatSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";
import { retainAuthoritySourceClosure } from "./source-closure.js";

export type PrivacyRule = "owner" | "ancestor" | "group-write" | "directory-0700" | "file-0600" | "file-0400" | "private" | "private-read-write" | "owner-write-only";

interface PathStat {
  readonly mode: number | bigint;
  readonly uid: number | bigint;
  readonly dev: number | bigint;
  readonly ino: number | bigint;
  isSymbolicLink(): boolean;
}

/** The SQLite observer executes this self-contained policy. */
export function privatePathRejects(_path: string, stat: PathStat, rule: PrivacyRule): boolean {
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
  writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
  fsyncPath(path);
}

export function replacePrivateFile(stage: string, path: string): void { renameSync(stage, path); }
