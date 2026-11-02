import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { assertRestoreRootMembership, restoreRetainedFilesDigest } from "../../../../src/backend/storage/maintenance/automatic-restore-files.js";

it("binds ordinary outputs and artifacts while admitting only the owned restore prefix", () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "automatic-restore-membership-")), operation = randomUUID();
  try {
    for (const name of ["credentials", "files", "artifacts"]) mkdirSync(join(root, name), { mode: 0o700 });
    writeFileSync(join(root, "state.db"), "source", { mode: 0o600 });
    writeFileSync(join(root, "files", "document.txt"), "retained", { mode: 0o600 });
    const before = restoreRetainedFilesDigest(root);
    writeFileSync(join(root, `.restore-${operation}.sqlite.tmp`), "stage", { mode: 0o600 });
    assert.doesNotThrow(() => assertRestoreRootMembership(root, operation));
    assert.equal(restoreRetainedFilesDigest(root), before);
    writeFileSync(join(root, "files", "document.txt"), "changed");
    assert.notEqual(restoreRetainedFilesDigest(root), before);
    writeFileSync(join(root, `.restore-${randomUUID()}.sqlite.tmp`), "unowned", { mode: 0o600 });
    assert.throws(() => assertRestoreRootMembership(root, operation), /membership-unknown/u);
  } finally { rmSync(root, { recursive: true }); }
});

it.each(["symlink", "public-file"] as const)("refuses unsafe %s retained evidence", mutation => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "automatic-restore-private-"));
  try {
    mkdirSync(join(root, "files"), { mode: 0o700 });
    const path = join(root, "files", "document.txt");
    if (mutation === "symlink") symlinkSync(join(root, "missing"), path);
    else { writeFileSync(path, "private", { mode: 0o600 }); chmodSync(path, 0o666); }
    assert.throws(() => restoreRetainedFilesDigest(root));
  } finally { rmSync(root, { recursive: true }); }
});
