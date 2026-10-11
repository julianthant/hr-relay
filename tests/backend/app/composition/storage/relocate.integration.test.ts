import { default as assert_m0,default as assert_m1,default as assert_m2 } from "node:assert/strict";
import { createHash as createHash_m1,randomUUID as randomUUID_m0,randomUUID as randomUUID_m1 } from "node:crypto";
import { lstatSync as lstatSync_m1,mkdirSync as mkdirSync_m1,mkdtempSync as mkdtempSync_m1,readFileSync as readFileSync_m1,realpathSync as realpathSync_m1,rmSync as rmSync_m1,writeFileSync as writeFileSync_m1 } from "node:fs";
import { tmpdir as tmpdir_m1 } from "node:os";
import { join as join_m0,join as join_m1 } from "node:path";
import { DatabaseSync as DatabaseSync_m0 } from "node:sqlite";
import { describe as describe_m2,it as it_m0,it as it_m1,it as it_m2 } from "vitest";
import { copyNativeSnapshot as copyNativeSnapshot_m1,runOfflineStorageRelocation as runOfflineStorageRelocation_m0,StorageRelocationIncompleteError as StorageRelocationIncompleteError_m0 } from "../../../../../src/backend/app/composition/storage/relocate.js";
import { acquireExclusiveRuntimeAdmission as acquireExclusiveRuntimeAdmission_m0,RuntimeAdmission as RuntimeAdmission_m1 } from "../../../../../src/backend/storage/admission/admission.js";
import { inspectPendingRelocationStatus as inspectPendingRelocationStatus_m0 } from "../../../../../src/backend/storage/admission/installation.js";
import { hostConfigFacts as hostConfigFacts_m0 } from "../../../../../src/models/config/host-display.js";
import { canonicalJsonStringify as canonicalJsonStringify_m0 } from "../../../../../src/rules/validation/canonical-json.js";
import { cleanupFixtureRoots as cleanupFixtureRoots_m0,clock as clock_m0,installation as installation_m0,leaveStoppedWal as leaveStoppedWal_m0,plan as plan_m0 } from "../../../../support/helpers/storage/storage-relocation-fixture.js";

import { parseRelocationCommand as parseRelocationCommand_m2 } from "../../../../../src/backend/app/composition/storage/relocate.js";


{


const _afterEachFixture0 = cleanupFixtureRoots_m0;

async function interruptAfterActivation(workspace: string, commandId: string): Promise<string> {
  const admission = acquireExclusiveRuntimeAdmission_m0(workspace);
  try {
    await assert_m0.rejects(runOfflineStorageRelocation_m0({ workspace,
      command: { kind: "plan", id: commandId, json: false }, admission, clock: clock_m0, hostFacts: hostConfigFacts_m0({}),
      faults: { afterActivationWrite: () => { throw new Error("synthetic-activation-interruption"); } } }), (error) => {
      assert_m0.ok(error instanceof StorageRelocationIncompleteError_m0);
      assert_m0.match(String(error.cause), /synthetic-activation-interruption/u);
      return true;
    });
  } finally { admission.release(); }
  const status = inspectPendingRelocationStatus_m0(workspace);
  assert_m0.ok(status);
  return status.operationId;
}

async function assertTamperedResumeRefuses(workspace: string, operationId: string, pattern: RegExp): Promise<void> {
  await assert_m0.rejects(runOfflineStorageRelocation_m0({ workspace,
    command: { kind: "resume", id: operationId, json: false }, clock: clock_m0, hostFacts: hostConfigFacts_m0({}) }), (error) => {
    assert_m0.ok(error instanceof StorageRelocationIncompleteError_m0);
    assert_m0.match(String(error.cause), pattern);
    return true;
  });
}

it_m0("refuses an unrelated authority row changed after committed activation", async () => {
try {


  const fixture = await installation_m0();
  leaveStoppedWal_m0(fixture.workspace, fixture.authorityPath);
  const destination = { stateRoot: join_m0(fixture.root, "new-state"), artifactRoot: join_m0(fixture.root, "new-artifacts") };
  const request = plan_m0(fixture.workspace, destination);
  const operationId = await interruptAfterActivation(fixture.workspace, request.commandId);
  const raw = new DatabaseSync_m0(join_m0(destination.stateRoot, "state.db"));
  try {
    const changed = raw.prepare("UPDATE notifications SET payload_json=json_set(payload_json,'$.title','Tampered notice') WHERE id=(SELECT id FROM notifications LIMIT 1)")
      .run();
    assert_m0.equal(changed.changes, 1);
  } finally { raw.close(); }
  await assertTamperedResumeRefuses(fixture.workspace, operationId, /unrelated authority rows changed.*notifications/u);

} finally {
_afterEachFixture0();
}
});

it_m0("refuses an extra config snapshot after committed activation", async () => {
try {


  const fixture = await installation_m0();
  const destination = { stateRoot: join_m0(fixture.root, "new-state"), artifactRoot: join_m0(fixture.root, "new-artifacts") };
  const request = plan_m0(fixture.workspace, destination);
  const operationId = await interruptAfterActivation(fixture.workspace, request.commandId);
  const raw = new DatabaseSync_m0(join_m0(destination.stateRoot, "state.db"));
  try {
    const source = raw.prepare("SELECT payload_json,captured_at,revision,fingerprint FROM settings_snapshots ORDER BY rowid DESC LIMIT 1").get() as
      | { payload_json: string; captured_at: string; revision:number;fingerprint:string } | undefined;
    assert_m0.ok(source);
    const snapshot = JSON.parse(source.payload_json) as Record<string, unknown>;
    const id = randomUUID_m0();
    raw.prepare("INSERT INTO settings_snapshots(id,revision,fingerprint,payload_json,captured_at) VALUES (?,?,?,?,?)")
      .run(id,source.revision,source.fingerprint, canonicalJsonStringify_m0({ ...snapshot, configSnapshotId: id }), source.captured_at);
  } finally { raw.close(); }
  await assertTamperedResumeRefuses(fixture.workspace, operationId, /activation snapshot history changed/u);

} finally {
_afterEachFixture0();
}
});

it_m0("refuses a search publication changed beyond the activation generation", async () => {
try {


  const fixture = await installation_m0();
  const destination = { stateRoot: join_m0(fixture.root, "new-state"), artifactRoot: join_m0(fixture.root, "new-artifacts") };
  const request = plan_m0(fixture.workspace, destination);
  const operationId = await interruptAfterActivation(fixture.workspace, request.commandId);
  const raw = new DatabaseSync_m0(join_m0(destination.stateRoot, "state.db"));
  try {
    const changed = raw.prepare("UPDATE database_states SET search_generation=999,search_state='invalid' WHERE id=1").run();
    assert_m0.equal(changed.changes, 1);
  } finally { raw.close(); }
  await assertTamperedResumeRefuses(fixture.workspace, operationId, /search publication differs from activation transaction/u);

} finally {
_afterEachFixture0();
}
});
}

