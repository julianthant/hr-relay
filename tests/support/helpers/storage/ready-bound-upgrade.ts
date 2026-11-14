import { restoreSchema20CompletionFixture, restoreSchema22WorkerCustodyFixture } from "../../fixtures/storage/historical-run-schema.js";
import { removeSchema16PersonPreferences } from "../../fixtures/storage/person-preferences-predecessor.js";
import { PREFERENCES_SNAPSHOT } from "../../fixtures/phase1c-contract-fixtures.js";
import { restoreSchema19RunSettlementFixture, restoreSchema18WorkbookReferenceFixture, removeEmptySchema18WorkbookCatalog, removeEmptySchema17OcrReview, removeSchema15RunPause, removeEmptyExclusiveSessionLeaseFixture } from "../../fixtures/storage/historical-run-schema.js";
import { restoreEmptyPreMasterWorkbookFixture } from '../../../support/helpers/workbooks/pre-master-schema.js';
import { restorePreReadingArtifactRetention } from "../../fixtures/storage/pre-reading-artifact-retention.js";
import { historicalOcrExtractions, insertUnboundOcrExtraction } from "../../fixtures/storage/ocr-extractions.js";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { RunRecordService, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectActiveRunSettings, selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { readBootSettings, readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase, inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SQLITE_MIGRATIONS, isWorkerCustodyDroppedTable, migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { InstanceSelectionSchema } from "../../../../src/models/run/envelope.js";
import { SettingsCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { RunWorkbookReferenceSchema, RunWorkbookAllRowsReferenceSchema, RunWorkbookNamedReferenceSchema, RunWorkbookNamedAllRowsReferenceSchema, RunWorkbookSelectedRowReferenceSchema } from "../../../../src/models/dashboard/workbooks.js";
import { StartPlanRecordSchema, derivePlannedInputFingerprint } from "../../../../src/models/run/start-plan.js";
import { type JsonValue, canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { QUEUED_RUN, START_PLAN } from "../../fixtures/phase1f-run-fixtures.js";
import { boundProfileCredentials, createBoundProfileFixture } from "../../helpers/admission-fixture.js";
import { update as artifactUpdate } from "../../helpers/database-foundation/fixtures.js";
import { personLookupDescriptor } from "../../helpers/registered-workflows.js";

// node:sqlite loads on first use so importing this helper stays pure.
const sqlite = () => createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: typeof DatabaseSyncType };


export const hostFacts = { primaryDisplay: null };
// Tables the schema-22 hook changes while it settles and tombstones pre-build runs.
export const PRE_BUILD_RUN_TABLES = new Set(["runs", "deleted_runs", "commands", "command_audits", "timeline_events", "run_search"]);
export const workbookReferenceValue = RunWorkbookReferenceSchema.parse({
  request: { typeId: "upgrade-roster", libraryId: "upgrade-workbook", keys: ["retained-key"], fields: ["eid"] },
  snapshot: { libraryId: "upgrade-workbook", version: 1, worksheets: [{ sheetId: "people", name: "People" }],
    type: { id: "upgrade-roster", name: "Roster", keyFieldId: "eid", fields: ["eid"], defaultWorkbookId: null },
    rows: [{ key: "retained-key", state: "matched", matches: [{ sheetId: "people", rowId: "person", values: { eid: "retained-key" } }] }] },
});
export const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export async function readyBoundEight(work: "idle" | "queued" = "idle", sourceVersion: 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 = 8, extractionEvidence = false,
  workbookEvidence?: { owner: "run" | "terminal-run" | "plan" | "consumed-plan"; schemaHash: string; value?: JsonValue }) {
  const profile = await createBoundProfileFixture();
  const binding = profile.admission.profileBinding;
  const credentials = boundProfileCredentials(profile.admission);
  const database = AuthorityDatabase.open(profile.admission, { path: profile.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock,
    undefined, undefined, undefined, credentials);
  const patch = { "actor.label": { set: "ready-upgrade-proof" } };
  let command: ReturnType<typeof SettingsCommandRequestSchema.parse>;
  let saved: ReturnType<typeof executeSettingsCommand>;
  try {
    const resolveSettings = (value: unknown) => resolveConfigWithProvenance(value, hostFacts, systemClock,
      { stateRoot: profile.stateRoot, artifactRoot: profile.admission.artifactRoot });
    database.withAuthorityTransaction(repositories => {
      const initial = readBootSettings(repositories);
      assert.equal(repositories.runtimeConfig.get(), undefined);
      const resolved = resolveSettings(initial.settings);
      repositories.runtimeConfig.initialize({ ...PREFERENCES_SNAPSHOT, configSnapshotId: randomUUID(), revision: initial.revision,
        fingerprint: resolved.fingerprint, capturedAt: systemClock.now().toISOString(), capturedBy: LOCAL_OPERATOR_ACTOR_ID,
        config: resolved.config, provenance: resolved.provenance });
    });
    command = SettingsCommandRequestSchema.parse({ commandId: randomUUID(), family: "settings", type: "apply-settings", requestedAt: systemClock.now().toISOString(),
    requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: "settings-surface", target: { expectedRevision: readSettings(database.authority).revision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    const settings = createSettingsApplicationExecutor(resolveSettings, credentials);
    saved = executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID }, settings }, command);
    assert.equal(saved.state, "applied");
    const nextPatch = { "actor.label": { set: "ready-upgrade-proof-next" } };
    const nextCommand = { ...command, commandId: randomUUID(), target: { expectedRevision: readSettings(database.authority).revision },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(nextPatch), patch: nextPatch } };
    assert.equal(executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID }, settings }, nextCommand).state, "applied");
    if (work === "queued") {
      const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock: systemClock });
      const service = new RunRecordService({ database, clock: systemClock, ids: { uuid: randomUUID },
        publishQueued: run => { emitter.emit(runQueuedSpanEvent({ run, actorId: LOCAL_OPERATOR_ACTOR_ID, title: "Upgrade custody proof" })); } });
      const snapshot = selectActiveRunSettings(database.authority);
      const resolvedInstance = InstanceSelectionSchema.parse(QUEUED_RUN.envelope.resolvedInstance);
      assert.ok(resolvedInstance);
      const run = requireLifecycleApplied(service.create({ commandId: randomUUID(), code: "pl", matchKey: "ready-upgrade-custody",
        workflow: "person-lookup", descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint,
        configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint,
        resolvedInstance, input: { ...QUEUED_RUN.input,
          ...(workbookEvidence?.owner === "run" || workbookEvidence?.owner === "terminal-run"
            ? { workbookReferences: [{ schemaHash: FingerprintSchema.parse(workbookEvidence.schemaHash), value: workbookEvidence.value ?? workbookReferenceValue }] } : {}) }, priority: "bulk", shape: "single", dryRun: true,
        runtimeConfig: selectRunRuntime(database.authority) }));
      assert.equal(run.lifecycle.state, "queued");
      if (workbookEvidence?.owner === "terminal-run") {
        const terminal = requireLifecycleApplied(service.transition({ commandId: randomUUID(), runId: run.envelope.runId,
          expectedVersion: run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: systemClock.now().toISOString() } }));
        assert.equal(terminal.lifecycle.state, "terminal");
      }
      if (workbookEvidence === undefined) {
        const ref = await createContentAddressedArtifactWriter({ admission: profile.admission }).put(Buffer.from("retained upgrade artifact"), { mediaType: "application/octet-stream" });
        database.authority.artifactOutbox.insert({ ...artifactUpdate(), sourceRunId: run.envelope.runId,
          payload: { schemaHash: "a".repeat(64), value: { artifact: ref } } });
        mkdirSync(join(profile.stateRoot, "files"), { mode: 0o700 });
        writeFileSync(join(profile.stateRoot, "files", "upgrade-proof.txt"), "ordinary person output", { mode: 0o600 });
      } else assert.deepEqual(database.authority.artifactOutbox.listPending(), []);
    }
  } finally { database.close(); }
  const row = profile.machine.readProfileRegistry().profiles.find(value => value.profileId === binding.profileId);
  assert.ok(row);
  assert.equal(row.lifecycle, "ready");
  assert.equal(row.credentialState, "saved");
  assert.ok(existsSync(join(profile.machine.stateRoot, "machine", "credential-keys", `${binding.profileId}.json`)));
  assert.equal(profile.machine.readProfileRegistry().profiles.find(value => value.profileId === binding.profileId)?.credentialState, "saved");
  profile.admission.release();
  const raw = new (sqlite().DatabaseSync)(profile.path);
  try {
    raw.exec("PRAGMA foreign_keys=ON");
    for (const table of ["assistant_actions", "assistant_chats", "assistant_grants"]) assert.equal(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
    raw.exec("BEGIN EXCLUSIVE");
    raw.exec("DROP TABLE IF EXISTS workflow_workbook_selections");
    if (sourceVersion < 24) restoreSchema22WorkerCustodyFixture(raw);
    if (sourceVersion === 23) {
      const claimIndex = SQLITE_MIGRATIONS.find(migration => migration.version === 23);
      if (claimIndex === undefined) throw new Error("schema 23 migration missing");
      for (const statement of claimIndex.statements) raw.exec(statement);
    }
    if (sourceVersion >= 21) raw.exec(`UPDATE database_states SET schema_version=${String(sourceVersion)}; PRAGMA user_version=${String(sourceVersion)}`);
    else if (sourceVersion === 20) restoreSchema20CompletionFixture(raw);
    else if (sourceVersion === 19) restoreSchema19RunSettlementFixture(raw);
    else restoreSchema18WorkbookReferenceFixture(raw);
    if (sourceVersion < 18) removeEmptySchema18WorkbookCatalog(raw);
    if (sourceVersion < 17) removeEmptySchema17OcrReview(raw);
    if (sourceVersion < 16) removeSchema16PersonPreferences(raw);
    if (sourceVersion < 15) removeSchema15RunPause(raw);
    if (sourceVersion < 14) removeEmptyExclusiveSessionLeaseFixture(raw);
    if (sourceVersion < 13) restoreEmptyPreMasterWorkbookFixture(raw);
    if (sourceVersion < 10) {
      const editorDdl = SQLITE_MIGRATIONS[0].statements.join("\n").match(/CREATE TABLE explorer_overrides \([\s\S]*?\n\) STRICT;/u)?.[0];
      assert.ok(editorDdl);
      raw.exec(editorDdl);
    }
    if (sourceVersion < 9) raw.exec("DROP TABLE assistant_model_preference");
    if (extractionEvidence) {
      for (const extraction of historicalOcrExtractions()) insertUnboundOcrExtraction(raw, extraction, sourceVersion < 12);
    }
    if (sourceVersion < 12) restorePreReadingArtifactRetention(raw);
    raw.prepare("UPDATE database_states SET schema_version=? WHERE id=1").run(sourceVersion);
    raw.exec(`PRAGMA user_version=${sourceVersion}; COMMIT`);
    if (workbookEvidence?.owner === "plan" || workbookEvidence?.owner === "consumed-plan") {
      const planned = START_PLAN.planned.map(run => ({ ...run, workbookReferences: [{ schemaHash: FingerprintSchema.parse(workbookEvidence.schemaHash), value: workbookEvidence.value ?? workbookReferenceValue }] }));
      const consumed = workbookEvidence.owner === "consumed-plan";
      const plan = StartPlanRecordSchema.parse({ ...START_PLAN, planned,
        inputFingerprint: derivePlannedInputFingerprint(planned, START_PLAN.ingressSchemaHash, START_PLAN.canonicalInputSchemaHash),
        ...(consumed ? { consumedBy: { commandId: command.commandId, consumedAt: START_PLAN.plannedAt }, version: 2 } : {}) });
      raw.prepare('INSERT INTO run_requests(id,workflow,actor_id,consumed_by,expires_at,version,payload_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(plan.startPlanId, plan.workflowId, plan.plannedBy, plan.consumedBy?.commandId ?? null, plan.expiresAt, plan.version, canonicalJsonStringify(plan), plan.createdAt);
    }
    const prior = inspectNativeAuthority(raw, sourceVersion);
    assert.equal(prior.schemaVersion, sourceVersion);
    assert.equal(prior.installationId, binding.installationId);
    assert.equal(prior.profileId, binding.profileId);
  } finally { raw.close(); }
  const claim = binding.profileId;
  const processLockRoot = join(profile.workspace, rebuildRuntimeIsolation.processLockRoot);
  return { ...profile, binding, claim, command, saved, processLockRoot,
    acquireRestore: () => profile.machine.acquireOfflineMaintenance() };
}

export function rawEight(path: string, version = 8) {
  const raw = new (sqlite().DatabaseSync)(path, { readOnly: true });
  try {
    const present = new Set(raw.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => String(row.name)));
    return Object.fromEntries(migrationTableNames(version).filter(table => table !== "explorer_overrides" && !isWorkerCustodyDroppedTable(table) && present.has(table)).map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  } finally { raw.close(); }
}


export const namedWorkbookSnapshot = { ...workbookReferenceValue.snapshot, versionId: "selected", versionName: "Selected" };
export const allWorkbookRequest = { mode: "all", typeId: "upgrade-roster", libraryId: "upgrade-workbook", expectedVersion: 1, fields: ["eid"] };
export const workbookFormats = [
  { format: "master-keyed", schema: RunWorkbookReferenceSchema, value: workbookReferenceValue },
  { format: "master-all", schema: RunWorkbookAllRowsReferenceSchema, value: { request: allWorkbookRequest, snapshot: workbookReferenceValue.snapshot } },
  { format: "named-keyed", schema: RunWorkbookNamedReferenceSchema, value: { request: { ...workbookReferenceValue.request, versionId: "selected" }, snapshot: namedWorkbookSnapshot } },
  { format: "named-all", schema: RunWorkbookNamedAllRowsReferenceSchema, value: { request: { ...allWorkbookRequest, versionId: "selected" }, snapshot: namedWorkbookSnapshot } },
  { format: "selected-row", schema: RunWorkbookSelectedRowReferenceSchema, value: { request: { ...workbookReferenceValue.request, versionId: "selected", selectedRow: { sheetId: "people", rowId: "person" } }, snapshot: namedWorkbookSnapshot } },
];
