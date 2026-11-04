import { lstatSync, fstatSync, readlinkSync, type BigIntStats } from "node:fs";
import { sep } from "node:path";
import { vi } from "vitest";
import * as identities from "../../../src/backend/storage/file-identity.js";

export function forceExactFileMetadata(root: string) {
  const status = identities.fileStatus, descriptor = identities.descriptorStatus;
  const asyncStatus = identities.asyncFileStatus, asyncDescriptor = identities.asyncDescriptorStatus;
  const owns = (path: string) => path === root || path.startsWith(`${root}${sep}`);
  const exact = (info: BigIntStats) => { info.ino += 1n << 54n; return info; };
  vi.spyOn(identities, "fileStatus").mockImplementation((path, missing?: true) => {
    if (!owns(path)) return missing ? status(path, true) : status(path);
    const info = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    if (info === undefined && !missing) return exact(lstatSync(path, { bigint: true }));
    return info === undefined ? undefined : exact(info);
  });
  vi.spyOn(identities, "descriptorStatus").mockImplementation(fd => owns(readlinkSync(`/proc/self/fd/${fd}`)) ? exact(fstatSync(fd, { bigint: true })) : descriptor(fd));
  vi.spyOn(identities, "asyncFileStatus").mockImplementation(async path => owns(path) ? exact(lstatSync(path, { bigint: true })) : asyncStatus(path));
  vi.spyOn(identities, "asyncDescriptorStatus").mockImplementation(async handle => owns(readlinkSync(`/proc/self/fd/${handle.fd}`)) ? exact(fstatSync(handle.fd, { bigint: true })) : asyncDescriptor(handle));
  return () => vi.restoreAllMocks();
}