{


it_m1("replays only the exact interrupted native snapshot publication", () => {
  const workspace = realpathSync_m1(mkdtempSync_m1(join_m1(tmpdir_m1(), "relocation-native-publication-")));
  const sourceRoot = join_m1(workspace, "source");
  const destinationRoot = join_m1(workspace, "destination");
  mkdirSync_m1(sourceRoot, { mode: 0o700 });
  mkdirSync_m1(destinationRoot, { mode: 0o700 });
  const source = join_m1(sourceRoot, "source.sqlite");
  const destination = join_m1(destinationRoot, "state.db");
  const operationId = randomUUID_m1();
  const candidate = join_m1(destinationRoot, `.relocation-${operationId}-state.db.tmp`);
  const bytes = Buffer.from("synthetic native snapshot bytes");
  const sha256 = createHash_m1("sha256").update(bytes).digest("hex");
  const admission = RuntimeAdmission_m1.syntheticRoots(destinationRoot, join_m1(destinationRoot, "artifacts"));
  try {
    writeFileSync_m1(source, bytes, { mode: 0o600 });
    assert_m1.throws(() => copyNativeSnapshot_m1(source, destination, sha256, operationId, admission,
      () => { throw new Error("simulated crash after native link"); }), /simulated crash after native link/u);
    assert_m1.equal(lstatSync_m1(destination).nlink, 2);
    assert_m1.equal(lstatSync_m1(candidate).ino, lstatSync_m1(destination).ino);
    copyNativeSnapshot_m1(source, destination, sha256, operationId, admission);
    assert_m1.equal(lstatSync_m1(destination).nlink, 1);
    assert_m1.equal(lstatSync_m1(candidate, { throwIfNoEntry: false }), undefined);
    assert_m1.deepEqual(readFileSync_m1(destination), bytes);
    copyNativeSnapshot_m1(source, destination, sha256, operationId, admission);
  } finally { admission.release(); rmSync_m1(workspace, { recursive: true, force: true }); }
});
}

{


describe_m2("secure environment bootstrap", () => {
  it_m2("parses only exact offline relocation selectors", () => {
    assert_m2.deepEqual(parseRelocationCommand_m2(["--status", "--json"]), { kind: "status", json: true });
    assert_m2.throws(() => parseRelocationCommand_m2(["--status", "extra"]), /storage-relocation-usage/u);
    assert_m2.throws(() => parseRelocationCommand_m2(["--resume", "latest"]), /storage-relocation-usage/u);
  });
});
}
