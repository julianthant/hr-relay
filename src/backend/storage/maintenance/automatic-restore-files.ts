import { fileStatus, privateFileNumber } from "../file-identity.js";
import { lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { hash, inventory } from "./existing-data-backup-files.js";
import { privatePathRejects } from "../private-path.js";

export function restoreRetainedFilesDigest(root: string): string {
  return hash(Buffer.from(canonicalJsonStringify(["credentials", "files", "artifacts", "logs"].flatMap(name => {
    const path = join(root, name), metadata = lstatSync(path, { throwIfNoEntry: false });
    return metadata === undefined ? [] : inventory(path, name).map(row => row.file);
  }))));
}

export function assertRestoreRootMembership(root: string, operationId: string): void {
  const directories = new Set(["browsers", "credentials", "backups", "artifacts", "logs", "scratch", "files"]);
  const stage = `.restore-${operationId}.sqlite.tmp`;
  const files = new Set(["state.db", "state.db-wal", "state.db-shm", stage, `${stage}-wal.live-companion`, `${stage}-shm.live-companion`]);
  for (const name of readdirSync(root)) {
    const path = join(root, name), metadata = fileStatus(path);
    if (metadata.isSymbolicLink() || privatePathRejects(path, metadata, "group-write")
      || (metadata.isDirectory() ? !directories.has(name) : !metadata.isFile() || privateFileNumber(metadata.nlink) !== 1 || !files.has(name))) throw new Error("automatic-restore-root-membership-unknown");
  }
}
