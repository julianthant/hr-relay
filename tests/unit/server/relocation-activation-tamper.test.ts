import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { hostConfigFacts } from "../../../src/domain/config/host-display.js";
import { acquireExclusiveRuntimeAdmission } from "../../../src/infra/runtime-control/admission.js";
import { inspectPendingRelocationStatus } from "../../../src/infra/runtime-control/installation.js";
import { runOfflineStorageRelocation, StorageRelocationIncompleteError } from "../../../src/server/storage/relocate.js";
import { cleanupFixtureRoots, clock, installation, leaveStoppedWal, plan } from "./helpers/storage-relocation-fixture.js";

afterEach(cleanupFixtureRoots);

async function interruptAfterActivation(workspace: string, commandId: string): Promise<string> {
  const admission = acquireExclusiveRuntimeAdmission(workspace);
  try {
    await assert.rejects(runOfflineStorageRelocation({ workspace,
      command: { kind: "plan", id: commandId, json: false }, admission, clock, hostFacts: hostConfigFacts({}),
      faults: { afterActivationWrite: () => { throw new Error("synthetic-activation-interruption"); } } }), (error) => {
      assert.ok(error instanceof StorageRelocationIncompleteError);
      assert.match(String(error.cause), /synthetic-activation-interruption/u);
      return true;
    });
  } finally { admission.release(); }
  const status = inspectPendingRelocationStatus(workspace);
  assert.ok(status);
  return status.operationId;
}

async function assertTamperedResumeRefuses(workspace: string, operationId: string, pattern: RegExp): Promise<void> {
  await assert.rejects(runOfflineStorageRelocation({ workspace,
    command: { kind: "resume", id: operationId, json: false }, clock, hostFacts: hostConfigFacts({}) }), (error) => {
    assert.ok(error instanceof StorageRelocationIncompleteError);
    assert.match(String(error.cause), pattern);
    return true;
  });
}

it("refuses an unrelated authority row changed after committed activation", async () => {
  const fixture = await installation();
  leaveStoppedWal(fixture.workspace, fixture.authorityPath);
  const destination = { stateRoot: join(fixture.root, "new-state"), artifactRoot: join(fixture.root, "new-artifacts") };
  const request = plan(fixture.workspace, destination);
  const operationId = await interruptAfterActivation(fixture.workspace, request.commandId);
  const raw = new DatabaseSync(join(destination.stateRoot, "state.db"));
  try {
    const changed = raw.prepare("UPDATE notifications SET record_json=json_set(record_json,'$.title','Tampered notice') WHERE record_key=(SELECT record_key FROM notifications LIMIT 1)")
      .run();
    assert.equal(changed.changes, 1);
  } finally { raw.close(); }
  await assertTamperedResumeRefuses(fixture.workspace, operationId, /unrelated authority rows changed.*notifications/u);
});

it("refuses an extra config snapshot after committed activation", async () => {
  const fixture = await installation();
  const destination = { stateRoot: join(fixture.root, "new-state"), artifactRoot: join(fixture.root, "new-artifacts") };
  const request = plan(fixture.workspace, destination);
  const operationId = await interruptAfterActivation(fixture.workspace, request.commandId);
  const raw = new DatabaseSync(join(destination.stateRoot, "state.db"));
  try {
    const source = raw.prepare("SELECT record_json,created_at FROM settings_snapshots ORDER BY rowid DESC LIMIT 1").get() as
      | { record_json: string; created_at: string } | undefined;
    assert.ok(source);
    const snapshot = JSON.parse(source.record_json) as Record<string, unknown>;
    const id = randomUUID();
    raw.prepare("INSERT INTO settings_snapshots(record_key,record_json,created_at) VALUES (?,?,?)")
      .run(id, canonicalJsonStringify({ ...snapshot, configSnapshotId: id }), source.created_at);
  } finally { raw.close(); }
  await assertTamperedResumeRefuses(fixture.workspace, operationId, /activation snapshot history changed/u);
});

it("refuses a search publication changed beyond the activation generation", async () => {
  const fixture = await installation();
  const destination = { stateRoot: join(fixture.root, "new-state"), artifactRoot: join(fixture.root, "new-artifacts") };
  const request = plan(fixture.workspace, destination);
  const operationId = await interruptAfterActivation(fixture.workspace, request.commandId);
  const raw = new DatabaseSync(join(destination.stateRoot, "state.db"));
  try {
    const changed = raw.prepare("UPDATE run_search_publication SET record_json=json_set(record_json,'$.rowCount',999) WHERE record_key='current'").run();
    assert.equal(changed.changes, 1);
  } finally { raw.close(); }
  await assertTamperedResumeRefuses(fixture.workspace, operationId, /search publication differs from activation transaction/u);
});
