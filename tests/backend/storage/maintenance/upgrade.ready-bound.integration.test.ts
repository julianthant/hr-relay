import { assertUpgradedRunSettlementRows, removeEmptySchema23AssistantHistory, restoreSchema20CompletionFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { removeSchema16PersonPreferences, prePreferencesSettingsRow } from "../../../support/fixtures/storage/person-preferences-predecessor.js";
import { PREFERENCES_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { restoreSchema19RunSettlementFixture, restoreSchema18WorkbookReferenceFixture, removeEmptySchema18WorkbookCatalog, removeEmptySchema17OcrReview, removeSchema15RunPause, removeEmptyExclusiveSessionLeaseFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { restoreEmptyPreMasterWorkbookFixture } from '../../../support/helpers/workbooks/pre-master-schema.js';
import { restorePreReadingArtifactRetention } from "../../../support/fixtures/storage/pre-reading-artifact-retention.js";
import { donePage, sourceFixture } from "../../../support/fixtures/ocr/source-pages.js";
import { insertMalformedLegacyOcrExtraction, historicalOcrExtractions, insertUnboundOcrExtraction } from "../../../support/fixtures/storage/ocr-extractions.js";
import assert from "node:assert/strict";
import { createHash,randomUUID } from "node:crypto";
import { copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync,renameSync,rmdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it,vi } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { RunRecordService,requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectActiveRunSettings,selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { profileBrowserClosure } from "../../../../src/backend/runtime/browser/profile-browser-closure.js";
import { readBootSettings,readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import type { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { createProfileVerifiers } from "../../../../src/backend/storage/configuration/verifier-store.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { prepareStoppedBackupClosure } from "../../../../src/backend/storage/maintenance/profile-inventory.js";
import { backupStoppedAuthority,upgradeProfileAtStartup,upgradeReadyProfileStorage } from "../../../../src/backend/storage/maintenance/upgrade.js";
import { AuthorityDatabase,inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly } from "../../../../src/backend/storage/sqlite/backup-inspection.js";
import { verifyStoppedBackupManifestAtPath } from "../../../../src/backend/storage/sqlite/backup-service.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION,SQLITE_MIGRATIONS,migrationTableNames } from "../../../../src/backend/storage/sqlite/migrations.js";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { SETTINGS_SCHEMA_HASH,deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { InstanceSelectionSchema } from "../../../../src/models/run/envelope.js";
import { SettingsCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { FingerprintSchema,IsoInstantSchema,LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { RunWorkbookReferenceSchema, RunWorkbookAllRowsReferenceSchema, RunWorkbookNamedReferenceSchema, RunWorkbookNamedAllRowsReferenceSchema, RunWorkbookSelectedRowReferenceSchema } from "../../../../src/models/dashboard/workbooks.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { StartPlanRecordSchema, derivePlannedInputFingerprint } from "../../../../src/models/run/start-plan.js";
import { JsonValueSchema, type JsonValue, canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { QUEUED_RUN, START_PLAN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { boundProfileCredentials,createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";
import { update as artifactUpdate } from "../../../support/helpers/database-foundation/fixtures.js";
import { storageTree } from "../../../support/helpers/integration/storage-recovery-fixture.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";

const hostFacts = { primaryDisplay: null };
// Tables the schema-22 hook changes while it settles and tombstones pre-build runs.
const PRE_BUILD_RUN_TABLES = new Set(["runs", "deleted_runs", "commands", "command_audits", "timeline_events", "run_search"]);
const workbookReferenceValue = RunWorkbookReferenceSchema.parse({
  request: { typeId: "upgrade-roster", libraryId: "upgrade-workbook", keys: ["retained-key"], fields: ["eid"] },
  snapshot: { libraryId: "upgrade-workbook", version: 1, worksheets: [{ sheetId: "people", name: "People" }],
    type: { id: "upgrade-roster", name: "Roster", keyFieldId: "eid", fields: ["eid"], defaultWorkbookId: null },
    rows: [{ key: "retained-key", state: "matched", matches: [{ sheetId: "people", rowId: "person", values: { eid: "retained-key" } }] }] },
});
const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

async function readyBoundEight(work: "idle" | "queued" = "idle", sourceVersion: 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 22 = 8, extractionEvidence = false,
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
  const raw = new DatabaseSync(profile.path);
  try {
    raw.exec("PRAGMA foreign_keys=ON");
    for (const table of ["assistant_actions", "assistant_chats"]) assert.equal(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0);
    raw.exec("BEGIN EXCLUSIVE");
    if (sourceVersion === 22) removeEmptySchema23AssistantHistory(raw);
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

function assertGrantTableRetired(path: string) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try { assert.equal(raw.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name='assistant_grants'").get()?.count, 0); } finally { raw.close(); }
}
function rawEight(path: string, version = 8) {
  const raw = new DatabaseSync(path, { readOnly: true });
  try {
    // The empty grant table is dropped by schema 26; `assertGrantTableRetired` checks that separately.
    return Object.fromEntries(migrationTableNames(version).filter(table => table !== "explorer_overrides" && table !== "assistant_grants").map(table => [table, raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  } finally { raw.close(); }
}

it("upgrades a genuinely READY bound profile with exact preference conversion, retained historical rows, credentials and replay", async () => {
  const f = await readyBoundEight();
  try {
    const before = rawEight(f.path), protectedBefore = digest(join(f.stateRoot, "credentials", "protected.json"));
    const machineBefore = storageTree(join(f.machine.stateRoot, "machine"));
    assert.ok((before.commands?.length ?? 0) >= 2);
    assert.ok((before.command_audits?.length ?? 0) >= 2);
    assert.throws(() => f.machine.admitProfile(f.claim), { message: "profile-database-schema-mismatch" });
    assert.equal((await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: true, hostFacts }, systemClock)).state, "planned");
    assert.deepEqual(rawEight(f.path), before);
    const result = await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock);
    assert.deepEqual(result, { state: "upgraded", fromSchemaVersion: 8, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
    assertGrantTableRetired(f.path);
    const after = rawEight(f.path);
    for (const [table, rows] of Object.entries(before)) {
      if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "runs") assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, pause_state: null })));
      else if (table === "database_upgrades") assert.deepEqual(after[table]?.slice(0, rows.length), rows);
      else if (table === "run_results" || table === "run_receipts") assertUpgradedRunSettlementRows(table, after[table] ?? [], before);
      else assert.deepEqual(after[table]?.map(row => prePreferencesSettingsRow(table, row)), rows.map(row => ({ ...row })));
    }
    assert.equal(after.database_upgrades?.length, (before.database_upgrades?.length ?? 0) + 1);
    assert.equal(digest(join(f.stateRoot, "credentials", "protected.json")), protectedBefore);
    assert.deepEqual(storageTree(join(f.machine.stateRoot, "machine")), machineBefore);
    const fresh = f.machine.admitProfile(f.binding.profileId);
    try {
      const credentials = createCredentialStore({ admission: fresh, stateRoot: f.stateRoot,
        });
      const database = AuthorityDatabase.open(fresh, { path: f.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock, undefined, undefined, undefined, credentials);
      try {
        assert.equal(database.authority.assistantModelPreference.get(), undefined);
        for (const table of ["assistant_chats", "assistant_actions"]) {
          const raw = new DatabaseSync(f.path, { readOnly: true });
          try { assert.equal(raw.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count, 0); } finally { raw.close(); }
        }
        const replay = executeSettingsCommand({ authority: database, clock: systemClock, ids: { uuid: randomUUID },
          settings: createSettingsApplicationExecutor(() => { throw new Error("ready-upgrade-replay-reapplied"); }, credentials) }, f.command);
        assert.deepEqual(replay, { ...f.saved, state: "already-applied" });
      } finally { database.close(); }
    } finally { fresh.release(); }
    const currentBefore = storageTree(f.stateRoot);
    assert.equal((await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.binding.profileId, { plan: false, hostFacts }, systemClock)).state, "already-upgraded");
    assert.deepEqual(storageTree(f.stateRoot), currentBefore);
  } finally { await f.close(); }
});

it("confines the issued READY purpose and its verified backup copy to their exact doors", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  let owner: RuntimeAdmission | undefined;
  try {
    const issued = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
    owner = issued;
    assert.equal(owner.isProfileInitialization(), false);
    assert.throws(() => issued.assertProfileInitialization(), { message: "profile-initialization-authority-required" });
    assert.throws(() => issued.assertCredentialRead(), { message: "profile-stopped-upgrade-credential-read-refused" });
    assert.throws(() => issued.assertWritable(), { message: "profile-stopped-upgrade-runtime-refused" });
    assert.throws(() => issued.assertExclusive(), { message: "profile-stopped-upgrade-exclusive-refused" });
    assert.throws(() => issued.assertReadOnlyAuthorityDatabase(":memory:"), { message: "profile-stopped-upgrade-path-refused" });
    assert.throws(() => issued.assertReadOnlyAuthorityDatabase(join(f.stateRoot, "credentials", "protected.json")), { message: "profile-stopped-upgrade-path-refused" });
    assert.throws(() => issued.assertAuthorityBackupWrite(f.path), { message: "profile-stopped-upgrade-backup-refused" });
    assert.throws(() => issued.admitProfile(f.claim), { message: "profile-stopped-upgrade-runtime-refused" });
    assert.throws(() => issued.forStoppedProfileUpgrade(), { message: "profile-stopped-upgrade-exclusive-refused" });
    assert.throws(() => AuthorityDatabase.open(issued, { path: f.path, migrationOwner: "selected-profile-runtime" }), { message: "profile-bound-authority-required" });
    assert.throws(() => AuthorityDatabase.initializeProfile(issued), { message: "profile-initialization-authority-required" });
    assert.throws(() => issued.verifiedReadOnlyCopy(f.path, digest(f.path)), { message: "profile-stopped-upgrade-copy-refused" });
    assert.throws(() => issued.stoppedStagedAuthority(join(f.stateRoot, `.restore-${randomUUID()}.sqlite.tmp`)), { message: "profile-stopped-upgrade-exclusive-refused" });
    const backed = await prepareStoppedBackupClosure(profileBrowserClosure, issued, restore, systemClock, f.processLockRoot).then(closure => backupStoppedAuthority(closure, issued, f.stateRoot, systemClock, f.processLockRoot, restore));
    const manifest = backed.manifests[0]; assert.ok(manifest);
    const verified = verifyStoppedBackupManifestAtPath(issued, join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`));
    const copy = issued.verifiedReadOnlyCopy(verified.backupPath, verified.manifest.sha256);
    try {
      assert.equal(inspectAuthorityBackupReadOnly(copy, verified.backupPath, 8).schemaVersion, 8);
      assert.throws(() => copy.assertReadOnlyAuthorityDatabase(f.path), { message: "profile-stopped-upgrade-path-refused" });
      assert.throws(() => copy.assertCredentialRead(), { message: "profile-stopped-upgrade-credential-read-refused" });
      assert.throws(() => copy.verifiedReadOnlyCopy(verified.backupPath, verified.manifest.sha256), { message: "profile-stopped-upgrade-copy-refused" });
      issued.release();
      assert.throws(() => copy.assertLive(), { message: "runtime-admission: missing or released admission" });
    } finally { copy.release(); }
  } finally { owner?.release(); restore.release(); await f.close(); }
});

it("refuses malformed or foreign profile selectors and copied, foreign or released restore custody without source effects", async () => {
  const f = await readyBoundEight(), foreign = await readyBoundEight(), restore = f.acquireRestore(), other = foreign.acquireRestore();
  try {
    const before = storageTree(f.stateRoot);
    // @ts-expect-error The runtime boundary must also refuse an untyped selector.
    await assert.rejects(f.machine.forStoppedProfileUpgrade(profileBrowserClosure, { profileId: f.claim }, restore, systemClock, hostFacts), /Invalid input: expected string/u);
    await assert.rejects(f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, { ...restore }, systemClock, hostFacts), { code: "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE" });
    await assert.rejects(f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, other, systemClock, hostFacts), { code: "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE" });
    await assert.rejects(f.machine.forStoppedProfileUpgrade(profileBrowserClosure, foreign.claim, restore, systemClock, hostFacts), { message: "profile-storage-claim-unregistered" });
    restore.release();
    await assert.rejects(f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts), { code: "RUNTIME_OFFLINE_OPERATION_UNAVAILABLE" });
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally { restore.release(); other.release(); await foreign.close(); await f.close(); }
});

it("refuses a genuine live server role and leaves every profile byte unchanged", async () => {
  const f = await readyBoundEight();
  const server = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "server", pid: process.pid }, systemClock);
  try {
    const before = storageTree(f.stateRoot);
    await assert.rejects(upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock),
      { code: "RUNTIME_OLD_BUILD_ARTIFACTS" });
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally { server.release(); await f.close(); }
});

it("refuses a genuine canonical queued run despite stopped global process roles", async () => {
  const f = await readyBoundEight("queued");
  try {
    const rows = rawEight(f.path), before = storageTree(f.stateRoot);
    assert.ok((rows.runs?.length ?? 0) > 0);
    await assert.rejects(upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock),
      { message: "credential-maintenance-custody-unproved" });
    assert.deepEqual(storageTree(f.stateRoot), before);
    assert.deepEqual(rawEight(f.path), rows);
  } finally { await f.close(); }
});

it("automatically upgrades schema 22 with queued work intact", async () => {
  const f = await readyBoundEight("queued", 22);
  const tables = () => { const raw = new DatabaseSync(f.path, { readOnly: true });
    try { return raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => String(row.name)); } finally { raw.close(); } };
  try {
    assert.deepEqual(tables(), [...migrationTableNames(22)].sort());
    assert.equal(tables().includes("assistant_conversations"), false);
    const before = rawEight(f.path, 22);
    assert.ok(before.runs.length > 0); assert.ok(before.artifacts.length > 0);
    assert.equal((await upgradeProfileAtStartup(profileBrowserClosure, f.machine, f.claim, hostFacts, systemClock)).state, "upgraded");
    assert.deepEqual(tables(), [...migrationTableNames(CURRENT_AUTHORITY_SCHEMA_VERSION)].sort());
    const after = rawEight(f.path, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(Object.keys(after).sort(), [...Object.keys(before), "assistant_attachments", "assistant_conversations", "assistant_messages"].sort());
    for (const [table, rows] of Object.entries(before)) {
      if (table === "database_states") assert.deepEqual(after[table].map(row => ({ ...row })), rows.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "database_upgrades") { assert.deepEqual(after[table].slice(0, rows.length), rows); assert.equal(after[table].length, rows.length + 1); }
      else assert.deepEqual(after[table].map(row => ({ ...row })), rows.map(row => ({ ...row })), table);
    }
    assert.deepEqual([after.assistant_conversations, after.assistant_messages], [[], []]);
  } finally { await f.close(); }
});

it.each([8, 11, 12, 13, 14, 15, 16, 19, 20] as const)("automatically upgrades schema %s by settling and tombstoning its queued work", async sourceVersion => {
  const f = await readyBoundEight("queued", sourceVersion);
  try {
    const before = rawEight(f.path);
    assert.ok((before.runs?.length ?? 0) > 0); assert.ok((before.artifacts?.length ?? 0) > 0);
    const outputBytes = readFileSync(join(f.stateRoot, "files", "upgrade-proof.txt"));
    assert.equal((await upgradeProfileAtStartup(profileBrowserClosure, f.machine, f.claim, hostFacts, systemClock)).state, "upgraded");
    const backupDirectory = join(f.stateRoot, "backups", "authority");
    const manifests = readdirSync(backupDirectory).filter(name => name.endsWith(".manifest.json"))
      .map(name => AuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(join(backupDirectory, name), "utf8"))));
    assert.ok(manifests.some(manifest => manifest.schemaVersion === sourceVersion && manifest.verification.schemaVersion === sourceVersion));
    const after = rawEight(f.path);
    assert.deepEqual(after.runs ?? [], []);
    assert.deepEqual((after.deleted_runs ?? []).map(row => [row.run_id, row.cleanup_state]).sort(),
      (before.runs ?? []).map(row => [row.id, "pending"]).sort());
    for (const [table, rows] of Object.entries(before)) {
      if (PRE_BUILD_RUN_TABLES.has(table)) continue;
      if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "database_upgrades") assert.deepEqual(after[table]?.slice(0, rows.length), rows);
      else assert.deepEqual(after[table]?.map(row => sourceVersion < 16 ? prePreferencesSettingsRow(table, row) : { ...row }), rows.map(row => ({ ...row })), table);
    }
    assert.equal(after.database_upgrades?.length, (before.database_upgrades?.length ?? 0) + 1);
    assert.deepEqual(readFileSync(join(f.stateRoot, "files", "upgrade-proof.txt")), outputBytes);
  } finally { await f.close(); }
});

it("revokes the exact READY purpose on same-byte main-file substitution", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  try {
    const before = readFileSync(f.path), replacement = join(f.stateRoot, "replacement.sqlite");
    copyFileSync(f.path, replacement); renameSync(replacement, f.path);
    assert.throws(() => owner.assertLive(), { message: "profile-stopped-upgrade-source-changed" });
    assert.deepEqual(readFileSync(f.path), before);
  } finally { owner.release(); restore.release(); await f.close(); }
});

it("requires a real verified own backup before changing the ready source schema", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  try {
    const inspection = AuthorityDatabase.inspectStoppedUpgrade(owner, f.path, f.processLockRoot, systemClock);
    const before = storageTree(f.stateRoot);
    assert.throws(() => AuthorityDatabase.upgradeStopped(owner, f.path, f.processLockRoot, systemClock, inspection.authorityContentFingerprint),
      { message: "upgrade-verified-backup-required" });
    assert.deepEqual(storageTree(f.stateRoot), before);
    const backed = await prepareStoppedBackupClosure(profileBrowserClosure, owner, restore, systemClock, f.processLockRoot).then(closure => backupStoppedAuthority(closure, owner, f.stateRoot, systemClock, f.processLockRoot, restore));
    const manifest = backed.manifests[0]; assert.ok(manifest);
    const verified = verifyStoppedBackupManifestAtPath(owner, join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`));
    const backedBefore = storageTree(f.stateRoot);
    assert.throws(() => AuthorityDatabase.upgradeStopped(owner, f.path, f.processLockRoot, systemClock,
      inspection.authorityContentFingerprint, { ...verified, manifest: { ...verified.manifest, sha256: FingerprintSchema.parse("0".repeat(64)) } }, verifyStoppedBackupManifestAtPath),
    { message: "profile-stopped-upgrade-backup-changed" });
    assert.deepEqual(storageTree(f.stateRoot), backedBefore);
    const original = readFileSync(verified.backupPath), sourceBefore = rawEight(f.path);
    try {
      const changed = Buffer.from(original); changed[0] = (changed[0] ?? 0) ^ 1;
      writeFileSync(verified.backupPath, changed);
      assert.throws(() => verifyStoppedBackupManifestAtPath(owner, verified.manifestPath),
        { message: "profile-maintenance-backup-digest-mismatch" });
      assert.deepEqual(rawEight(f.path), sourceBefore);
    } finally { writeFileSync(verified.backupPath, original); }
  } finally { owner.release(); restore.release(); await f.close(); }
});

it("refuses changed source content inside the real migration transaction and cannot revive its purpose", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  try {
    const inspection = AuthorityDatabase.inspectStoppedUpgrade(owner, f.path, f.processLockRoot, systemClock);
    const backed = await prepareStoppedBackupClosure(profileBrowserClosure, owner, restore, systemClock, f.processLockRoot).then(closure => backupStoppedAuthority(closure, owner, f.stateRoot, systemClock, f.processLockRoot, restore));
    const manifest = backed.manifests[0]; assert.ok(manifest);
    const verified = verifyStoppedBackupManifestAtPath(owner, join(f.stateRoot, "backups", "authority", `${manifest.backupFileName}.manifest.json`));
    const raw = new DatabaseSync(f.path);
    const original = raw.prepare("SELECT updated_at FROM database_states WHERE id=1").get()?.updated_at;
    assert.ok(typeof original === "string");
    try { assert.equal(raw.prepare("UPDATE database_states SET updated_at=? WHERE id=1").run(new Date(Date.now() + 1000).toISOString()).changes, 1); }
    finally { raw.close(); }
    const before = storageTree(f.stateRoot);
    assert.throws(() => AuthorityDatabase.upgradeStopped(owner, f.path, f.processLockRoot, systemClock,
      inspection.authorityContentFingerprint, verified, verifyStoppedBackupManifestAtPath), { message: "profile-stopped-upgrade-source-changed" });
    assert.deepEqual(storageTree(f.stateRoot), before);
    const restored = new DatabaseSync(f.path);
    try { assert.equal(restored.prepare("UPDATE database_states SET updated_at=? WHERE id=1").run(original).changes, 1); }
    finally { restored.close(); }
    assert.throws(() => owner.assertLive(), { message: "profile-stopped-upgrade-source-changed" });
  } finally { owner.release(); restore.release(); await f.close(); }
});

it("revokes READY custody on a same-byte key replacement even after exact original custody returns", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  const key = join(f.machine.stateRoot, "machine", "credential-keys", `${f.binding.profileId}.json`);
  const saved = join(f.workspace, "owned-key-preimage");
  let moved = false;
  try {
    const before = readFileSync(key);
    renameSync(key, saved); moved = true; copyFileSync(saved, key);
    assert.throws(() => owner.assertLive(), { message: "runtime-control: profile-stopped-upgrade-authority-changed" });
    assert.deepEqual(readFileSync(key), before);
    renameSync(saved, key); moved = false;
    assert.equal(f.machine.readProfileRegistry().profiles.find(value => value.profileId === f.binding.profileId)?.credentialState, "saved");
    assert.throws(() => owner.assertLive(), { message: "profile-stopped-upgrade-source-changed" });
  } finally {
    if (moved) renameSync(saved, key);
    owner.release(); restore.release(); await f.close();
  }
});

it("excludes registry session mutation while READY maintenance custody is held", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  try {
    const before = storageTree(f.stateRoot), registry = f.machine.readProfileRegistry();
    assert.throws(() => f.machine.publishProfileRegistry(registry, { ...registry, activeProfileId: null, sessionGeneration: registry.sessionGeneration + 1 }), /offline-maintenance-busy/u);
    assert.deepEqual(f.machine.readProfileRegistry(), registry);
    owner.assertLive();
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally { owner.release(); restore.release(); await f.close(); }
});

it("refuses loss of the authenticated canonical head instead of treating it as a default", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  const head = join(f.machine.stateRoot, "machine", "credential-keys", `${f.binding.profileId}.json`), saved = join(f.workspace, "owned-head-preimage");
  let moved = false;
  try {
    assert.equal(existsSync(head), true);
    renameSync(head, saved); moved = true;
    const before = storageTree(f.stateRoot);
    assert.throws(() => owner.assertLive(), { message: "runtime-control: profile-stopped-upgrade-key-required" });
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally {
    if (moved) renameSync(saved, head);
    owner.release(); restore.release(); await f.close();
  }
});

it("excludes a new signup operation while READY maintenance custody is held", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  try {
    const before = storageTree(f.stateRoot);
    const emailKey = createProfileVerifiers(f.machine.stateRoot).emailKeyFor(`${randomUUID()}@example.invalid`);
    const registry = f.machine.readProfileRegistry();
    assert.throws(() => f.machine.beginProfileSignUp({ firstName: "Upgrade", lastName: "Pending", createdAt: IsoInstantSchema.parse(systemClock.now().toISOString()),
      emailKey, commandFingerprint: "a".repeat(64) }), /offline-maintenance-busy/u);
    assert.deepEqual(f.machine.readProfileRegistry(), registry);
    owner.assertLive();
    assert.deepEqual(storageTree(f.stateRoot), before);
  } finally { owner.release(); restore.release(); await f.close(); }
});

it("cannot recreate a ready source removed after real stopped inspection and before native writable open", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  const saved = join(f.workspace, "owned-source-preimage");
  const inspect = AuthorityDatabase.inspectStoppedUpgrade.bind(AuthorityDatabase);
  let crossed = false;
  const spy = vi.spyOn(AuthorityDatabase, "inspectStoppedUpgrade").mockImplementation((actual, path, root, clock) => {
    assert.equal(actual, owner); assert.equal(path, f.path); assert.equal(root, f.processLockRoot);
    const result = inspect(actual, path, root, clock);
    assert.equal(result.schemaVersion, 8);
    renameSync(f.path, saved); crossed = true;
    return result;
  });
  try {
    const before = storageTree(f.stateRoot);
    delete before["state.db"];
    assert.throws(() => AuthorityDatabase.upgradeStopped(owner, f.path, f.processLockRoot, systemClock),
      error => error instanceof Error && Reflect.get(error, "code") === "ERR_SQLITE_ERROR" && Reflect.get(error, "errcode") === 14);
    assert.equal(crossed, true);
    assert.equal(existsSync(f.path), false);
    assert.deepEqual(storageTree(f.stateRoot), before);
    assert.throws(() => owner.assertLive(), { message: "profile-stopped-upgrade-source-changed" });
  } finally {
    spy.mockRestore();
    if (crossed) renameSync(saved, f.path);
    owner.release(); restore.release(); await f.close();
  }
});

it("refuses an unowned copy before issuing any READY migration or backup authority", async () => {
  const f = await readyBoundEight();
  try {
    writeFileSync(join(f.stateRoot, "owned-unclassified-copy"), "{}", { mode: 0o600, flag: "wx" });
    const before = storageTree(f.stateRoot);
    await assert.rejects(upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock),
      { message: "profile-inventory-unowned-entry" });
    assert.deepEqual(storageTree(f.stateRoot), before);
    assert.equal(existsSync(join(f.stateRoot, "backups")), false);
  } finally { await f.close(); }
});

it("revokes READY custody on exact artifact-root ancestry substitution", async () => {
  const f = await readyBoundEight(), restore = f.acquireRestore();
  const owner = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
  const artifacts = join(f.stateRoot, "artifacts"), saved = join(f.workspace, "owned-artifacts-preimage");
  let moved = false;
  try {
    assert.deepEqual(readdirSync(artifacts), []);
    const before = storageTree(f.stateRoot);
    renameSync(artifacts, saved); moved = true; mkdirSync(artifacts, { mode: 0o700 });
    assert.throws(() => owner.assertLive(), { message: "directory-integrity: credential ancestor identity changed" });
    assert.deepEqual(storageTree(f.stateRoot), before);
    rmdirSync(artifacts); renameSync(saved, artifacts); moved = false;
    assert.throws(() => owner.assertLive(), { message: "profile-stopped-upgrade-source-changed" });
  } finally {
    if (moved) { assert.deepEqual(readdirSync(artifacts), []); rmdirSync(artifacts); renameSync(saved, artifacts); }
    owner.release(); restore.release(); await f.close();
  }
});

it.each([9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const)("upgrades supported schema %s to the current version with exact source proof", async sourceVersion => {
  const f = await readyBoundEight("idle", sourceVersion);
  try {
    const before = rawEight(f.path);
    const result = await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock);
    assert.deepEqual(result, { state: "upgraded", fromSchemaVersion: sourceVersion, toSchemaVersion: CURRENT_AUTHORITY_SCHEMA_VERSION, credentials: "unchanged" });
    const upgraded = new DatabaseSync(f.path, { readOnly: true });
    try {
      assert.ok(upgraded.prepare("PRAGMA table_info(runs)").all().some(column => column.name === "pause_state"));
      assert.equal(upgraded.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE type='trigger' AND name IN ('run_pause_insert','run_pause_update')").get()?.count, 2);
    } finally { upgraded.close(); }
    assertGrantTableRetired(f.path);
    const after = rawEight(f.path);
    for (const [table, rows] of Object.entries(before)) {
      if (table === "database_states") assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, schema_version: CURRENT_AUTHORITY_SCHEMA_VERSION })));
      else if (table === "runs") assert.deepEqual(after[table]?.map(row => ({ ...row })), rows.map(row => ({ ...row, pause_state: null })));
      else if (table === "database_upgrades") assert.deepEqual(after[table]?.slice(0, rows.length), rows);
      else if (table === "run_results" || table === "run_receipts") assertUpgradedRunSettlementRows(table, after[table] ?? [], before);
      else assert.deepEqual(after[table]?.map(row => sourceVersion < 16 ? prePreferencesSettingsRow(table, row) : { ...row }), rows.map(row => ({ ...row })));
    }
    const fresh = f.machine.admitProfile(f.binding.profileId);
    try { assert.equal(fresh.profileMaintenanceSchemaVersion(), CURRENT_AUTHORITY_SCHEMA_VERSION); }
    finally { fresh.release(); }
  } finally { await f.close(); }
});

it.each([11, 12] as const)('upgrades populated schema %s workbooks without replacing masters or claiming automatic revisions were operator versions', async version => {
  const f = await readyBoundEight('idle', version);
  const at = '2026-01-01T00:00:00.000Z';
  const first = { libraryId: 'migration-workbook', version: 1, createdAt: at, savedAt: at,
    workbook: { libraryId: 'migration-workbook', name: 'Before.xlsx', themes: [], hasFormulas: false,
      sheets: [{ id: 'sheet', name: 'People', width: 1, hidden: [], rows: [{ id: 'row', cells: [{ value: 'original' }] }] }] } };
  const second = { ...first, version: 2, workbook: { ...first.workbook, name: 'Master.xlsx' } };
  const raw = new DatabaseSync(f.path);
  try {
    raw.prepare('INSERT INTO workbook_library(id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(second.libraryId, 2, at, at, JSON.stringify(second));
    for (const record of [first, second]) raw.prepare('INSERT INTO workbook_library_history(workbook_id,version,created_at,saved_at,payload_json) VALUES(?,?,?,?,?)').run(record.libraryId, record.version, at, at, JSON.stringify(record));
    assert.equal(inspectNativeAuthority(raw, version).schemaVersion, version);
  } finally { raw.close(); }
  try {
    assert.equal((await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock)).state, 'upgraded');
    const admission = f.machine.admitProfile(f.claim);
    try {
      const database = AuthorityDatabase.open(admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: 'workbook-upgrade-proof' }, systemClock, undefined, undefined, undefined, createCredentialStore({ admission, stateRoot: f.stateRoot }));
      try {
        assert.deepEqual(database.authority.workbooks.read(first.libraryId), second);
        assert.deepEqual(database.authority.workbooks.creation(first.libraryId), first);
        assert.deepEqual(database.authority.workbooks.versions(first.libraryId).map(({ name, provenance }) => ({ name, provenance })), [
          { name: 'Saved revision 1', provenance: 'migration' }, { name: 'Saved revision 2', provenance: 'migration' }]);
        assert.equal(database.authority.workbooks.metadata(first.libraryId).typeId, 'general');
        assert.equal(inspectAuthorityBackupReadOnly(admission, f.path).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
      } finally { database.close(); }
    } finally { admission.release(); }
  } finally { await f.close(); }
});

it("backs up schema-11 extraction evidence before conversion and retains both source states after restart", async () => {
  const f = await readyBoundEight("idle", 11, true);
  try {
    const extraction = donePage(sourceFixture(1).inputs[0]).output.extraction;
    const id = `${extraction.sourceSha256}#${extraction.sourcePage}#${extraction.formType}`;
    const before = rawEight(f.path).artifacts;
    assert.equal(before?.length, historicalOcrExtractions().length);
    await upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock);
    const restore = f.acquireRestore();
    try {
      const stopped = await f.machine.forStoppedProfileUpgrade(profileBrowserClosure, f.claim, restore, systemClock, hostFacts);
      try {
        const directory = join(f.stateRoot, "backups", "authority");
        const manifests = readdirSync(directory).filter(name => name.endsWith(".manifest.json"));
        assert.equal(manifests.length, 1);
        const backup = verifyStoppedBackupManifestAtPath(stopped, join(directory, manifests[0]));
        assert.equal(backup.manifest.schemaVersion, 11);
        const raw = new DatabaseSync(backup.backupPath, { readOnly: true });
        try { assert.deepEqual(raw.prepare("SELECT * FROM artifacts").all(), before); }
        finally { raw.close(); }
      } finally { stopped.release(); }
    } finally { restore.release(); }
    const admission = f.machine.admitProfile(f.claim);
    try {
      const credentials = createCredentialStore({ admission, stateRoot: f.stateRoot });
      const database = AuthorityDatabase.open(admission, { path: f.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock,
        undefined, undefined, undefined, credentials);
      try {
        assert.deepEqual(database.authority.ocrExtractions.get(id), { binding: "unbound-source", extractionId: id, extraction });
        for (const retained of historicalOcrExtractions()) {
          const extractionId = `${retained.sourceSha256}#${retained.sourcePage}#${retained.formType}`;
          assert.deepEqual(database.authority.ocrExtractions.get(extractionId), { binding: "unbound-source", extractionId, extraction: retained });
        }
        const reading = donePage(sourceFixture(1).inputs[0]).output;
        assert.equal(database.authority.ocrExtractions.insert(reading).state, "inserted");
        assert.deepEqual(database.authority.ocrExtractions.findBySource(extraction.sourceSha256).map(record => record.binding).sort(),
          ["source-bound", ...historicalOcrExtractions().map(() => "unbound-source")]);
      } finally { database.close(); }
    } finally { admission.release(); }
    const restarted = f.machine.admitProfile(f.claim);
    try {
      const database = AuthorityDatabase.open(restarted, { path: f.path, busyTimeoutMs: 250, migrationOwner: "selected-profile-runtime" }, systemClock,
        undefined, undefined, undefined, createCredentialStore({ admission: restarted, stateRoot: f.stateRoot }));
      try { assert.equal(database.authority.ocrExtractions.findBySource(extraction.sourceSha256).length, historicalOcrExtractions().length + 1); }
      finally { database.close(); }
    } finally { restarted.release(); }
  } finally { await f.close(); }
});

it.each(["artifact-id", "source-column", "payload"] as const)("refuses a stopped schema-11 OCR upgrade with malformed %s without changing source bytes or identity", async fault => {
  const f = await readyBoundEight("idle", 11, true);
  try {
    const raw = new DatabaseSync(f.path);
    try { insertMalformedLegacyOcrExtraction(raw, fault); } finally { raw.close(); }
    const rows = rawEight(f.path), sourceBytes = readFileSync(f.path);
    const before = storageTree(f.stateRoot), machineBefore = storageTree(join(f.machine.stateRoot, "machine"));
    await assert.rejects(upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock),
      /authority table artifacts failed native record validation/u);
    assert.deepEqual(rawEight(f.path), rows);
    assert.deepEqual(readFileSync(f.path), sourceBytes);
    assert.deepEqual(storageTree(f.stateRoot), before);
    assert.deepEqual(storageTree(join(f.machine.stateRoot, "machine")), machineBefore);
    const unchanged = new DatabaseSync(f.path, { readOnly: true });
    try {
      assert.equal(unchanged.prepare("PRAGMA user_version").get()?.user_version, 11);
      assert.equal(unchanged.prepare("SELECT schema_version FROM database_states").get()?.schema_version, 11);
    } finally { unchanged.close(); }
  } finally { await f.close(); }
});

