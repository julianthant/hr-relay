import { lstatSync, fstatSync, readlinkSync, type BigIntStats } from "node:fs";
import { sep } from "node:path";
import { vi } from "vitest";
import * as identities from "../../../src/backend/storage/file-identity.js";

export function forceExactFileMetadata(root: string, observe?: (path: string, info: BigIntStats, source: "path" | "descriptor") => void) {
  const status = identities.fileStatus, descriptor = identities.descriptorStatus;
  const asyncStatus = identities.asyncFileStatus, asyncDescriptor = identities.asyncDescriptorStatus;
  const owns = (path: string) => path === root || path.startsWith(`${root}${sep}`);
  const observations: { path: string; source: "path" | "descriptor"; inode: bigint }[] = [];
  const exact = (path: string, info: BigIntStats, source: "path" | "descriptor") => {
    info.ino = (1n << 54n) + (info.ino << 2n);
    observe?.(path, info, source);
    observations.push({ path, source, inode: info.ino });
    return info;
  };
  vi.spyOn(identities, "fileStatus").mockImplementation((path, missing?: true) => {
    if (!owns(path)) return missing ? status(path, true) : status(path);
    const info = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (info === undefined && !missing) return exact(path, lstatSync(path, { bigint: true }), "path");
    return info === undefined ? undefined : exact(path, info, "path");
  });
  vi.spyOn(identities, "descriptorStatus").mockImplementation(fd => {
    const path = readlinkSync(`/proc/self/fd/${fd}`);
    return owns(path) ? exact(path, fstatSync(fd, { bigint: true }), "descriptor") : descriptor(fd);
  });
  vi.spyOn(identities, "asyncFileStatus").mockImplementation(async path => owns(path) ? exact(path, lstatSync(path, { bigint: true }), "path") : asyncStatus(path));
  vi.spyOn(identities, "asyncDescriptorStatus").mockImplementation(async handle => {
    const path = readlinkSync(`/proc/self/fd/${handle.fd}`);
    return owns(path) ? exact(path, fstatSync(handle.fd, { bigint: true }), "descriptor") : asyncDescriptor(handle);
  });
  return Object.assign(() => vi.restoreAllMocks(), { observations });
}
