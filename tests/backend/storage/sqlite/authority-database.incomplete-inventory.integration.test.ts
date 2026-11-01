import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { z } from "zod";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createSettingsActivationRepositories } from "../../../../src/backend/storage/sqlite/settings-activation.js";
import { commandFromRow, insertNativeCommand, settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { createHistoricalIncompleteProfileFixture } from "../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";
import { COMMAND_FIXTURES, CONFIG_SNAPSHOT, WRITE_INTENT_ATTEMPTING } from "../../../support/fixtures/phase1c-contract-fixtures.js";

import { AuthorityDatabase, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { AppSettingsSchema } from "../../../../src/models/config/app-settings.js";
import { CommandAuditRecordSchema, CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { RunSessionRecordSchema } from "../../../../src/models/run/session.js";
import { DeletedRunRecordSchema } from "../../../../src/models/run/deleted-run.js";
import { RUN_SESSION, QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createWorkbookLibraryRepository } from "../../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { createWorkbookLibraryService } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

import { WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { WorkerControlRecordSchema } from "../../../../src/models/run/worker-control.js";
import { DiagnosticBundleSchema } from "../../../../src/models/trust/diagnostic.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";

import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";

type Fixture = Awaited<ReturnType<typeof createHistoricalIncompleteProfileFixture>>;
function initialize(database: DatabaseSync, repeat = true) {
  const repositories = createSettingsActivationRepositories({ database,
    mutate(work) {
      database.exec("BEGIN IMMEDIATE");
      try { const result = work(); database.exec("COMMIT"); return result.result; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    },
    readRecord(table, key, schema) {
      const raw = database.prepare(`SELECT * FROM ${table} WHERE id=?`).get(key);
      if (raw === undefined) return undefined;
      return schema.parse(table === "commands" ? commandFromRow(raw) : nativeOrdinaryRecordFromRow(table, raw));
    },
  });
  const initial = ConfigSnapshotRecordSchema.parse({ ...CONFIG_SNAPSHOT, configSnapshotId: randomUUID() });
  repositories.runtimeConfig.initialize(initial);
  if (!repeat) return { initial, active: initial, repositories };
  const active = ConfigSnapshotRecordSchema.parse({ ...initial, configSnapshotId: randomUUID(), capturedAt: "2026-07-31T17:01:00.000Z" });
  database.prepare("INSERT INTO settings_snapshots(id,revision,fingerprint,payload_json,captured_at) VALUES(?,?,?,?,?)")
    .run(active.configSnapshotId, active.revision, active.fingerprint, JSON.stringify(active), active.capturedAt);
  repositories.runtimeConfig.activate({ settingsRevision: 1, settingsFingerprint: repositories.runtimeConfig.get()?.settingsFingerprint,
    configSnapshotId: active.configSnapshotId, configFingerprint: active.fingerprint, activatedAt: active.capturedAt });
  return { initial, active, repositories };
}
function corruptFixture(database: DatabaseSync, sql: string, ...values: (string | number | null)[]) {
  const triggers = z.array(z.object({ name: z.string(), sql: z.string() })).parse(database.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('commands','settings_snapshots','deleted_runs')").all());
  for (const trigger of triggers) database.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
  try { database.prepare(sql).run(...values); }
  finally { for (const trigger of triggers) database.exec(trigger.sql); }
}
async function reclassify(f: Fixture): Promise<void> {
  const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
  try { await machine.reclassifyIncompleteProfileAsDraft(f.profileId); }
  finally { machine.release(); }
}
for (const repeat of [false, true]) it(`prepares production settings initialization with repeat activation ${repeat} without changing authority`, async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  try {
    const database = new DatabaseSync(f.databasePath);
    try { initialize(database, repeat); } finally { database.close(); }
    const before = [f.databasePath, f.registryPath, f.keyPath, f.protectedPath].map(path => readFileSync(path));
    const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
    const child = machine.forStoppedIncompleteProfileInventory(f.profileId);
    try { assert.equal(AuthorityDatabase.readIncompleteOnboardingInventory(child).empty, true); }
    finally { child.release(); machine.release(); }
    assert.deepEqual([f.databasePath, f.registryPath, f.keyPath, f.protectedPath].map(path => readFileSync(path)), before);
  } finally { await f.close(); }
});

it("keeps initialization counts visible and uses the same eligibility for stopped withdrawal", async () => {
  const f = await createHistoricalIncompleteProfileFixture();
  try {
    const database = new DatabaseSync(f.databasePath);
    try { initialize(database); } finally { database.close(); }
    const before = readFileSync(f.databasePath);
    const machine = RuntimeAdmission.acquireStoppedMachineControlMaintenance(f.workspace, f.lifetime);
    try {
      const child = machine.forStoppedIncompleteProfileInventory(f.profileId);
      try {
        const inventory = AuthorityDatabase.readIncompleteOnboardingInventory(child);
        assert.equal(inventory.empty, true);
        assert.equal(inventory.counts.length, 39);
        for (const [table, count] of [["commands", 1], ["command_audits", 1], ["settings", 1], ["settings_snapshots", 2]] as const) {
          assert.equal(inventory.counts.find(row => row.table === table)?.count, count);
        }
        assert.equal(inventory.artifactReferenceCount, 0);
      } finally { child.release(); }
      await machine.reclassifyIncompleteProfileAsDraft(f.profileId);
      assert.equal(machine.readProfileRegistry().profiles.length, 0);
    } finally { machine.release(); }
    assert.deepEqual(readFileSync(f.databasePath), before);
  } finally { await f.close(); }
});

for (const problem of ["operator-command", "operator-audit", "extra-audit", "command-parent", "command-unfinished", "command-outcome", "saved-settings", "missing-settings",
  "advanced-snapshot", "unbound-snapshot", "intermediate-startup", "snapshot-fingerprint", "snapshot-native-column", "snapshot-schema", "initial-snapshot-binding", "active-snapshot-time", "active-generation"] as const) {
  it(`refuses initialization inventory with ${problem} without rewriting authority`, async () => {
    const f = await createHistoricalIncompleteProfileFixture();
    try {
      const database = new DatabaseSync(f.databasePath);
      try {
        const { initial, active, repositories } = initialize(database);
        const app = AppSettingsSchema.parse(JSON.parse(z.object({ payload_json: z.string() }).parse(database.prepare("SELECT payload_json FROM settings").get()).payload_json));
        if (problem === "operator-command" || problem === "operator-audit") {
          const request = CommandRequestSchema.parse(COMMAND_FIXTURES[1]); insertNativeCommand(database, request);
          if (problem === "operator-audit") {
            const audit = CommandAuditRecordSchema.parse({ auditId: randomUUID(), request, result: { state: "conflict", commandId: request.commandId, currentVersion: 1, message: "fixture conflict" }, completedAt: initial.capturedAt, versionChanges: [], affectedDependencyIds: [] });
            database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,NULL,?,?)")
              .run(audit.auditId, request.commandId, JSON.stringify(audit), audit.completedAt);
            settleNativeCommand(database, audit);
          }
          inspectNativeAuthority(database);
        }
        if (problem === "extra-audit") {
          const raw = z.object({ payload_json: z.string() }).parse(database.prepare("SELECT payload_json FROM command_audits").get());
          const audit = z.object({ auditId: z.string() }).passthrough().parse(JSON.parse(raw.payload_json)); audit.auditId = randomUUID();
          database.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,NULL,?,?)")
            .run(audit.auditId, app.initialization.commandId, JSON.stringify(audit), initial.capturedAt);
        }
        if (problem === "command-parent") corruptFixture(database, "UPDATE commands SET parent_id=id");
        if (problem === "command-unfinished") database.prepare("UPDATE commands SET state='executing',outcome_json=NULL").run();
        if (problem === "command-outcome") database.prepare("UPDATE commands SET outcome_json=json_set(outcome_json,'$.auditId',?)").run(randomUUID());
        if (problem === "saved-settings") {
          const saved = { revision: 2, settings: {}, settingsFingerprint: app.initialization.settings.settingsFingerprint, commandId: app.initialization.commandId,
            commandFingerprint: "a".repeat(64), auditId: app.initialization.auditId, committedAt: initial.capturedAt };
          database.prepare("UPDATE settings SET revision=2,payload_json=?").run(JSON.stringify({ ...app, saved }));
        }
        if (problem === "missing-settings") database.exec("DELETE FROM settings");
        if (problem === "advanced-snapshot") {
          corruptFixture(database, "UPDATE settings_snapshots SET revision=2,payload_json=json_set(payload_json,'$.revision',2) WHERE id=?", active.configSnapshotId);
        }
        if (problem === "unbound-snapshot" || problem === "intermediate-startup") {
          const next = { ...active, configSnapshotId: randomUUID(), capturedAt: "2026-07-31T17:02:00.000Z" };
          database.prepare("INSERT INTO settings_snapshots(id,revision,fingerprint,payload_json,captured_at) VALUES(?,?,?,?,?)")
            .run(next.configSnapshotId, next.revision, next.fingerprint, JSON.stringify(next), next.capturedAt);
          if (problem === "intermediate-startup") repositories.runtimeConfig.activate({ settingsRevision: 1, settingsFingerprint: app.initialization.settings.settingsFingerprint,
            configSnapshotId: next.configSnapshotId, configFingerprint: next.fingerprint, activatedAt: next.capturedAt });
          inspectNativeAuthority(database);
        }
        if (problem === "snapshot-fingerprint") corruptFixture(database, "UPDATE settings_snapshots SET fingerprint=?,payload_json=json_set(payload_json,'$.fingerprint',?) WHERE id=?", "0".repeat(64), "0".repeat(64), initial.configSnapshotId);
        if (problem === "snapshot-native-column") corruptFixture(database, "UPDATE settings_snapshots SET captured_at=? WHERE id=?", active.capturedAt, initial.configSnapshotId);
        if (problem === "snapshot-schema") corruptFixture(database, "UPDATE settings_snapshots SET payload_json=json_set(payload_json,'$.unowned',1) WHERE id=?", initial.configSnapshotId);
        if (problem === "initial-snapshot-binding") corruptFixture(database, "UPDATE settings_snapshots SET captured_at=?,payload_json=json_set(payload_json,'$.capturedAt',?) WHERE id=?", active.capturedAt, active.capturedAt, initial.configSnapshotId);
        if (problem === "active-snapshot-time") database.prepare("UPDATE settings SET updated_at=?,payload_json=json_set(payload_json,'$.active.activatedAt',?)").run(initial.capturedAt, initial.capturedAt);
        if (problem === "active-generation") database.prepare("UPDATE settings SET payload_json=json_set(payload_json,'$.active.generation',3)").run();
      } finally { database.close(); }
      const before = readFileSync(f.databasePath), continuity = readFileSync(f.controlPath);
      await assert.rejects(reclassify(f),
        (error: unknown) => error instanceof Error && (!(problem === "unbound-snapshot" || problem === "intermediate-startup") || /profile-incomplete-inventory-snapshot-unbound/u.test(error.message)));
      assert.deepEqual(readFileSync(f.databasePath), before); assert.deepEqual(readFileSync(f.controlPath), continuity);
    } finally { await f.close(); }
  });
}

for (const activity of ["business", "deleted-history", "artifact-reference", "workbook-history", "unknown-write", "uncertain-control", "diagnostic"] as const) {
  it(`refuses valid ${activity} alongside initialization at the activity guard`, async () => {
    const f = await createHistoricalIncompleteProfileFixture();
    try {
      const database = new DatabaseSync(f.databasePath);
      try {
        const { initial, active } = initialize(database);
        if (activity === "business") {
          const row = RunSessionRecordSchema.parse(RUN_SESSION);
          database.prepare("INSERT INTO run_batches(id,workflow,started_at,group_in_queue,version,payload_json,created_at) VALUES(?,?,?,?,?,?,?)")
            .run(row.sessionId, row.workflow, row.startedAt, Number(row.groupInQueue), row.version, JSON.stringify(row), row.createdAt);
        }
        if (activity === "deleted-history" || activity === "artifact-reference") {
          const command = z.object({ id: z.string() }).parse(database.prepare("SELECT id FROM commands").get());
          const row = DeletedRunRecordSchema.parse({ runId: randomUUID(), workflow: "person-lookup", itemId: randomUUID(), traceId: "pl-170000-abcd", attempt: 1,
            runNumber: null, ordinalSource: "tombstone", origin: "queue", commandId: command.id, deletedAt: initial.capturedAt, tallyVersion: 3, removed: [] });
          const files = activity === "artifact-reference" ? [{ ref: { id: randomUUID(), sha256: "a".repeat(64), bytes: 1, mediaType: "text/plain" }, disposition: "retain", storedSha256: "b".repeat(64), storedBytes: 1 }] : [];
          corruptFixture(database, "INSERT INTO deleted_runs(run_id,workflow,item_id,attempt,run_number,trace_id,command_id,deleted_at,cleanup_state,receipt_json,files_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            row.runId, row.workflow, row.itemId, row.attempt, row.runNumber, row.traceId, row.commandId, row.deletedAt, "complete", JSON.stringify(row), JSON.stringify(files));
        }
        if (activity === "unknown-write") {
          const row = WriteIntentRecordSchema.parse({ ...WRITE_INTENT_ATTEMPTING, status: "parked", parkedCode: "unknown", message: "fixture unresolved submit",
            authorityReason: { version: 1, code: "post-click-verifier-unknown", evidence: { kind: "probe", digest: "a".repeat(64) } } });
          assert.ok(row.status === "parked");
          database.prepare("INSERT INTO write_intents(id,system,idempotency_key,idempotency_key_digest,status,generation,run_id,payload_json,publication_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,NULL,?,?)")
            .run(row.writeIntentId, row.system, row.idempotencyKey, row.idempotencyKeyDigest, row.status, row.generation, row.runId, JSON.stringify(row), row.createdAt, row.updatedAt);
        }
        if (activity === "uncertain-control") {
          const request = CommandRequestSchema.parse(COMMAND_FIXTURES.find(raw => CommandRequestSchema.safeParse(raw).success && z.object({ type: z.string() }).parse(raw).type === "plan-worker-count"));
          insertNativeCommand(database, request);
          assert.equal(request.family, "worker-browser");
          if (request.family !== "worker-browser" || request.type !== "plan-worker-count") throw new Error("fixture worker plan required");
          const selected = Array.from({ length: request.payload.desiredWorkers }, (_, index) => ({ workerId: `${request.target.workflowId}-worker-${index + 1}`,
            workflow: request.target.workflowId, ordinal: index + 1, poolIndex: index + 1, membershipRevision: 1, phase: "starting", retiredAt: null,
            retirementCommandId: null, reservationCommandId: null, createdAt: initial.capturedAt, updatedAt: initial.capturedAt }));
          const row = WorkerControlRecordSchema.parse({ commandId: request.commandId, request, scope: "worker-pool:onboarding", executorId: randomUUID(), admittedAt: initial.capturedAt,
            expiresAt: active.capturedAt, basisVersion: 1, roster: { selected, excess: [], beforeVersion: 1, admittedVersion: 1, afterVersion: 2 }, phase: { state: "uncertain", startedAt: initial.capturedAt, observedAt: active.capturedAt, message: "fixture unresolved owner" } });
          database.prepare("INSERT INTO worker_controls(command_id,scope,worker_id,phase,audited_at,payload_json,created_at) VALUES(?,?,NULL,'uncertain',NULL,?,?)")
            .run(row.commandId, row.scope, JSON.stringify(row), row.admittedAt);
        }
        if (activity === "diagnostic") {
          const run = RunRecordSchema.parse({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, configSnapshotId: active.configSnapshotId, configFingerprint: active.fingerprint } });
          const columns = runRecordColumns(run);
          database.prepare(`INSERT INTO runs(${Object.keys(columns).join(",")}) VALUES(${Object.keys(columns).map(() => "?").join(",")})`).run(...Object.values(columns));
          const row = DiagnosticBundleSchema.parse({ bundleId: randomUUID(), runId: run.envelope.runId, origin: { kind: "operator-request", requestedBy: "local-operator" }, createdAt: initial.capturedAt,
            contentDigest: "a".repeat(64), configFingerprint: active.fingerprint, descriptorFingerprint: run.envelope.contractFingerprint, redaction: { fields: [], warnings: [] }, attachments: [], retention: { kind: "pinned", reason: "knowledge" } });
          database.prepare("INSERT INTO diagnostic_snapshots(id,run_id,origin_kind,failure_id,content_digest,retention_kind,purge_after,payload_json,created_at) VALUES(?,?,?,NULL,?,?,NULL,?,?)")
            .run(row.bundleId, row.runId, row.origin.kind, row.contentDigest, row.retention.kind, JSON.stringify(row), row.createdAt);
          const generation = z.object({ authority_generation: z.number() }).parse(database.prepare("SELECT authority_generation FROM database_states").get()).authority_generation;
          const search = createRunSearchIndex(database);
          search.installTracking();
          search.rebuild({ restart: true }, generation, initial.capturedAt);
        }
        if (activity === "workbook-history") {
          const service = createWorkbookLibraryService({ clock: manualClock(new Date(initial.capturedAt)),
            repository: createWorkbookLibraryRepository({ database, mutate: work => work().result, read: work => work() }) });
          const first = service.create({ name: "Fixture.xlsx", themes: [], hasFormulas: false, sheets: [{ id: "sheet", name: "Fixture", width: 1, hidden: [], rows: [{ id: "row", cells: [{ value: "fixture" }] }] }] });
          service.save(first.libraryId, first.version, { ...first.workbook, name: "Saved.xlsx" });
        }
        inspectNativeAuthority(database);
      } finally { database.close(); }
      const before = readFileSync(f.databasePath);
      await assert.rejects(reclassify(f), /profile-incomplete-activity-present/u);
      assert.deepEqual(readFileSync(f.databasePath), before);
    } finally { await f.close(); }
  });
}
