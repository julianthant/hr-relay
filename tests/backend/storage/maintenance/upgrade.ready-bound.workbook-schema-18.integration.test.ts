import { assertUpgradedRunSettlementRows } from "../../../support/fixtures/storage/historical-run-schema.js";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { upgradeProfileAtStartup, upgradeReadyProfileStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../../../../src/backend/storage/sqlite/migrations.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { hostFacts, PRE_BUILD_RUN_TABLES, digest, readyBoundEight, rawEight, workbookFormats } from "../../../support/helpers/storage/ready-bound-upgrade.js";

it.each(workbookFormats.flatMap(format => (["run", "terminal-run", "plan", "consumed-plan"] as const).map(owner => ({ ...format, owner }))))(
  "upgrades schema 18 with compatible $format $owner references, tombstoning pre-build runs", async ({ owner, schema, value }) => {
  const f = await readyBoundEight(owner.includes("run") ? "queued" : "idle", 18, false,
    { owner, schemaHash: deriveSchemaHash(schema, "output"), value: JsonValueSchema.parse(schema.parse(value)) });
  try {
    const before = rawEight(f.path, 18);
    const upgraded = await (owner === "run"
      ? upgradeProfileAtStartup(profileBrowserClosure, f.machine, f.claim, hostFacts, systemClock)
      : upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock));
    assert.equal(upgraded.state, "upgraded");
    const manifests = readdirSync(join(f.stateRoot, "backups", "authority")).filter(name => name.endsWith(".manifest.json"));
    assert.equal(manifests.length, 1);
    const manifestName = manifests[0];
    assert.ok(manifestName);
    const manifest = AuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(join(f.stateRoot, "backups", "authority", manifestName), "utf8")));
    assert.equal(manifest.schemaVersion, 18);
    assert.equal(manifest.sha256, digest(join(f.stateRoot, "backups", "authority", manifest.backupFileName)));
    assert.deepEqual(rawEight(join(f.stateRoot, "backups", "authority", manifest.backupFileName), 18), before);
    const after = rawEight(f.path, 18), runOwned = owner.includes("run");
    if (runOwned) {
      assert.deepEqual([after.runs ?? [], after.run_results ?? [], after.run_receipts ?? []], [[], [], []]);
      assert.deepEqual((after.deleted_runs ?? []).map(row => [row.run_id, row.cleanup_state]).sort(), (before.runs ?? []).map(row => [row.id, "pending"]).sort());
    }
    for (const [table, rows] of Object.entries(before)) {
      if (runOwned && (PRE_BUILD_RUN_TABLES.has(table) || table === "run_results" || table === "run_receipts")) continue;
      if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "database_upgrades") assert.deepEqual(after[table]?.slice(0, rows.length), rows);
      else if (table === "run_results" || table === "run_receipts") assertUpgradedRunSettlementRows(table, after[table] ?? [], before);
      else assert.deepEqual(after[table], rows, table);
    }
  } finally { await f.close(); }
});