const namedWorkbookSnapshot = { ...workbookReferenceValue.snapshot, versionId: "selected", versionName: "Selected" };
const allWorkbookRequest = { mode: "all", typeId: "upgrade-roster", libraryId: "upgrade-workbook", expectedVersion: 1, fields: ["eid"] };
const workbookFormats = [
  { format: "master-keyed", schema: RunWorkbookReferenceSchema, value: workbookReferenceValue },
  { format: "master-all", schema: RunWorkbookAllRowsReferenceSchema, value: { request: allWorkbookRequest, snapshot: workbookReferenceValue.snapshot } },
  { format: "named-keyed", schema: RunWorkbookNamedReferenceSchema, value: { request: { ...workbookReferenceValue.request, versionId: "selected" }, snapshot: namedWorkbookSnapshot } },
  { format: "named-all", schema: RunWorkbookNamedAllRowsReferenceSchema, value: { request: { ...allWorkbookRequest, versionId: "selected" }, snapshot: namedWorkbookSnapshot } },
  { format: "selected-row", schema: RunWorkbookSelectedRowReferenceSchema, value: { request: { ...workbookReferenceValue.request, versionId: "selected", selectedRow: { sheetId: "people", rowId: "person" } }, snapshot: namedWorkbookSnapshot } },
];
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

