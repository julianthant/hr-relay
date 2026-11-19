import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { AuthorityDatabase, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { parseBackupManifestFile } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { insertNativeCommand, settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { NotificationCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { assertAssistantHistoryRetirable } from "../../../../src/backend/storage/sqlite/assistant-grant-retirement.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
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

it("repairs a missing search projection for a populated stopped predecessor before its schema upgrade", async () => {
  const f = await readyBoundEight("queued", 12);
  try {
    const raw = new DatabaseSync(f.path);
    let generation: number;
    try {
      generation = inspectNativeAuthority(raw, 12).authorityGeneration;
      raw.exec("DROP TABLE run_search");
    } finally { raw.close(); }
    const operation = f.acquireRestore();
    try {
      const owner = f.machine.admitStoppedProfileRepair(f.claim, operation);
      try {
        assert.equal(AuthorityDatabase.classifyStartupFailure(f.machine, f.claim).kind, "missing-run-search-projection");
        AuthorityDatabase.repairMissingRunSearchProjection(owner, operation, systemClock);
      } finally { owner.release(); }
      const inspection = AuthorityDatabase.inspectRegisteredPersonAtStartup(f.machine, f.claim);
      assert.equal(inspection.schemaVersion, 12);
      assert.equal(inspection.authorityGeneration, generation);
      const repaired = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(repaired.prepare("SELECT count(*) AS count FROM run_search").get()?.count, 1);
        assert.equal(createRunSearchIndex(repaired).publication().state, "published");
      } finally { repaired.close(); }
    } finally { operation.release(); }
  } finally { await f.close(); }
});

it("retires an audited settled legacy action into its verified pre-upgrade backup", async () => {
  const fixture = await readyBoundEight("idle", 28);
  try {
    const chatId = randomUUID(), id = randomUUID(), auditId = randomUUID();
    const at = "2026-10-21T12:00:00.000Z", expiresAt = "2026-10-21T13:00:00.000Z";
    const command = NotificationCommandRequestSchema.options[0].parse({ commandId: randomUUID(), requestedAt: at, requestedBy: "local-operator", source: "assistant",
      family: "notification", type: "notification-read", target: { notificationId: randomUUID(), actorId: "local-operator", expectedVersion: 1 } });
    const chat = { id: chatId, profileId: fixture.claim, epoch: 1, createdAt: at, expiresAt };
    const result = { state: "applied", commandId: command.commandId, affectedTargets: [{ family: "notification", notificationId: command.target.notificationId }] };
    const audit = { auditId, request: command, result, completedAt: at, versionChanges: [], affectedDependencyIds: [] };
    const action = { id, chatId, manifest: { revision: 1, entries: [] },
      binding: { profileId: chat.profileId, accountSessionEpoch: chat.epoch, manifestRevision: 1, family: command.family, action: command.type,
        classification: "local-write", commandId: command.commandId, target: command.target, subject: { kind: "none" }, options: { kind: "none" },
        configDescriptor: { kind: "none" }, grantId: randomUUID(), policyRevision: 1, mode: "every-action" },
      command, plan: null, revision: 4, state: "settled", result, createdAt: at, expiresAt };
    const source = new DatabaseSync(fixture.path);
    try {
      insertNativeCommand(source, command);
      settleNativeCommand(source, audit);
      source.prepare("INSERT INTO command_audits VALUES (?,?,NULL,?,?)").run(auditId, command.commandId, canonicalJsonStringify(audit), at);
      source.prepare("INSERT INTO assistant_chats VALUES (?,?,?,?,?,?)").run(chatId, chat.profileId, chat.epoch, canonicalJsonStringify(chat), at, expiresAt);
      const insert = source.prepare("INSERT INTO assistant_actions VALUES (?,?,?,?,?,?,?,?)");
      for (const state of ["claimed", "unknown", "settled"] as const) {
        source.exec("SAVEPOINT unproved");
        const unproved = { ...action, state, result: state === "settled" ? { ...result, state: "already-applied" } : null };
        insert.run(id, chatId, command.commandId, 4, state, canonicalJsonStringify(unproved), at, expiresAt);
        assert.throws(() => assertAssistantHistoryRetirable(source, nativeOrdinaryRecordFromRow), /assistant-grant-history-unsupported/u);
        source.exec("ROLLBACK TO unproved; RELEASE unproved");
      }
      insert.run(id, chatId, command.commandId, 4, "settled", canonicalJsonStringify(action), at, expiresAt);
    } finally { source.close(); }
    assert.equal((await upgradeReadyProfileStorage(profileBrowserClosure, fixture.machine, fixture.claim, { plan: false, hostFacts }, systemClock)).state, "upgraded");
    const current = new DatabaseSync(fixture.path, { readOnly: true });
    try {
      assert.equal(current.prepare("SELECT id FROM assistant_actions WHERE id=?").get(id), undefined);
      assert.ok(current.prepare("SELECT id FROM command_audits WHERE id=?").get(auditId));
      const row = current.prepare("SELECT json_extract(payload_json,'$.backup.manifestPath') AS manifest FROM database_upgrades WHERE phase='settled'").get();
      assert.ok(row && typeof row.manifest === "string");
      const manifest = parseBackupManifestFile(row.manifest);
      const backup = new DatabaseSync(join(dirname(row.manifest), manifest.backupFileName), { readOnly: true });
      try { assert.equal(backup.prepare("SELECT payload_json FROM assistant_actions WHERE id=?").get(id)?.payload_json, canonicalJsonStringify(action)); }
      finally { backup.close(); }
    } finally { current.close(); }
  } finally { await fixture.close(); }
});
