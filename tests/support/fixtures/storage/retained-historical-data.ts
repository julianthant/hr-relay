import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { initialSettingsFileRecord } from "../../../../src/models/config/settings.js";
import { ConfigSnapshotRecordSchema } from "../../../../src/models/config/snapshot.js";
import { ActiveRuntimeConfigRecordSchema } from "../../../../src/models/config/runtime-generation.js";
import { SettingsInitializationAuditSchema, SettingsInitializationCommandSchema } from "../../../../src/models/config/settings-initialization.js";
import { writeAppSettings } from "../../../../src/backend/storage/sqlite/settings-storage.js";
import { insertNativeCommand, settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { QUEUED_RUN } from "../phase1f-run-fixtures.js";
import { ledgerCommitFixture } from "../ledger-projection-fixtures.js";
import { separationsDescriptor } from "../../helpers/registered-workflows.js";
import { WriteAttemptRecordSchema, WriteIntentRecordSchema, deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-safety.js";

export function retainedHistoricalData(f: { databasePath: string; profileRoot: string }, unknownWrite = false, schemaVersion = 9) {
  const raw = new DatabaseSync(f.databasePath), at = "2026-10-01T12:00:00.000Z";
  const evidence = Buffer.from("Historical recovery evidence"), sha256 = createHash("sha256").update(evidence).digest("hex");
  const artifactRef = { id: randomUUID(), sha256, bytes: evidence.length, mediaType: "text/plain" };
  try {
    raw.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    const resolved = resolveConfigWithProvenance(initialSettingsFileRecord().settings, { primaryDisplay: null }, capturedInstantClock(at),
      { stateRoot: f.profileRoot, artifactRoot: join(f.profileRoot, "artifacts") });
    const workspace = dirname(dirname(f.profileRoot));
    const config = schemaVersion === 6 ? { ...resolved.config, paths: { ...resolved.config.paths,
      reportsDir: join(workspace, "data", "reports"), downloadsDir: join(workspace, "data", "downloads"),
      onboardingDocsDir: join(workspace, "data", "onboarding"), i9CheckTrackerPath: join(workspace, "data", "reports", "i9-check-tracker.xlsx") } } : resolved.config;
    const snapshot = ConfigSnapshotRecordSchema.parse({ configSnapshotId: randomUUID(), revision: 1, fingerprint: createHash("sha256").update(canonicalJsonStringify(config)).digest("hex"),
      capturedAt: at, capturedBy: "local-operator", config, provenance: resolved.provenance });
    raw.prepare("INSERT INTO settings_snapshots (id,revision,fingerprint,payload_json,captured_at) VALUES (?,?,?,?,?)")
      .run(snapshot.configSnapshotId, snapshot.revision, snapshot.fingerprint, canonicalJsonStringify(snapshot), snapshot.capturedAt);
    const command = SettingsInitializationCommandSchema.parse({ kind: "settings-initialization", commandId: randomUUID(), revision: 1,
      settings: initialSettingsFileRecord(), configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, initializedAt: at });
    const audit = SettingsInitializationAuditSchema.parse({ kind: "settings-initialization", auditId: randomUUID(), request: command,
      result: { state: "initialized", revision: 1, snapshotId: snapshot.configSnapshotId, fingerprint: snapshot.fingerprint }, completedAt: at });
    insertNativeCommand(raw, command); settleNativeCommand(raw, audit);
    raw.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES (?,?,NULL,?,?)")
      .run(audit.auditId, command.commandId, canonicalJsonStringify(audit), at);
    writeAppSettings(raw, { format: 1, saved: null, active: ActiveRuntimeConfigRecordSchema.parse({ generation: 1, settingsRevision: 1,
      settingsFingerprint: initialSettingsFileRecord().settingsFingerprint, configSnapshotId: snapshot.configSnapshotId,
      configFingerprint: snapshot.fingerprint, activatedAt: at }), initialization: { commandId: command.commandId, auditId: audit.auditId,
      configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint, initializedAt: command.initializedAt, settings: command.settings } });
    const runId = randomUUID();
    const ledger = ledgerCommitFixture(81, { runId, itemId: QUEUED_RUN.envelope.itemId, traceId: QUEUED_RUN.envelope.traceId,
      workflowId: separationsDescriptor.id, configFingerprint: snapshot.fingerprint, instance: "prod" });
    const reason = deriveWriteAuthorityReason("post-click-verifier-unknown", "probe", "synthetic historical unknown observation");
    const intent = WriteIntentRecordSchema.parse({ ...ledger.intent, version: 2, status: "parked", parkedCode: "unknown", message: "Historical outcome remains unknown", authorityReason: reason });
    const run = RunRecordSchema.parse({ ...QUEUED_RUN, input: { ...QUEUED_RUN.input, raw: { ...QUEUED_RUN.input.raw, historicalEvidence: artifactRef } }, envelope: { ...QUEUED_RUN.envelope, runId,
      ...(unknownWrite ? { workflow: separationsDescriptor.id, descriptorVersion: separationsDescriptor.version, contractFingerprint: separationsDescriptor.contractFingerprint } : {}),
      configSnapshotId: snapshot.configSnapshotId, configFingerprint: snapshot.fingerprint },
      lifecycle: unknownWrite ? { state: "parked-write", writeIntentId: intent.writeIntentId, intentGeneration: intent.generation, parkedAt: at, code: "unknown", message: "Historical outcome remains unknown" }
        : { state: "terminal", outcome: "interrupted", endedAt: at }, version: 5, updatedAt: at });
    const columns = runRecordColumns(run), keys = Object.keys(columns);
    raw.prepare(`INSERT INTO runs (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(columns));
    if (unknownWrite) {
      const attempt = WriteAttemptRecordSchema.parse({ ...ledger.attempt, outcome: { state: "parked", code: "unknown", message: "Historical outcome remains unknown", authorityReason: reason } });
      raw.prepare("INSERT INTO write_intents(id,system,idempotency_key,idempotency_key_digest,status,generation,run_id,payload_json,publication_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,NULL,?,?)")
        .run(intent.writeIntentId, intent.system, intent.idempotencyKey, intent.idempotencyKeyDigest, intent.status, intent.generation, runId, canonicalJsonStringify(intent), intent.createdAt, intent.updatedAt);
      raw.prepare("INSERT INTO write_attempts(id,intent_id,generation,run_id,payload_json,created_at) VALUES(?,?,?,?,?,?)")
        .run(attempt.writeAttemptId, attempt.writeIntentId, attempt.generation, runId, canonicalJsonStringify(attempt), attempt.recordedAt);
    }
    raw.prepare("UPDATE database_states SET authority_generation=authority_generation+1,search_generation=NULL,search_state='invalid',updated_at=? WHERE id=1").run(at);
    raw.exec("COMMIT"); inspectNativeAuthority(raw, schemaVersion); raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally { raw.close(); }
  const artifacts = join(f.profileRoot, "artifacts"); mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  const artifact = join(artifacts, `${sha256}.artifact`); writeFileSync(artifact, JSON.stringify({ ref: artifactRef, payloadBase64: evidence.toString("base64") }), { mode: 0o600 });
  return artifact;
}

