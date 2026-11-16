import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { forceExactFileMetadata } from "../../../support/helpers/exact-file-metadata.js";
import { inventoryFileIdentity } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { scanProfileCredentialCopy } from "../../../../src/backend/app/composition/profile-credential-inventory.js";

it.skipIf(process.platform !== "linux")("inventories and scans a credential copy with exact high file IDs", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "credential-copy-exact-"))), path = join(root, "copy");
  const bytes = Buffer.from("synthetic private value"); writeFileSync(path, bytes, { mode: 0o600 });
  const restore = forceExactFileMetadata(root);
  try {
    const observed = inventoryFileIdentity(path);
    assert.equal(typeof observed.inode, "string"); assert.ok(BigInt(observed.inode) > 2n ** 53n);
    assert.deepEqual(scanProfileCredentialCopy(path, ["private value"]), { digest: createHash("sha256").update(bytes).digest("hex"), containsSecret: true });
  } finally { restore(); rmSync(root, { recursive: true }); }
});
