import { runtimeLifetimeLock } from "../backend/runtime-lifetime.js";
import type { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { once } from "node:events";
import { z } from "zod";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeSettingsCommand, executeStorageRelocationCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createStorageRelocationPlanReader } from "../../../../src/backend/storage/maintenance/storage-relocation-plans.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { StorageRelocationCommandRequestSchema, storageRelocationDesiredDigest,
  storageRelocationRequestFingerprint } from "../../../../src/rules/commands/commands.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../src/models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH, ProtectedSettingsApplyInputSchema } from "../../../../src/models/config/protected-settings.js";
import { NonNegativeIntSchema } from "../../../../src/rules/identity/ids.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { acquireExclusiveRuntimeAdmission, acquireInitialRuntimeAdmission, acquireSharedRuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { runOfflineStorageRelocation, StorageRelocationIncompleteError } from "../../../../src/backend/app/composition/storage/relocate.js";

export const clock = manualClock(new Date("2026-09-26T12:00:00.000Z"));
export const WAL_NOTIFICATION_TITLE = "Synthetic WAL-backed relocation notice";
const cleanup: string[] = [];
export function cleanupFixtureRoots(): void { for (const root of cleanup.splice(0)) rmSync(root, { recursive: true, force: true }); }

export async function installation() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "storage-relocation-offline-"));
  cleanup.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace, { mode: 0o700 });
  const source = { stateRoot: join(workspace, rebuildRuntimeIsolation.stateRoot),
    artifactRoot: join(workspace, rebuildRuntimeIsolation.artifactRoot) };
  const lifetime = await runtimeLifetimeLock();
  const authorityPath = join(source.stateRoot, "state.db");
  const admission = acquireInitialRuntimeAdmission(workspace, lifetime,
    (pair, inspection) => ({ kind: "verified-existing", pair,
      authorityGeneration: AuthorityDatabase.inspectExistingReadOnly(inspection, authorityPath).authorityGeneration,
      databaseIdentity: AuthorityDatabase.sourceDatabaseIdentity(authorityPath) }),
    (_pair, initialization) => {
      AuthorityDatabase.open(initialization, { path: authorityPath, busyTimeoutMs: 250,
        migrationOwner: "offline-relocation-fixture" }, clock).close();
    });
  const database = AuthorityDatabase.open(admission, { path: authorityPath, busyTimeoutMs: 250,
    migrationOwner: "offline-relocation-fixture" }, clock);
  const initial = resolveConfigWithProvenance({}, hostConfigFacts({}), clock, admission);
  database.authority.runtimeConfig.initialize({ configSnapshotId: randomUUID(), revision: 1,
    fingerprint: initial.fingerprint, config: initial.config, provenance: initial.provenance,
    capturedAt: clock.now().toISOString(), capturedBy: "local-operator" });
  const credentials = createCredentialStore({ admission, stateRoot: source.stateRoot });
  const credentialWrite = credentials.apply(ProtectedSettingsApplyInputSchema.parse({ commandId: randomUUID(),
    commandFingerprint: "1".repeat(64), expectedRevision: credentials.read().revision,
    protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: randomUUID(),
    entries: { ucpathPassword: { set: "synthetic-offline-relocation-value" } }, updatedAt: clock.now().toISOString() }));
  assert.equal(credentialWrite.state, "applied");
  const patch = { "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 } } as const;
  const ordinary = executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor((value) => resolveConfigWithProvenance(value,
      hostConfigFacts({}), clock, admission), credentials) }, {
    family: "settings", type: "apply-settings", commandId: randomUUID(), requestedAt: clock.now().toISOString(),
    requestedBy: "local-operator", source: "settings-surface",
    target: { expectedRevision: readSettings(database.authority).revision },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
  });
  assert.equal(ordinary.state, "applied", JSON.stringify(ordinary));
  const artifacts = createContentAddressedArtifactWriter({ admission });
  await artifacts.ready;
  const artifact = await artifacts.put(Buffer.from("synthetic-artifact-bytes"), { mediaType: "application/octet-stream" });
  database.close();
  admission.release();
  return { root, workspace, lifetime, source, authorityPath,
    credentialFile: join(source.stateRoot, "credentials", "protected.json"),
    artifactFile: join(source.artifactRoot, `${artifact.sha256}.artifact`), artifact };
}

export async function relocate(workspace: string, lifetime: RuntimeLifetimeLock, requestId: string) {
  const admission = acquireExclusiveRuntimeAdmission(workspace, lifetime);
  try {
    return await runOfflineStorageRelocation({ workspace, lifetime,
      command: { kind: "plan", id: requestId, json: false }, admission, clock, hostFacts: hostConfigFacts({}) });
  } finally { admission.release(); }
}

export async function interruptedRelocation(workspace: string, lifetime: RuntimeLifetimeLock, requestId: string,
  fault: "afterNativePublish" | "afterActivationIntent" | "beforeActivationTransaction" | "afterActivationWrite"
    | "afterFinalBackup" | "afterVerifiedStage"
    | "afterFence" | "afterRetention" | "afterSwitch") {
  const admission = acquireExclusiveRuntimeAdmission(workspace, lifetime);
  let operationId: string | undefined;
  try {
    await assert.rejects(runOfflineStorageRelocation({ workspace, lifetime,
      command: { kind: "plan", id: requestId, json: false }, admission, clock, hostFacts: hostConfigFacts({}),
      faults: { [fault]: () => { throw new Error(`synthetic-interruption-${fault}`); } } }), error => {
      assert.ok(error instanceof StorageRelocationIncompleteError);
      assert.match(String(error.cause), new RegExp(`synthetic-interruption-${fault}`, "u"));
      operationId = error.operationId;
      return true;
    });
  } finally { admission.release(); }
  assert.ok(operationId);
  return runOfflineStorageRelocation({ workspace, lifetime,
    command: { kind: "resume", id: operationId, json: false }, clock, hostFacts: hostConfigFacts({}) });
}

