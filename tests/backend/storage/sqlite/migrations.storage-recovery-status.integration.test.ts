import assert from "node:assert/strict";
import { dirname,join } from "node:path";
import { it } from "vitest";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { AuthorityDatabase,AuthorityBackupService,doctorAuthorityStorage } from "../../../support/helpers/synthetic-storage-admission.js";

function options(root: string) {
  return { stateRootTrustAnchor: dirname(root), stateRoot: root, authorityPath: join(root, "state.db"),
    backupDirectory: join(root, "backups", "authority"), busyTimeoutMs: 500 };
}

it("distinguishes byte verification from current release eligibility", async () => {
  const f = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-09-10T20:00:00Z"));
  try {
    AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "current-eligibility" }, clock).close();
    const database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 500, migrationOwner: "current-backup" }, clock);
    try { await new AuthorityBackupService(database, { directory: join(f.stateRoot, "backups", "authority") }, clock)
      .request({ trigger: "operator", requiredGeneration: database.getMeta().authorityGeneration }); }
    finally { database.close(); }
    const report = await doctorAuthorityStorage(options(f.stateRoot), clock);
    assert.equal(report.recovery.state, "clear");
    const candidate = report.restoreCandidates[0];
    assert.ok(candidate?.state === "verified-compatible");
    assert.equal(candidate.schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.equal(candidate.restoreEligibility.state, "eligible");
  } finally { await f.close(); }
});
