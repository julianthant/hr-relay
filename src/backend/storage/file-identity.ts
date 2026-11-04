import { fstatSync, lstatSync, type Stats, type BigIntStats } from "node:fs";
import { lstat, type FileHandle } from "node:fs/promises";
import { WindowsPrivatePathError } from "./windows-private-path.js";

export interface DirectoryIdentity {
  readonly device: number | bigint;
  readonly inode: number | bigint;
}


export function sameDirectory(
  left: Readonly<{ device: number | bigint | string; inode: number | bigint | string }>,
  right: Readonly<{ device: number | bigint | string; inode: number | bigint | string }>,
): boolean {
  const exact = (a: number | bigint | string, b: number | bigint | string) => typeof a === typeof b ? a === b
    : typeof a === "number" ? Number.isSafeInteger(a) && BigInt(a) === BigInt(b)
    : typeof b === "number" ? Number.isSafeInteger(b) && BigInt(a) === BigInt(b) : BigInt(a) === BigInt(b);
  return exact(left.device, right.device) && exact(left.inode, right.inode);
}

export function privateFileNumber(value: number | bigint): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || (typeof value === "bigint" && BigInt(numeric) !== value)) {
    throw new WindowsPrivatePathError("unrepresentable-numeric-file-metadata");
  }
  return numeric;
}

export function numericFileIdentity(identity: DirectoryIdentity): { device: number; inode: number } {
  return { device: privateFileNumber(identity.device), inode: privateFileNumber(identity.inode) };
}

export function fileIdentityObservation(identity: DirectoryIdentity): { device: number | string; inode: number | string } {
  return { device: typeof identity.device === "bigint" ? identity.device.toString() : identity.device,
    inode: typeof identity.inode === "bigint" ? identity.inode.toString() : identity.inode };
}

export function fileStatus(path: string): Stats | BigIntStats;
export function fileStatus(path: string, missing: true): Stats | BigIntStats | undefined;
export function fileStatus(path: string, missing = false): Stats | BigIntStats | undefined {
  if (missing) return process.platform === "win32" ? lstatSync(path, { bigint: true, throwIfNoEntry: false }) : lstatSync(path, { throwIfNoEntry: false });
  return process.platform === "win32" ? lstatSync(path, { bigint: true }) : lstatSync(path);
}
export function descriptorStatus(descriptor: number): Stats | BigIntStats {
  return process.platform === "win32" ? fstatSync(descriptor, { bigint: true }) : fstatSync(descriptor);
}

export async function asyncFileStatus(path: string): Promise<Stats | BigIntStats> {
  return process.platform === "win32" ? lstat(path, { bigint: true }) : lstat(path);
}

export async function asyncDescriptorStatus(handle: FileHandle): Promise<Stats | BigIntStats> {
  return process.platform === "win32" ? handle.stat({ bigint: true }) : handle.stat();
}

export function fileModified(status: Stats | BigIntStats): number | bigint { return "mtimeNs" in status ? status.mtimeNs : status.mtimeMs; }
export function fileChanged(status: Stats | BigIntStats): number | bigint { return "ctimeNs" in status ? status.ctimeNs : status.ctimeMs; }
