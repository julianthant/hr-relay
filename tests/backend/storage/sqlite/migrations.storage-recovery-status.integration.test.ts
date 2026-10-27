import assert from "node:assert/strict";
import { dirname,join } from "node:path";
import { it } from "vitest";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { storageRecoveryFixture } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { AuthorityDatabase,doctorAuthorityStorage } from "../../../support/helpers/synthetic-storage-admission.js";

function options(root: string) {
  return { stateRootTrustAnchor: dirname(root), stateRoot: root, authorityPath: join(root, "state.db"),
    backupDirectory: join(root, "backups", "authority"), busyTimeoutMs: 500 };
}

it("distinguishes byte verification from current release eligibility", async () => {
  const f = await storageRecoveryFixture();
  try {
    AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "current-eligibility" }, f.clock).close();
    await f.backup();
    const report = await doctorAuthorityStorage(options(f.root), f.clock);
    assert.equal(report.recovery.state, "clear");
    const candidate = report.restoreCandidates[0];
    assert.ok(candidate?.state === "verified-compatible");
    assert.equal(candidate.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(candidate.restoreEligibility.state, "eligible");
  } finally { await f.dispose(); }
});
