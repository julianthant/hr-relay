import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { withAuthorityBuildVariant } from "../../../../../support/fixtures/authority-build-variant.js";
import { SQLITE_MIGRATIONS, AUTHORITY_APPLICATION_ID, databaseStateTable } from "../../../../../../src/backend/storage/sqlite/migrations.js";

it.each([27, 28, 29] as const)("negative control: live-DDL-derived lists reject the admitted v%s fixture", async version => {
  const root = mkdtempSync(join(tmpdir(), "m21-build-variant-"));
  const path = join(root, `m21-derived-v${String(version)}.sqlite`);
  const now = "2026-07-31T17:00:00.000Z";
  const raw = new DatabaseSync(path);
  try {
    for (const migration of SQLITE_MIGRATIONS.filter(migration => migration.version <= version)) {
      for (const statement of migration.statements) raw.exec(statement);
    }
    raw.prepare(`INSERT INTO ${databaseStateTable(version)} (singleton_id,schema_version,authority_generation,updated_at) VALUES (1,?,0,?)`).run(version, now);
    raw.exec(`PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA user_version=${String(version)}`);
  } finally { raw.close(); }
  try {
    const { AuthorityDatabase } = await import("../../../../../../src/backend/storage/sqlite/authority-database.js");
    const { RuntimeAdmission } = await import("../../../../../../src/backend/storage/admission/admission.js");
    const { manualClock } = await import("../../../../../../src/rules/time/clock.js");
    const admitted = AuthorityDatabase.open(RuntimeAdmission.syntheticFixture(path), {
      path, busyTimeoutMs: 250, migrationOwner: "m21-negative-control", openMode: "storage-upgrade-preflight-read-only-no-migrate",
    }, manualClock(new Date(now)));
    assert.equal(admitted.getMeta().schemaVersion, version);
    admitted.close();
    const before = readFileSync(path);
    await withAuthorityBuildVariant("ddl-derived-layouts", async () => {
      const { AuthorityDatabase: brokenBuild } = await import("../../../../../../src/backend/storage/sqlite/authority-database.js");
      const { RuntimeAdmission: variantAdmission } = await import("../../../../../../src/backend/storage/admission/admission.js");
      const { manualClock: variantClock } = await import("../../../../../../src/rules/time/clock.js");
      assert.throws(() => brokenBuild.open(variantAdmission.syntheticFixture(path, "authority"), {
        path, busyTimeoutMs: 250, migrationOwner: "m21-negative-control", openMode: "storage-upgrade-preflight-read-only-no-migrate",
      }, variantClock(new Date(now))), new RegExp(`divergent post-v18 migration suffix: DCC1 v${String(version)}`, "u"));
    });
    assert.deepEqual(readFileSync(path), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
