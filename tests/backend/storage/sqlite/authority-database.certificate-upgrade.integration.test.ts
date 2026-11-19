import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { prepareApplicationDataWorkspace } from "../../../../src/backend/app/composition/storage-compose.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { upgradeEvidenceSchemas } from "../../../../src/backend/storage/maintenance/evidence-schema-upgrade.js";
import { readFixedLayoutIntent } from "../../../../src/backend/storage/maintenance/fixed-layout.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { prepareStoppedBackupClosure } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { backupStoppedAuthority, upgradeReadyProfileStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { AuthorityEvidenceSchemaUpgradeRecordSchema } from "../../../../src/models/config/authority.js";
import { RunWorkbookReferenceSchema } from "../../../../src/models/dashboard/workbooks.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { evidenceSchemaSourceDigest } from "../../../../src/models/storage/evidence-schema-admission.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { readyBoundEight, hostFacts } from "../../../support/helpers/storage/ready-bound-upgrade.js";

it("authenticates a historical certificate after a forward upgrade and verifies its backup after a layout move", async () => {
  const fixture = await readyBoundEight("queued", 28, false, { owner: "terminal-run", schemaHash: deriveSchemaHash(RunWorkbookReferenceSchema, "output") });
  try {
    const operation = fixture.acquireRestore();
    const backup = await (async () => {
      try {
        const owner = await fixture.machine.forStoppedProfileUpgrade(profileBrowserClosure, fixture.claim, operation, systemClock, hostFacts);
        try {
          const closure = await prepareStoppedBackupClosure(profileBrowserClosure, owner, operation, systemClock, fixture.processLockRoot);
          const backed = await backupStoppedAuthority(closure, owner, fixture.stateRoot, systemClock, fixture.processLockRoot, operation, "schema-migration");
          assert.equal(backed.manifests.length, 1);
          const manifest = backed.manifests[0];
          assert.ok(manifest);
          return manifest;
        } finally { owner.release(); }
      } finally { operation.release(); }
    })();
    const native = new DatabaseSync(fixture.path);
    const run = (() => {
      try {
        const retained = runRecordFromRow(native.prepare("SELECT * FROM runs").get());
        const owner = { kind: "run-input" as const, id: retained.envelope.runId };
        const conversion = { id: "profile-name-domain", installationId: backup.installationId, profileId: backup.profileId,
          admissions: [{ owner, sourceSchemaHash: retained.input.parsed.schemaHash, currentSchemaHash: "e".repeat(64),
            sourceDigest: evidenceSchemaSourceDigest(owner, retained.input) }] };
        const upgradeId = backup.authorityContentFingerprint;
        const statement = AuthorityEvidenceSchemaUpgradeRecordSchema.omit({ evidenceSchemaMac: true }).parse({
          recordKey: randomUUID(), upgradeId, phase: "settled", fromSchemaVersion: 28, toSchemaVersion: 28,
          planDigest: sha256Hex(`relay:evidence-schema-conversion:v1\0${upgradeId}\0${canonicalJsonStringify(conversion)}`),
          evidenceSchemas: conversion, backup: { manifestPath: join(fixture.stateRoot, "backups", "authority", backup.backupFileName + ".manifest.json"),
            sha256: backup.sha256, authorityGeneration: backup.authorityGeneration }, by: LOCAL_OPERATOR_ACTOR_ID, recordedAt: systemClock.now().toISOString(),
        });
        const key = readFileSync(join(fixture.machine.stateRoot, "machine", "profile-pepper"));
        const evidenceSchemaMac = createHmac("sha256", key).update(`relay:evidence-schema-conversion-seal:v1\0${canonicalJsonStringify(statement)}`).digest("hex");
        const encoded = canonicalJsonStringify({ ...statement, evidenceSchemaMac });
        native.prepare("INSERT INTO database_upgrades VALUES(?,?,?,?,?,?)").run(statement.recordKey, upgradeId, "settled", backup.sha256, encoded, statement.recordedAt);
        return { owner, retained, encoded, recordKey: statement.recordKey };
      } finally { native.close(); }
    })();
    const result = await upgradeReadyProfileStorage(profileBrowserClosure, fixture.machine, fixture.claim, { plan: false, hostFacts }, systemClock);
    assert.equal(result.state, "upgraded");
    assert.equal(result.fromSchemaVersion, 28);
    const readback = new DatabaseSync(fixture.path, { readOnly: true });
    try { assert.equal(readback.prepare("SELECT payload_json FROM database_upgrades WHERE id=?").get(run.recordKey)?.payload_json, run.encoded); }
    finally { readback.close(); }
    const admission = fixture.machine.admitProfile(fixture.claim);
    try {
      const database = AuthorityDatabase.open(admission, { path: fixture.path, busyTimeoutMs: 250, migrationOwner: "certificate-readback" },
        systemClock, undefined, undefined, undefined, createCredentialStore({ admission, stateRoot: fixture.stateRoot }));
      try {
        const hash = (source: unknown) => database.evidenceSchemaHash(run.owner, source, run.retained.input.parsed.schemaHash, "e".repeat(64));
        assert.equal(hash(run.retained.input), "e".repeat(64));
        assert.throws(() => hash({}), /source-changed/u);
      } finally { database.close(); }
    } finally { admission.release(); }

    await fixture.closeController();
    const target = realpathSync(mkdtempSync(join(tmpdir(), "relay-certificates-layout-")));
    const lifetime = await RuntimeLifetimeLock.acquire(0);
    try {
      await prepareApplicationDataWorkspace(fixture.workspace, target, lifetime, hostFacts);
      assert.equal(readFixedLayoutIntent(target)?.phase, "complete");
      const machine = acquireEntrypointAdmission(target, "exclusive", lifetime);
      try {
        const stopped = machine.acquireOfflineMaintenance();
        try {
          const moved = machine.admitStoppedProfileSettingsUpgrade(fixture.claim, stopped);
          try {
            assert.equal(await upgradeEvidenceSchemas(moved, [], profileBrowserClosure, stopped, systemClock,
              join(target, ".tracker", "data", "locks")), "current");
            const copy = new DatabaseSync(join(moved.stateRoot, "state.db"), { readOnly: true });
            try { assert.equal(copy.prepare("SELECT payload_json FROM database_upgrades WHERE id=?").get(run.recordKey)?.payload_json, run.encoded); }
            finally { copy.close(); }
          } finally { moved.release(); }
        } finally { stopped.release(); }
      } finally { machine.release(); }
    } finally { await lifetime.close(); rmSync(target, { recursive: true, force: true }); }
  } finally { await fixture.close(); }
});
