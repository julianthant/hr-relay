import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it } from "vitest";
import { insertNativeCommand,settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { deletedRunFromRow } from "../../../../src/backend/storage/sqlite/deleted-run-row.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { executeNativeRunDeletion,prepareNativeRunDeletion } from "../../../../src/backend/storage/sqlite/native-run-deletion.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createTimelineRepository } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { timelineCheckpointReference } from "../../../../src/models/events/timeline.js";
import { RunDeleteInputSchema } from "../../../../src/models/run/deleted-run.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { deriveCheckpointOutputDigest } from "../../../../src/models/run/result.js";
import { RunCheckpointRecordSchema,checkpointRecordKey } from "../../../../src/models/workflow/checkpoint.js";
import type { RunId } from "../../../../src/rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { CONFIG_SNAPSHOT,HASH_A,NOW,UUID_1,UUID_3,UUID_5 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture(withParent = false) {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  for (const migration of SQLITE_MIGRATIONS) for (const sql of migration.statements) db.exec(sql);
  db.prepare("INSERT INTO settings_snapshots VALUES(?,?,?,?,?)").run(CONFIG_SNAPSHOT.configSnapshotId,CONFIG_SNAPSHOT.revision,
    CONFIG_SNAPSHOT.fingerprint,canonicalJsonStringify(CONFIG_SNAPSHOT),CONFIG_SNAPSHOT.capturedAt);
  const run = RunRecordSchema.parse({...QUEUED_RUN,envelope:{...QUEUED_RUN.envelope,configSnapshotId:CONFIG_SNAPSHOT.configSnapshotId,
    ...(withParent ? {parent:{runId:UUID_5,tracePrefix:QUEUED_RUN.envelope.traceId,edgeId:"child-probe"}} : {})},
    lifecycle:{state:"terminal",outcome:"discarded",endedAt:NOW}});
  const addRun = (record: typeof run) => {
    const row = runRecordColumns(record);
    db.prepare(`INSERT INTO runs(${Object.keys(row).join(",")}) VALUES(${Object.keys(row).map(()=>"?").join(",")})`).run(...Object.values(row));
  };
  const parent = withParent ? RunRecordSchema.parse({...run,envelope:{...QUEUED_RUN.envelope,configSnapshotId:CONFIG_SNAPSHOT.configSnapshotId,runId:UUID_5,attempt:2}}) : undefined;
  if (parent !== undefined) addRun(parent);
  addRun(run);
  insertNativeCommand(db,{commandId:UUID_1,family:"run",type:"delete",requestedAt:NOW,requestedBy:"local-operator",source:"dashboard",
    target:{runId:parent?.envelope.runId ?? run.envelope.runId,expectedVersion:run.version}});
  const checkpoint = RunCheckpointRecordSchema.parse({workflowId:run.envelope.workflow,itemId:run.envelope.itemId,nodeId:"probe",
    attempt:run.envelope.attempt,claimGeneration:1,runId:run.envelope.runId,output:{schemaHash:HASH_A,value:{matched:true}},
    descriptorVersion:1,contractFingerprint:HASH_A,implFingerprint:HASH_A,provenance:[],writtenAt:NOW});
  db.prepare("INSERT INTO run_checkpoints VALUES(?,?,?,?,?,?,?,?,?,?)").run(checkpointRecordKey(checkpoint),checkpoint.runId,checkpoint.workflowId,
    checkpoint.itemId,checkpoint.nodeId,checkpoint.attempt,1,deriveCheckpointOutputDigest(checkpoint.output),canonicalJsonStringify(checkpoint),NOW);
  const input = (cascadeRunIds = [run.envelope.runId]) => RunDeleteInputSchema.parse({runId:run.envelope.runId,origin:"queue",commandId:UUID_1,now:NOW,cascadeRunIds});
  const prepare = (cascadeRunIds?: RunId[]) => prepareNativeRunDeletion(db,run,input(cascadeRunIds),()=>{throw new Error("no fixture files");});
  const transaction = <T>(work:()=>T) => {db.exec("BEGIN IMMEDIATE");try {const value=work();db.exec("COMMIT");return value;}catch(error){db.exec("ROLLBACK");throw error;}};
  const replay = () => {
    const peer = parent ?? RunRecordSchema.parse({...run,envelope:{...run.envelope,runId:UUID_5,attempt:2}});
    if (parent === undefined) addRun(peer);
    createTimelineRepository({database:db,mutate:work=>transaction(()=>work().result),read:work=>work(),assertOwner:()=>undefined}).append({
      schemaVersion:1,eventId:UUID_3,workflow:peer.envelope.workflow,scope:{kind:"run",runId:peer.envelope.runId},occurredAt:NOW,recordedAt:NOW,
      retentionDate:"2026-08-03",source:{kind:"native"},payload:{kind:"checkpoint-replayed",runId:peer.envelope.runId,workflow:peer.envelope.workflow,
        attempt:2,claimGeneration:1,checkpoint:timelineCheckpointReference(checkpoint)}});
    return peer;
  };
  return {db,run,prepare,transaction,replay,input};
}
describe("native terminal run deletion", () => {
  it.each(["valid","command-digest","audit-column"])("validates retained command and audit evidence before planning deletion: %s", fault => {
    const f=fixture();
    const request={commandId:UUID_3,runId:f.run.envelope.runId,expectedVersion:f.run.version};
    const command={kind:"run-lifecycle",commandId:UUID_3,operation:"delete",request,
      requestFingerprint:sha256Hex(`hrauto:run-lifecycle-command:v1\0delete\0${canonicalJsonStringify(request)}`),
      fence:{kind:"version",expectedVersion:f.run.version},recordedAt:NOW};
    insertNativeCommand(f.db,command);
    const audit={kind:"run-lifecycle",auditId:UUID_5,request:command,
      result:{kind:"deletion",runIds:[f.run.envelope.runId]},completedAt:NOW};
    settleNativeCommand(f.db,audit);
    f.db.prepare("INSERT INTO command_audits(id,command_id,code,payload_json,created_at) VALUES(?,?,NULL,?,?)")
      .run(UUID_5,UUID_3,canonicalJsonStringify(audit),NOW);
    if(fault==="command-digest")f.db.prepare("UPDATE commands SET request_digest=? WHERE id=?").run(HASH_A,UUID_3);
    if(fault==="audit-column") {
      f.db.exec("DROP TRIGGER command_audits_immutable");
      f.db.prepare("UPDATE command_audits SET created_at=? WHERE id=?").run("2026-09-10T12:00:00.000Z",UUID_5);
    }
    const before=f.db.prepare("SELECT * FROM runs").all();
    if(fault==="valid")expect(()=>f.prepare()).not.toThrow();
    else expect(()=>f.prepare()).toThrow(fault==="command-digest" ? /command-row-identity-mismatch/u : /command_audits-row-created_at-mismatch/u);
    expect(f.db.prepare("SELECT * FROM runs").all()).toEqual(before);
    expect(f.db.prepare("SELECT * FROM run_checkpoints").all()).toHaveLength(1);
    expect(f.db.prepare("SELECT * FROM deleted_runs").all()).toEqual([]);
  });
  it("persists the final tally first and deletes ordinary terminal authority in FK order", () => {
    const f = fixture(); const prepared = f.prepare();
    expect(prepared.receipt.removed).toEqual([{table:"run_checkpoints",rows:1},{table:"runs",rows:1}]);
    const receipt = f.transaction(()=>executeNativeRunDeletion(f.db,prepared,step=>{
      if(step === "tombstone") expect(deletedRunFromRow(f.db.prepare("SELECT * FROM deleted_runs").get()).receipt).toEqual(prepared.receipt);
    }));
    expect(f.db.prepare("SELECT * FROM runs").all()).toEqual([]);
    expect(deletedRunFromRow(f.db.prepare("SELECT * FROM deleted_runs").get()).receipt).toEqual(receipt);
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(()=>f.db.prepare("UPDATE deleted_runs SET receipt_json='{}'").run()).toThrow(/deletion-evidence-immutable/u);
    f.db.prepare("UPDATE deleted_runs SET cleanup_state='complete'").run();
    expect(()=>f.db.prepare("UPDATE deleted_runs SET cleanup_state='pending'").run()).toThrow(/deletion-evidence-immutable/u);
  });
  it.each(["tombstone","run_checkpoints","runs","cascade-complete"])("rolls back the complete receipt and graph on failure after %s", fault => {
    const f=fixture();const before=f.db.prepare("SELECT * FROM runs").all();
    expect(()=>f.transaction(()=>executeNativeRunDeletion(f.db,f.prepare(),step=>{if(step===fault)throw new Error("injected-deletion-fault");}))).toThrow("injected-deletion-fault");
    expect(f.db.prepare("SELECT * FROM deleted_runs").all()).toEqual([]);
    expect(f.db.prepare("SELECT * FROM runs").all()).toEqual(before);
    expect(f.db.prepare("SELECT * FROM run_checkpoints").all()).toHaveLength(1);
  });
  it("refuses a real surviving checkpoint reference before any mutation", () => {
    const f=fixture();f.replay();
    expect(()=>f.prepare()).toThrow(/checkpoint still referenced/u);
    expect(f.db.prepare("SELECT * FROM deleted_runs").all()).toEqual([]);
    expect(f.db.prepare("SELECT * FROM runs").all()).toHaveLength(2);
    expect(f.db.prepare("SELECT * FROM run_checkpoints").all()).toHaveLength(1);
  });
  it("rejects a forged cascade that includes an unrelated surviving run", () => {
    const f=fixture();const peer=f.replay();
    expect(()=>f.prepare([f.run.envelope.runId,peer.envelope.runId])).toThrow(/cascade-disconnected/u);
    expect(f.db.prepare("SELECT * FROM deleted_runs").all()).toEqual([]);
  });
  it("preflights every cascade member before any tombstone and refuses a surviving reference on its child", () => {
    const f=fixture(true);const peer=f.replay();const cascade=[f.run.envelope.runId,peer.envelope.runId];
    const rootInput=RunDeleteInputSchema.parse({...f.input(cascade),runId:peer.envelope.runId});
    expect(()=>prepareNativeRunDeletion(f.db,peer,rootInput,()=>{throw new Error("no fixture files");},"preflight")).not.toThrow();
    expect(f.db.prepare("SELECT * FROM deleted_runs").all()).toEqual([]);
    expect(()=>prepareNativeRunDeletion(f.db,peer,rootInput,()=>{throw new Error("no fixture files");})).toThrow(/children-remain/u);
    expect(()=>prepareNativeRunDeletion(f.db,peer,f.input([peer.envelope.runId]),()=>{throw new Error("no fixture files");},"preflight")).toThrow();
    expect(f.db.prepare("SELECT * FROM runs").all()).toHaveLength(2);
  });
  it("does not mistake a reference inside the complete deletion cascade for surviving evidence", () => {
    const f=fixture(true);const peer=f.replay();const cascade=[f.run.envelope.runId,peer.envelope.runId];
    f.transaction(()=>{
      executeNativeRunDeletion(f.db,f.prepare(cascade));
      const input=RunDeleteInputSchema.parse({...f.input(cascade),runId:peer.envelope.runId});
      executeNativeRunDeletion(f.db,prepareNativeRunDeletion(f.db,peer,input,()=>{throw new Error("no fixture files");}));
    });
    expect(f.db.prepare("SELECT * FROM runs").all()).toEqual([]);
    expect(f.db.prepare("SELECT * FROM deleted_runs").all()).toHaveLength(2);
    expect(f.db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