export function plan(workspace: string, lifetime: RuntimeLifetimeLock, desiredPair: Readonly<{ stateRoot: string; artifactRoot: string }>) {
  const admission = acquireSharedRuntimeAdmission(workspace, lifetime);
  try {
    const authority = AuthorityDatabase.open(admission, { path: join(admission.stateRoot, "state.db"),
      busyTimeoutMs: 250, migrationOwner: "offline-relocation-fixture" }, clock);
    try {
      const reader = createStorageRelocationPlanReader({ authority, admission, workspace });
      const view = reader.read();
      const target = { installationId: admission.locator.installationId,
        sourceGeneration: NonNegativeIntSchema.parse(admission.locator.generation),
        sourcePair: { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot },
        expectedRevision: view.revision };
      const draft = StorageRelocationCommandRequestSchema.parse({ family: "storage-relocation",
        type: "plan-storage-relocation", commandId: randomUUID(), requestedAt: clock.now().toISOString(),
        requestedBy: "local-operator", source: "settings-surface", target,
        payload: { writeId: randomUUID(), desiredPair,
          desiredDigest: storageRelocationDesiredDigest(target, desiredPair), requestFingerprint: "0".repeat(64) } });
      const request = StorageRelocationCommandRequestSchema.parse({ ...draft, payload: { ...draft.payload,
        requestFingerprint: storageRelocationRequestFingerprint(draft) } });
      const result = executeStorageRelocationCommand({ authority, clock, ids: { uuid: randomUUID },
        storageRelocationPlans: reader }, request);
      assert.equal(result.state, "applied");
      return request;
    } finally { authority.close(); }
  } finally { admission.release(); }
}

export async function leaveStoppedWal(workspace: string, lifetime: RuntimeLifetimeLock, authorityPath: string): Promise<string> {
  const notificationId = randomUUID();
  const script = `const { AuthorityDatabase } = await import("./src/backend/storage/sqlite/authority-database.ts");
    const { acquireSharedRuntimeAdmission } = await import("./src/backend/storage/admission/admission.ts");
    const { NotificationRecordSchema } = await import("./src/models/notifications/notifications.ts");
    const { manualClock } = await import("./src/rules/time/clock.ts");
    const { WorkerRuntimeLifetimeLock } = await import("./src/backend/storage/admission/lifetime-lock.ts");
    const lifetime = await WorkerRuntimeLifetimeLock.receive(Number(process.argv[4]), () => process.exit(1));
    const admission = acquireSharedRuntimeAdmission(process.argv[1], lifetime);
    const database = AuthorityDatabase.open(admission,
      { path: process.argv[2], busyTimeoutMs: 250, migrationOwner: "offline-relocation-wal-child" },
      manualClock(new Date("2026-09-26T12:01:00.000Z")));
    const record = NotificationRecordSchema.parse({ notificationId: process.argv[3], actorId: "local-operator",
      dedupeFingerprint: "b".repeat(64), trigger: "backfill-gap", channel: "ping", status: "unread",
      snooze: { state: "not-snoozed" }, title: ${JSON.stringify(WAL_NOTIFICATION_TITLE)},
      summary: "Synthetic notice retained in WAL", links: [], count: 1, version: 1,
      createdAt: "2026-09-26T12:01:00.000Z", lastSeenAt: "2026-09-26T12:01:00.000Z",
      updatedAt: "2026-09-26T12:01:00.000Z" });
    database.withAuthorityTransaction(({ notifications }) => notifications.create(record));
    process.exit(0);`;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script,
    workspace, authorityPath, notificationId, String(lifetime.port)], { stdio: ["ignore", "pipe", "pipe", "ipc"], cwd: process.cwd() });
  assert.ok(child.stdout && child.stderr);
  let stderr = "";
  child.stdout.resume(); child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const closed = once(child, "close");
  try { await lifetime.share(child); }
  catch (error) {
    child.kill("SIGTERM");
    try { await closed; } catch (cleanup) { throw new AggregateError([error, cleanup], "WAL fixture transfer and owned child closure failed", { cause: cleanup }); }
    throw error;
  }
  const [code, signal] = z.tuple([z.number().int().nullable(), z.string().nullable()]).parse(await closed);
  assert.equal(signal, null, stderr); assert.equal(code, 0, stderr);
  assert.equal(existsSync(`${authorityPath}-wal`), true);
  return notificationId;
}

export function durableSnapshot(authorityPath: string, credentialFile: string, artifactFile: string) {
  const database = new DatabaseSync(authorityPath, { readOnly: true });
  try {
    const rows = (table: "settings" | "settings_snapshots" | "commands" | "command_audits" | "notifications") => database.prepare(
      `SELECT ${table === "commands" ? "request_json AS payload_json" : "payload_json"} FROM ${table} ORDER BY rowid`,
    ).all().map(row => String(row.payload_json));
    return { appSettings: rows("settings"), settingsSnapshots: rows("settings_snapshots"),
      commands: rows("commands"), audits: rows("command_audits"),
      notifications: rows("notifications"),
      credentialDigest: createHash("sha256").update(readFileSync(credentialFile)).digest("hex"),
      artifactDigest: createHash("sha256").update(readFileSync(artifactFile)).digest("hex") };
  } finally { database.close(); }
}
