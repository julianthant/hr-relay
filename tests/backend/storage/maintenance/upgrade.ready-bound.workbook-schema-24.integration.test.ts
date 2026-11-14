import { replantOlderBuildAuthority } from "../../../support/fixtures/storage/older-build-authority.js";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { upgradeProfileAtStartup, upgradeReadyProfileStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { verifyStoppedBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { JsonValueSchema } from "../../../../src/rules/validation/canonical-json.js";
import { AuthorityUpgradeRecordSchema } from "../../../../src/models/config/authority.js";
import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { hostFacts, digest, readyBoundEight, rawEight, workbookFormats } from "../../../support/helpers/storage/ready-bound-upgrade.js";

it.each(workbookFormats.flatMap(format => (['run', 'terminal-run', 'plan', 'consumed-plan'] as const).map(owner => ({ ...format, owner }))))(
  'upgrades schema 24 $format $owner references through a verified historical backup and strict current readback', async ({ owner, schema, value }) => {
  const f = await readyBoundEight(owner.includes('run') ? 'queued' : 'idle', 24, false,
    { owner, schemaHash: deriveSchemaHash(schema, 'output'), value: JsonValueSchema.parse(schema.parse(value)) });
  try {
    const originalFingerprint = replantOlderBuildAuthority(f.path, 24);
    const before = rawEight(f.path, 24);
    const result = await (owner === 'run'
      ? upgradeProfileAtStartup(profileBrowserClosure, f.machine, f.claim, hostFacts, systemClock)
      : upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock));
    assert.deepEqual(result, { state: 'upgraded', fromSchemaVersion: 24, toSchemaVersion: 25, credentials: 'unchanged' });
    const after = rawEight(f.path, 25);
    for (const [table, rows] of Object.entries(before)) {
      if (table === 'database_states') assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, schema_version: 25 })));
      else if (table === 'database_upgrades') assert.deepEqual(after[table]?.slice(0, rows.length), rows);
      else assert.deepEqual(after[table], rows);
    }
    assert.deepEqual(after.workflow_workbook_selections, []);
    const settled = after.database_upgrades?.find(row => row.phase === 'settled');
    assert.ok(settled && typeof settled.payload_json === 'string');
    const record = AuthorityUpgradeRecordSchema.parse(JSON.parse(settled.payload_json));
    assert.ok(record.phase === 'settled');
    const manifests = readdirSync(join(f.stateRoot, "backups", "authority")).filter(name => name.endsWith(".manifest.json"));
    assert.equal(manifests.length, 1);
    const manifestName = manifests[0];
    assert.ok(manifestName);
    const manifest = AuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(join(f.stateRoot, "backups", "authority", manifestName), "utf8")));
    assert.equal(manifest.schemaVersion, 24);
    assert.equal(manifest.authorityContentFingerprint, originalFingerprint);
    assert.equal(manifest.sha256, digest(join(f.stateRoot, "backups", "authority", manifest.backupFileName)));
    assert.deepEqual(rawEight(join(f.stateRoot, "backups", "authority", manifest.backupFileName), 24), before);
    const fresh = f.machine.admitProfile(f.binding.profileId);
    try {
      const verified = verifyStoppedBackupManifestAtPath(fresh, join(f.stateRoot, "backups", "authority", manifestName));
      assert.equal(verified.manifest.schemaVersion, 24);
      assert.equal(verified.manifest.authorityContentFingerprint, originalFingerprint);
      const database = AuthorityDatabase.open(fresh, { path: f.path, busyTimeoutMs: 250, migrationOwner: 'selection-upgrade-readback' }, systemClock,
        undefined, undefined, undefined, createCredentialStore({ admission: fresh, stateRoot: f.stateRoot }));
      try { assert.equal(database.authority.workbooks.lastUsed('person-lookup'), undefined); }
      finally { database.close(); }
    } finally { fresh.release(); }
  } finally { await f.close(); }
});
