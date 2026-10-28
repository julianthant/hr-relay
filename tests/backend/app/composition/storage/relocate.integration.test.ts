import type { RuntimeLifetimeLock } from "../../../../../src/backend/storage/admission/lifetime-lock.js";
import { default as assert } from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { copyNativeSnapshot, runOfflineStorageRelocation, StorageRelocationIncompleteError } from "../../../../../src/backend/app/composition/storage/relocate.js";
import { acquireExclusiveRuntimeAdmission, RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { inspectPendingRelocationStatus } from "../../../../../src/backend/storage/admission/installation.js";
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { cleanupFixtureRoots, clock as clock_m0, installation, leaveStoppedWal, plan } from "../../../../support/helpers/storage/storage-relocation-fixture.js";

import { parseRelocationCommand } from "../../../../../src/backend/app/composition/storage/relocate.js";

{

const _afterEachFixture0 = cleanupFixtureRoots;

async function interruptAfterActivation(workspace: string, lifetime: RuntimeLifetimeLock, commandId: string): Promise<string> {
  const admission = acquireExclusiveRuntimeAdmission(workspace, lifetime);
  try {
    await assert.rejects(runOfflineStorageRelocation({ workspace, lifetime,
      command: { kind: "plan", id: commandId, json: false }, admission, clock: clock_m0, hostFacts: hostConfigFacts({}),
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

async function assertTamperedResumeRefuses(workspace: string, lifetime: RuntimeLifetimeLock, operationId: string, pattern: RegExp): Promise<void> {
  await assert.rejects(runOfflineStorageRelocation({ workspace, lifetime,
    command: { kind: "resume", id: operationId, json: false }, clock: clock_m0, hostFacts: hostConfigFacts({}) }), (error) => {
    assert.ok(error instanceof StorageRelocationIncompleteError);
    assert.match(String(error.cause), pattern);
    return true;
  });
}

it("refuses an unrelated authority row changed after committed activation", async () => {
try {

  const fixture = await installation();
  await leaveStoppedWal(fixture.workspace, fixture.lifetime, fixture.authorityPath);
  const destination = { stateRoot: join(fixture.root, "new-state"), artifactRoot: join(fixture.root, "new-artifacts") };
  const request = plan(fixture.workspace, fixture.lifetime, destination);
  const operationId = await interruptAfterActivation(fixture.workspace, fixture.lifetime, request.commandId);
  const raw = new DatabaseSync(join(destination.stateRoot, "state.db"));
  try {
    const changed = raw.prepare("UPDATE notifications SET payload_json=json_set(payload_json,'$.title','Tampered notice') WHERE id=(SELECT id FROM notifications LIMIT 1)")
      .run();
    assert.equal(changed.changes, 1);
  } finally { raw.close(); }
  await assertTamperedResumeRefuses(fixture.workspace, fixture.lifetime, operationId, /unrelated authority rows changed.*notifications/u);

} finally {
_afterEachFixture0();
}
});

it("refuses an extra config snapshot after committed activation", async () => {
try {

  const fixture = await installation();
  const destination = { stateRoot: join(fixture.root, "new-state"), artifactRoot: join(fixture.root, "new-artifacts") };
  const request = plan(fixture.workspace, fixture.lifetime, destination);
  const operationId = await interruptAfterActivation(fixture.workspace, fixture.lifetime, request.commandId);
  const raw = new DatabaseSync(join(destination.stateRoot, "state.db"));
  try {
    const source = raw.prepare("SELECT payload_json,captured_at,revision,fingerprint FROM settings_snapshots ORDER BY rowid DESC LIMIT 1").get() as
      | { payload_json: string; captured_at: string; revision:number;fingerprint:string } | undefined;
    assert.ok(source);
    const snapshot = JSON.parse(source.payload_json) as Record<string, unknown>;
    const id = randomUUID();
    raw.prepare("INSERT INTO settings_snapshots(id,revision,fingerprint,payload_json,captured_at) VALUES (?,?,?,?,?)")
      .run(id,source.revision,source.fingerprint, canonicalJsonStringify({ ...snapshot, configSnapshotId: id }), source.captured_at);
  } finally { raw.close(); }
  await assertTamperedResumeRefuses(fixture.workspace, fixture.lifetime, operationId, /activation snapshot history changed/u);

} finally {
_afterEachFixture0();
}
});

it("refuses a search publication changed beyond the activation generation", async () => {
try {

  const fixture = await installation();
  const destination = { stateRoot: join(fixture.root, "new-state"), artifactRoot: join(fixture.root, "new-artifacts") };
  const request = plan(fixture.workspace, fixture.lifetime, destination);
  const operationId = await interruptAfterActivation(fixture.workspace, fixture.lifetime, request.commandId);
  const raw = new DatabaseSync(join(destination.stateRoot, "state.db"));
  try {
    const changed = raw.prepare("UPDATE database_states SET search_generation=999,search_state='invalid' WHERE id=1").run();
    assert.equal(changed.changes, 1);
  } finally { raw.close(); }
  await assertTamperedResumeRefuses(fixture.workspace, fixture.lifetime, operationId, /search publication differs from activation transaction/u);

} finally {
_afterEachFixture0();
}
});
}

{

it("replays only the exact interrupted native snapshot publication", () => {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "relocation-native-publication-")));
  const sourceRoot = join(workspace, "source");
  const destinationRoot = join(workspace, "destination");
  mkdirSync(sourceRoot, { mode: 0o700 });
  mkdirSync(destinationRoot, { mode: 0o700 });
  const source = join(sourceRoot, "source.sqlite");
  const destination = join(destinationRoot, "state.db");
  const operationId = randomUUID();
  const candidate = join(destinationRoot, `.relocation-${operationId}-state.db.tmp`);
  const bytes = Buffer.from("synthetic native snapshot bytes");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const admission = RuntimeAdmission.syntheticRoots(destinationRoot, join(destinationRoot, "artifacts"));
  try {
    writeFileSync(source, bytes, { mode: 0o600 });
    assert.throws(() => copyNativeSnapshot(source, destination, sha256, operationId, admission,
      () => { throw new Error("simulated crash after native link"); }), /simulated crash after native link/u);
    assert.equal(lstatSync(destination).nlink, 2);
    assert.equal(lstatSync(candidate).ino, lstatSync(destination).ino);
    copyNativeSnapshot(source, destination, sha256, operationId, admission);
    assert.equal(lstatSync(destination).nlink, 1);
    assert.equal(lstatSync(candidate, { throwIfNoEntry: false }), undefined);
    assert.deepEqual(readFileSync(destination), bytes);
    copyNativeSnapshot(source, destination, sha256, operationId, admission);
  } finally { admission.release(); rmSync(workspace, { recursive: true, force: true }); }
});
}

{

describe("secure environment bootstrap", () => {
  it("parses only exact offline relocation selectors", () => {
    assert.deepEqual(parseRelocationCommand(["--status", "--json"]), { kind: "status", json: true });
    assert.throws(() => parseRelocationCommand(["--status", "extra"]), /storage-relocation-usage/u);
    assert.throws(() => parseRelocationCommand(["--resume", "latest"]), /storage-relocation-usage/u);
  });
});
}
