import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { backupThreadIdle, copyAuthorityOffThread, inspectAuthorityBackupOffThread } from "../../../../src/backend/storage/sqlite/backup-inspection-worker.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function liveStore() {
  const bound = await createBoundProfileFixture();
  const database = AuthorityDatabase.open(bound.admission, { path: bound.path, busyTimeoutMs: 250, migrationOwner: "off-thread-copy" },
    undefined, undefined, undefined, undefined, boundProfileCredentials(bound.admission));
  cleanups.push(async () => { database.close(); await bound.close(); });
  const directory = join(bound.stateRoot, "backups", "authority");
  return { bound, database, directory, destination: join(directory, `.authority-${"0".repeat(8)}-0000-0000-0000-${"0".repeat(12)}.sqlite.tmp`) };
}

describe("off-thread authority copy", () => {
  it("copies a live open store into a file that inspects at the live generation", async () => {
    const { bound, database, directory, destination } = await liveStore();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    await copyAuthorityOffThread(bound.admission, bound.path, destination, {});
    const copyAdmission = bound.admission.verifiedReadOnlyCopy(destination, createHash("sha256").update(readFileSync(destination)).digest("hex"));
    try {
      const inspection = await inspectAuthorityBackupOffThread(copyAdmission, destination, database.getMeta().schemaVersion);
      expect(inspection.authorityGeneration).toBe(database.getMeta().authorityGeneration);
    } finally { copyAdmission.release(); }
  });

  it("rejects an aborted copy and lets the worker thread exit", async () => {
    const { bound, directory, destination } = await liveStore();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const controller = new AbortController();
    const copy = copyAuthorityOffThread(bound.admission, bound.path, destination, { signal: controller.signal });
    controller.abort(new DOMException("stopped", "AbortError"));
    await expect(copy).rejects.toMatchObject({ name: "AbortError" });
    await expect(backupThreadIdle()).resolves.toBeUndefined();
    expect(existsSync(`${destination}-wal`)).toBe(false);
  });
});