it.each(([17, 18] as const).flatMap(version => (["run", "terminal-run", "plan", "consumed-plan"] as const).map(owner => ({ version, owner }))))(
  "refuses schema $version incompatible $owner references without changing authority", async ({ version, owner }) => {
    const f = await readyBoundEight(owner.includes("run") ? "queued" : "idle", version, false, { owner, schemaHash: "a".repeat(64) });
    try {
      const bytes = readFileSync(f.path), before = rawEight(f.path, version);
      await assert.rejects(owner === "run"
        ? upgradeProfileAtStartup(profileBrowserClosure, f.machine, f.claim, hostFacts, systemClock)
        : upgradeReadyProfileStorage(profileBrowserClosure, f.machine, f.claim, { plan: false, hostFacts }, systemClock), /workbook_reference_schema_upgrade_unproved/u);
      assert.deepEqual(readFileSync(f.path), bytes);
      assert.deepEqual(rawEight(f.path, version), before);
      const raw = new DatabaseSync(f.path, { readOnly: true });
      try {
        assert.equal(raw.prepare("PRAGMA user_version").get()?.user_version, version);
        assert.equal(inspectNativeAuthority(raw, version).schemaVersion, version);
        assert.equal(raw.prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name='workbook_reference_upgrade_guard'").get()?.count, 0);
      } finally { raw.close(); }
    } finally { await f.close(); }
});
