import { randomUUID } from "node:crypto";
import { capturedInstantClock } from "../../../../../src/rules/time/clock.js";
import { createItemAttemptHistoryQuery } from "../../../../../src/backend/runs/queries/item-attempt-history.js";
import { mkdtempSync, realpathSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { RuntimeAdmission } from "../../../../../src/backend/storage/admission/admission.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createContentAddressedArtifactWriter } from "../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { deletedRunFromRow } from "../../../../../src/backend/storage/sqlite/deleted-run-row.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { QUEUED_RUN, sequentialIdFactory } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { CONFIG_SNAPSHOT, NOW, UUID_1, UUID_3, UUID_5, HASH_A } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
const cleanups:(()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup();});
function fixture(fault?:string) {
  let activeFault=fault;
  const root=realpathSync(mkdtempSync(join(tmpdir(),"relay-native-deletion-")));
  const path=join(root,"authority.sqlite");const admission=RuntimeAdmission.syntheticFixture(path);
  const open=()=>AuthorityDatabase.open(admission,{path,busyTimeoutMs:250,migrationOwner:"native-test"},undefined,undefined,undefined,
    {afterDeleteStep:({step})=>{if(step===activeFault)throw new Error("deletion-fault");},
      afterDeletionFileRemoved:()=>{if(activeFault === "file")throw new Error("deletion-file-fault");}});
  let db=open();cleanups.push(()=>{db.close();rmSync(root,{recursive:true,force:true});});
  db.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const terminalTemplate=RunRecordSchema.parse({...QUEUED_RUN,envelope:{...QUEUED_RUN.envelope,configSnapshotId:CONFIG_SNAPSHOT.configSnapshotId,
    configFingerprint:CONFIG_SNAPSHOT.fingerprint},lifecycle:{state:"terminal",outcome:"discarded",endedAt:NOW}});
  const seed=(record:typeof terminalTemplate)=>{
    const queued=RunRecordSchema.parse({...record,lifecycle:{state:"queued"},version:1,updatedAt:record.createdAt});
    db.authority.runs.enqueue(queued);
    const service=new RunRecordService({database:db,clock:capturedInstantClock(NOW),ids:sequentialIdFactory(),publishQueued:()=>{throw new Error("unexpected fixture publication");}});
    const settled=service.transition({commandId:randomUUID(),runId:queued.envelope.runId,expectedVersion:queued.version,lifecycle:record.lifecycle});
    if(settled.state!=="applied")throw new Error("genuine fixture terminal transition refused");
    return settled.run;
  };
  const run=seed(terminalTemplate);
  const makeService=()=>new RunRecordService({database:db,clock:capturedInstantClock(NOW),ids:sequentialIdFactory(),publishQueued:()=>{throw new Error("deletion cannot publish a queue event");}});
  const restart=()=>{db.close();db=open();return makeService();};
  const addDiagnostic=async()=>{
    const writer=createContentAddressedArtifactWriter({admission});await writer.ready;
    const ref=await writer.put(Buffer.from('{"offline":true}'),{mediaType:"application/json"});
    db.authority.diagnosticBundles.insert({bundleId:UUID_3,runId:run.envelope.runId,origin:{kind:"operator-request",requestedBy:"local-operator"},
      createdAt:NOW,contentDigest:HASH_A,configFingerprint:run.envelope.configFingerprint,descriptorFingerprint:run.envelope.contractFingerprint,
      redaction:{fields:[],warnings:[]},retention:{kind:"ordinary",purgeAfter:"2026-12-01T00:00:00.000Z"},
      attachments:[{kind:"console-summary",artifactId:ref.id,mediaType:ref.mediaType,byteLength:ref.bytes,digest:ref.sha256,sensitivity:"redacted"}]});
    return {ref,file:join(admission.artifactRoot,`${ref.sha256}.artifact`)};
  };
  const deletionRow=()=>{const raw=new DatabaseSync(path,{readOnly:true});try{return deletedRunFromRow(raw.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(run.envelope.runId));}finally{raw.close();}};
  return {path,get db(){return db;},run,service:makeService(),restart,seed,addDiagnostic,deletionRow,clearFault:()=>{activeFault=undefined;}};
}
describe("native lifecycle deletion command",()=>{
  it("reads bounded native same-item history across a tombstone and a later current attempt",()=>{
    const f=fixture();expect(f.service.delete({commandId:UUID_5,runId:f.run.envelope.runId,expectedVersion:f.run.version}).state).toBe("deleted");
    const next=RunRecordSchema.parse({...f.run,envelope:{...f.run.envelope,runId:UUID_3,attempt:2}});f.seed(next);
    const reader=f.restart();const query=createItemAttemptHistoryQuery({database:f.db,reader});
    const first=query.read(f.run.envelope.runId,{limit:1});
    expect(first.state).toBe("available");if(first.state !== "available")throw new Error("native history unavailable");
    expect(first.page.totalEntries).toBe(2);expect(first.page.entries.map(row=>row.disposition)).toEqual(["deleted"]);
    expect(first.page.nextCursor).not.toBeNull();
    const second=query.read(f.run.envelope.runId,{limit:1,cursor:first.page.nextCursor!});
    expect(second.state).toBe("available");if(second.state !== "available")throw new Error("native second history page unavailable");
    expect(second.page.entries.map(row=>row.disposition)).toEqual(["live"]);expect(second.page.entries[0]?.attempt).toBe(2);
    f.db.authority.runs.advanceRevision({runId:next.envelope.runId,expectedVersion:next.version,now:NOW});
    expect(query.read(f.run.envelope.runId,{limit:1,cursor:first.page.nextCursor!})).toMatchObject({state:"stale",reason:"authority-changed"});
  });

  it("admits the genuine complete command before its tombstone, settles once and replays after restart",()=>{
    const f=fixture();const request={commandId:UUID_1,runId:f.run.envelope.runId,expectedVersion:f.run.version};
    const result=f.service.delete(request);expect(result.state).toBe("deleted");
    expect(f.service.read(f.run.envelope.runId).state).toBe("deleted");
    const generation=f.db.getMeta().authorityGeneration;
    expect(f.service.delete(request).state).toBe("applied-already");expect(f.db.getMeta().authorityGeneration).toBe(generation);
    expect(f.restart().delete(request).state).toBe("applied-already");
    const db=new DatabaseSync(f.path,{readOnly:true});try {
      expect(db.prepare("SELECT * FROM deleted_runs").all()).toHaveLength(1);
      expect(db.prepare("SELECT * FROM commands WHERE id=?").all(UUID_1)).toHaveLength(1);
      expect(db.prepare("SELECT * FROM command_audits WHERE command_id=?").all(UUID_1)).toHaveLength(1);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally{db.close();}
  });
  it.each(["tombstone","runs","cascade-complete"])("rolls back command, audit and deletion after %s",step=>{
    const f=fixture(step);const before=f.db.getMeta().authorityGeneration;
    expect(()=>f.service.delete({commandId:UUID_1,runId:f.run.envelope.runId,expectedVersion:f.run.version})).toThrow("deletion-fault");
    expect(f.service.read(f.run.envelope.runId).state).toBe("present");
    expect(f.db.authority.lifecycleJournal.getCommand(UUID_1)).toBeUndefined();
    expect(f.db.authority.lifecycleJournal.findAuditByCommand(UUID_1)).toBeUndefined();
    expect(f.db.getMeta().authorityGeneration).toBe(before);
  });
  it("captures exact bytes before deletion and refuses changed bytes without changing its immutable receipt",async()=>{
    const f=fixture();const artifact=await f.addDiagnostic();const original=readFileSync(artifact.file);
    const command={commandId:UUID_1,runId:f.run.envelope.runId,expectedVersion:f.run.version};
    expect(f.service.delete(command).state).toBe("deleted");const before=f.deletionRow();
    expect(before.cleanupState).toBe("pending");expect(before.files).toHaveLength(1);
    expect(before.receipt.removed).toContainEqual({table:"diagnostic_files",rows:1});
    expect(before.receipt.removed).toContainEqual({table:"diagnostic_snapshots",rows:1});
    expect(()=>f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_5})).toThrow(/command-mismatch/u);
    expect(()=>f.db.withAuthorityTransaction(()=>f.db.settleRunDeletionFiles({runId:command.runId,commandId:command.commandId}))).toThrow(/requires-committed-receipt/u);
    writeFileSync(artifact.file,Buffer.concat([original,Buffer.from("\n")]));
    expect(()=>f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_1})).toThrow(/captured-bytes-mismatch/u);
    expect(f.deletionRow()).toEqual(before);expect(existsSync(artifact.file)).toBe(true);
    writeFileSync(artifact.file,original);
    expect(f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_1})).toBe("complete");
    expect(f.deletionRow()).toEqual({...before,cleanupState:"complete"});expect(existsSync(artifact.file)).toBe(false);
    const generation=f.db.getMeta().authorityGeneration;
    expect(f.db.settleRunDeletionFiles({runId:command.runId,commandId:UUID_1})).toBe("complete");expect(f.db.getMeta().authorityGeneration).toBe(generation);
  });
  it("resumes the original committed manifest after an unlink fault and restart",async()=>{
    const f=fixture("file");const artifact=await f.addDiagnostic();
    const request={commandId:UUID_1,runId:f.run.envelope.runId,expectedVersion:f.run.version};
    expect(f.service.delete(request).state).toBe("deleted");const before=f.deletionRow();
    expect(()=>f.db.settleRunDeletionFiles({runId:request.runId,commandId:request.commandId})).toThrow("deletion-file-fault");
    expect(f.deletionRow()).toEqual(before);expect(existsSync(artifact.file)).toBe(false);
    f.clearFault();expect(f.restart().delete(request).state).toBe("applied-already");
    expect(f.db.settleRunDeletionFiles({runId:request.runId,commandId:request.commandId})).toBe("complete");
    expect(f.deletionRow()).toEqual({...before,cleanupState:"complete"});
  });
  it("preflights and deletes a complete terminal child tree without renumbering permanent authority",()=>{
    const f=fixture();const child=RunRecordSchema.parse({...f.run,envelope:{...f.run.envelope,runId:UUID_5,attempt:2,
      parent:{runId:f.run.envelope.runId,tracePrefix:f.run.envelope.traceId,edgeId:"child-probe"}}});
    f.seed(child);
    const result=f.restart().delete({commandId:UUID_1,runId:f.run.envelope.runId,expectedVersion:f.run.version});
    expect(result.state).toBe("deleted");if(result.state!=="deleted" || !("tombstones" in result))throw new Error("expected deletion");
    expect(result.tombstones.map(receipt=>receipt.runId)).toEqual([UUID_5,f.run.envelope.runId]);
    expect(f.db.authority.runs.nextItemAttempt({workflow:f.run.envelope.workflow,itemId:f.run.envelope.itemId})).toBe(3);
  });
});
