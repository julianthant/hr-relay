import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { runRecordFromRow } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { exportTransactions } from "../../../../src/backend/storage/maintenance/transaction-export.js";
import { capturedInstantClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { separationsDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { HISTORY_NOW,historyWorld } from "../../../support/helpers/storage/transaction-history-fixture.js";
const range = { from: "2026-07-01", to: "2026-09-09" };
function permanent(path:string) {
  const raw=new DatabaseSync(path,{readOnly:true});
  try{return canonicalJsonStringify(["write_intents","write_attempts"].map(table=>raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all()));}
  finally{raw.close();}
}
function assertHistoryRefusal(read: () => unknown, causePattern: RegExp): void {
  assert.throws(read,error=>{
    assert.ok(error instanceof Error);
    assert.match(error.message,/run-search-index-rebuild-required/u);
    assert.ok(error.cause instanceof Error);
    assert.match(error.cause.message,causePattern);
    return true;
  });
}
it("retains exact same-clock confirmed operations through authenticated deletion and reopen without inventing delivery or disclosure",()=>{
  const w=historyWorld();try{
    const first=w.commit(501,{instance:"prod"});const second=w.commit(502,{instance:"test",confirmedAt:first.confirmedAt});
    const live=w.history.query(range);assert.equal(live.rows.length,2);
    assert.equal(new Set(live.rows.map(row=>row.operationId)).size,2);
    assert.deepEqual(w.history.query({...range,runId:first.commit.transaction.runId}).rows.map(row=>row.operationId),[first.commit.writeIntentId]);
    assert.equal(w.history.query({...range,system:"kuali"}).rows.length,0);
    const before=permanent(w.path);const owner=w.database.authority.runs.get(first.commit.transaction.runId);assert.ok(owner);
    const service=new RunRecordService({database:w.database,clock:capturedInstantClock(HISTORY_NOW),ids:sequentialIdFactory(),publishQueued:()=>{}});
    const cancel=service.transition({commandId:"50000000-0000-4000-8000-000000000001",runId:owner.envelope.runId,expectedVersion:owner.version,
      lifecycle:{state:"terminal",outcome:"cancelled",endedAt:HISTORY_NOW}});assert.equal(cancel.state,"applied");if(cancel.state!=="applied")throw new Error("cancel refused");
    const current=cancel.run;assert.ok("workerId" in current.lifecycle);if(!("workerId" in current.lifecycle))throw new Error("claim lost");
    const terminal=service.terminalize({kind:"cancelled",commandId:"50000000-0000-4000-8000-000000000002",runId:current.envelope.runId,
      expectedVersion:current.version,claim:{workerId:current.lifecycle.workerId,claimGeneration:current.claimGeneration},endedAt:HISTORY_NOW},separationsDescriptor);
    assert.equal(terminal.state,"applied");if(terminal.state!=="applied")throw new Error("terminal refused");
    assert.equal(service.delete({commandId:"50000000-0000-4000-8000-000000000003",runId:owner.envelope.runId,expectedVersion:terminal.run.version}).state,"deleted");
    assert.equal(permanent(w.path),before);
    const deleted=w.history.query(range);assert.equal(deleted.rows.length,2);
    const row=deleted.rows.find(entry=>entry.runId===owner.envelope.runId);assert.ok(row);
    const original=live.rows.find(entry=>entry.runId===owner.envelope.runId);assert.ok(original);
    assert.deepEqual(row.ledger,original.ledger);assert.deepEqual(row.checkpoint,original.checkpoint);
    assert.deepEqual(row.presentation.pointer,{state:"unavailable",reason:"delivery cursor removed by authenticated run deletion"});
    assert.equal(row.presentation.state,"resolved");assert.equal(row.presentation.idempotencyKeyDigest,"withheld-protected-input");
    assert.equal(row.presentation.action.state,"absent");assert.equal(row.presentation.confirmation.state,"absent");
    assert.equal(JSON.stringify(row.presentation).includes(first.commit.transaction.idempotencyKey),false);
    assert.deepEqual(deleted.rows.find(entry=>entry.operationId===second.commit.writeIntentId),live.rows.find(entry=>entry.operationId===second.commit.writeIntentId));
    w.reopen();assert.deepEqual(w.history.query(range),deleted);assert.equal(permanent(w.path),before);
    for (const fault of ["wrong-deletion-command", "missing-deletion-owner"] as const) {
      using raw = new DatabaseSync(w.path);
      const saved = raw.prepare("SELECT * FROM deleted_runs WHERE run_id=?").get(owner.envelope.runId);assert.ok(saved);
      const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='deleted_runs' ORDER BY name").all();
      using _restore = { [Symbol.dispose]() {
        for (const trigger of triggers) raw.exec(`DROP TRIGGER ${String(trigger.name)}`);
        if (fault === "missing-deletion-owner") {
          const columns=Object.keys(saved);raw.prepare(`INSERT INTO deleted_runs (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`).run(...Object.values(saved));
        } else raw.prepare("UPDATE deleted_runs SET command_id=?,receipt_json=? WHERE run_id=?").run(saved.command_id,saved.receipt_json,owner.envelope.runId);
        for (const trigger of triggers) raw.exec(String(trigger.sql));
      } };
      {
        for (const trigger of triggers) raw.exec(`DROP TRIGGER ${String(trigger.name)}`);
        try {
          if (fault === "wrong-deletion-command") raw.prepare("UPDATE deleted_runs SET command_id=?,receipt_json=json_set(receipt_json,'$.commandId',?) WHERE run_id=?")
            .run("50000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000001",owner.envelope.runId);
          else raw.prepare("DELETE FROM deleted_runs WHERE run_id=?").run(owner.envelope.runId);
        } finally { for (const trigger of triggers) raw.exec(String(trigger.sql)); }
      }
      assertHistoryRefusal(() => w.history.query({ ...range, system: "kuali" }), fault === "wrong-deletion-command" ? /confirmed-publication-deletion-settlement-mismatch/u : /confirmed-publication-timeline-missing/u);
      assert.equal(permanent(w.path), before);
    }

  }finally{w.dispose();}
});

it.each(["missing-live-delivery", "publication-proof", "attempt-owner"] as const)("refuses %s before a nonmatching history filter without read effects", fault => {
  const w=historyWorld();try{
    const fixture=w.commit(511);
    const generation=w.database.getMeta().authorityGeneration;
    const eventId=w.history.query(range).rows[0].eventId;
    using raw=new DatabaseSync(w.path);
    const table=fault === "missing-live-delivery" ? "timeline_events" : fault === "publication-proof" ? "write_intents" : "write_attempts";
    const id=fault === "missing-live-delivery" ? eventId : fault === "publication-proof" ? fixture.commit.writeIntentId : String(fixture.intent.currentAttemptId);
    const saved=raw.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);assert.ok(saved);
    const triggers=raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name=? ORDER BY name").all(table);
    using _restore={ [Symbol.dispose]() {
      for(const trigger of triggers)raw.exec(`DROP TRIGGER ${String(trigger.name)}`);
      if(fault === "missing-live-delivery") {
        const columns=Object.keys(saved);raw.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`).run(...Object.values(saved));
      } else {
        const column=fault === "publication-proof" ? "publication_json" : "payload_json";
        raw.prepare(`UPDATE ${table} SET ${column}=? WHERE id=?`).run(saved[column],id);
      }
      for(const trigger of triggers)raw.exec(String(trigger.sql));
    } };
    for(const trigger of triggers)raw.exec(`DROP TRIGGER ${String(trigger.name)}`);
    try {
      if(fault === "missing-live-delivery")raw.prepare("DELETE FROM timeline_events WHERE id=?").run(eventId);
      else if(fault === "publication-proof")raw.prepare("UPDATE write_intents SET publication_json=json_set(publication_json,'$.ledger.operator','forged-actor') WHERE id=?").run(fixture.commit.writeIntentId);
      else raw.prepare("UPDATE write_attempts SET payload_json=json_set(payload_json,'$.runId','50000000-0000-4000-8000-000000009999') WHERE id=?").run(String(fixture.intent.currentAttemptId));
    }finally{for(const trigger of triggers)raw.exec(String(trigger.sql));}
    const before=permanent(w.path);
    const causePattern=fault === "missing-live-delivery" ? /confirmed-publication-timeline-missing/u
      : fault === "publication-proof" ? /authority table write_intents failed native record validation:[\s\S]*invalid_type/u
        : /write_attempts-row-run_id-mismatch/u;
    assertHistoryRefusal(()=>w.history.query({...range,system:"kuali"}),causePattern);
    assert.equal(permanent(w.path),before);assert.equal(raw.prepare("SELECT authority_generation FROM database_states WHERE id=1").get()?.authority_generation,generation);
  }finally{w.dispose();}
});


it.each(["live-owner-overlap", "forged-deletion-owner"] as const)("refuses %s globally before nonmatching history/export and reopen without effects", fault => {
  const w = historyWorld();
  try {
    const fixture = w.commit(521);
    const surviving = w.commit(522);
    const owner = w.database.authority.runs.get(fixture.commit.transaction.runId);
    assert.ok(owner);
    const service = new RunRecordService({ database:w.database, clock:capturedInstantClock(HISTORY_NOW), ids:sequentialIdFactory(), publishQueued:()=>{} });
    const cancel = service.transition({ commandId:"50000000-0000-4000-8000-000000000011", runId:owner.envelope.runId, expectedVersion:owner.version,
      lifecycle:{state:"terminal",outcome:"cancelled",endedAt:HISTORY_NOW} });
    assert.equal(cancel.state,"applied");
    if (cancel.state !== "applied" || !("workerId" in cancel.run.lifecycle)) throw new Error("cancel claim refused");
    const terminal = service.terminalize({ kind:"cancelled", commandId:"50000000-0000-4000-8000-000000000012", runId:owner.envelope.runId,
      expectedVersion:cancel.run.version, claim:{workerId:cancel.run.lifecycle.workerId,claimGeneration:cancel.run.claimGeneration}, endedAt:HISTORY_NOW },separationsDescriptor);
    assert.equal(terminal.state,"applied");
    if (terminal.state !== "applied") throw new Error("terminal refused");
    const read = new DatabaseSync(w.path,{readOnly:true});
    const savedRun = read.prepare("SELECT * FROM runs WHERE id=?").get(owner.envelope.runId);
    read.close();
    assert.ok(savedRun);
    assert.equal(service.delete({commandId:"50000000-0000-4000-8000-000000000013",runId:owner.envelope.runId,expectedVersion:terminal.run.version}).state,"deleted");
    assert.equal(w.history.query(range).rows.length,2);
    const generation = w.database.getMeta().authorityGeneration;
    const survivingRun = w.database.authority.runs.get(surviving.commit.transaction.runId);assert.ok(survivingRun);
    using raw = new DatabaseSync(w.path);
    const savedDeletion=raw.prepare("SELECT command_id,receipt_json FROM deleted_runs WHERE run_id=?").get(owner.envelope.runId);assert.ok(savedDeletion);
    const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
    using _restore={ [Symbol.dispose]() {
      for(const trigger of triggers)raw.exec(`DROP TRIGGER ${String(trigger.name)}`);
      if(fault === "live-owner-overlap") raw.prepare("DELETE FROM runs WHERE id=?").run(owner.envelope.runId);
      else raw.prepare("UPDATE deleted_runs SET command_id=?,receipt_json=? WHERE run_id=?").run(savedDeletion.command_id,savedDeletion.receipt_json,owner.envelope.runId);
      for(const trigger of triggers)raw.exec(String(trigger.sql));
    } };
    {
      for (const trigger of triggers) raw.exec(`DROP TRIGGER ${String(trigger.name)}`);
      try {
        if (fault === "live-owner-overlap") {
          const columns = Object.keys(savedRun);
          raw.prepare(`INSERT INTO runs (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`).run(...Object.values(savedRun));
          assert.equal(raw.prepare("SELECT count(*) AS count FROM runs JOIN deleted_runs ON runs.id=deleted_runs.run_id").get()?.count,1);
        } else raw.prepare("UPDATE deleted_runs SET command_id=?,receipt_json=json_set(receipt_json,'$.commandId',?) WHERE run_id=?")
          .run("50000000-0000-4000-8000-000000000011","50000000-0000-4000-8000-000000000011",owner.envelope.runId);
      } finally { for (const trigger of triggers) raw.exec(String(trigger.sql)); }
    }
    const bytes = permanent(w.path);
    const output = join(w.root,"must-not-export.json");
    const causePattern=fault === "live-owner-overlap" ? /confirmed-publication-owner-ambiguous/u : /confirmed-publication-deletion-settlement-mismatch/u;
    assertHistoryRefusal(()=>w.history.query({...range,system:"kuali"}),causePattern);
    assertHistoryRefusal(()=>exportTransactions(w.history,{...range,system:"kuali",output}),causePattern);
    assert.equal(existsSync(output),false);
    assert.throws(()=>w.database.authority.runs.updatePresentation({runId:survivingRun.envelope.runId,expectedVersion:survivingRun.version,displayName:"Must not mutate",now:HISTORY_NOW}),/confirmed-publication-(?:owner-ambiguous|deletion-settlement-mismatch)/u);
    assert.deepEqual(runRecordFromRow(raw.prepare("SELECT * FROM runs WHERE id=?").get(survivingRun.envelope.runId)),survivingRun);
    assert.equal(permanent(w.path),bytes);
    assert.equal(raw.prepare("SELECT authority_generation FROM database_states WHERE id=1").get()?.authority_generation,generation);
    assert.throws(()=>AuthorityDatabase.open({path:w.path,busyTimeoutMs:250,migrationOwner:"corrupt-history-reader"},capturedInstantClock(HISTORY_NOW)),fault === "live-owner-overlap" ? /confirmed-publication-owner-ambiguous/u : /confirmed-publication-deletion-settlement-mismatch/u);
    assert.equal(permanent(w.path),bytes);
  } finally { w.dispose(); }
});
