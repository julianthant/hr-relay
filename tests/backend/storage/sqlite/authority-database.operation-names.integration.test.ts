import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe,it } from "vitest";
import { fixtureUuid } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { historyClock,historyWorld } from "../../../support/helpers/storage/transaction-history-fixture.js";
import { AuthorityDatabase,inspectAuthorityBackupReadOnly } from "../../../support/helpers/synthetic-storage-admission.js";

function fault(path: string, triggerNames: readonly string[], mutate: (raw: DatabaseSync) => void) {
  const raw=new DatabaseSync(path);
  try {
    const triggers=triggerNames.map(name=>{
      const row=raw.prepare("SELECT sql FROM sqlite_schema WHERE type=? AND name=?").get("trigger",name);
      assert.equal(typeof row?.sql,"string");
      return {name,sql:String(row?.sql)};
    });
    raw.exec("BEGIN IMMEDIATE");
    try {
      for(const trigger of triggers)raw.exec(`DROP TRIGGER ${trigger.name}`);
      mutate(raw);
      for(const trigger of triggers)raw.exec(trigger.sql);
      raw.exec("COMMIT");
    }catch(error){raw.exec("ROLLBACK");throw error;}
  }finally{raw.close();}
}

describe("current operation authority",()=>{
  it("retains permanent operation and attempt history after terminal deletion with exact tombstone tallies",()=>{
    const world=historyWorld({terminalize:true});
    try {
      const fixture=world.commit(80),run=world.database.authority.runs.get(fixture.commit.transaction.runId);assert.ok(run);
      const intent=world.database.authority.writeIntents.get(fixture.commit.writeIntentId);
      const attempts=world.database.authority.writeAttempts.listByIntent(fixture.commit.writeIntentId);
      assert.equal(intent?.status,"committed");assert.equal(attempts.length,1);
      const receipt=testRunService(world.database,historyClock).delete({runId:run.envelope.runId,expectedVersion:run.version,commandId:fixtureUuid("operation-delete")});
      assert.equal(receipt.state,"deleted");
      const tombstone=world.database.authority.deletedRuns.get(run.envelope.runId);assert.ok(tombstone);
      assert.equal(tombstone.removed.map(row=>String(row.table)).some(table=>table==="write_intents"||table==="write_attempts"),false);
      assert.equal(tombstone.removed.find(row=>row.table==="runs")?.rows,1);
      assert.equal(tombstone.removed.find(row=>row.table==="run_checkpoints")?.rows,1);
      assert.equal(world.database.authority.runs.get(run.envelope.runId),undefined);
      assert.deepEqual(world.database.authority.writeIntents.get(fixture.commit.writeIntentId),intent);
      assert.deepEqual(world.database.authority.writeAttempts.listByIntent(fixture.commit.writeIntentId),attempts);
      world.reopen();
      assert.deepEqual(world.database.authority.deletedRuns.get(run.envelope.runId),tombstone);
      assert.deepEqual(world.database.authority.writeAttempts.listByIntent(fixture.commit.writeIntentId),attempts);
      assert.equal(inspectAuthorityBackupReadOnly(world.path).counts.unresolvedWriteIntents,0);
    }finally{world.dispose();}
  });

  it("retains foreign keys, generation uniqueness, permanent keys and immutable tombstones",()=>{
    const world=historyWorld({terminalize:true});
    try {
      const fixture=world.commit(81),raw=new DatabaseSync(world.path);raw.exec("PRAGMA foreign_keys=ON");
      try {
        assert.equal(raw.prepare("PRAGMA foreign_key_list(write_attempts)").get()?.table,"write_intents");
        assert.equal(raw.prepare("SELECT name FROM sqlite_schema WHERE name IN (?,?)").get("operation_outbox","timeline_operation_sources"),undefined);
        assert.throws(()=>raw.prepare("INSERT INTO write_attempts SELECT ?,?,generation+1,run_id,payload_json,created_at FROM write_attempts LIMIT 1").run(fixtureUuid("absent-attempt"),fixtureUuid("absent-intent")),/FOREIGN KEY/u);
        assert.throws(()=>raw.prepare("INSERT INTO write_attempts SELECT ?,intent_id,generation,run_id,payload_json,created_at FROM write_attempts LIMIT 1").run(fixtureUuid("duplicate-generation")),/retained-identity-conflict/u);
        assert.throws(()=>raw.prepare("INSERT INTO write_intents SELECT ?,system,idempotency_key,idempotency_key_digest,status,generation,run_id,payload_json,publication_json,created_at,updated_at FROM write_intents LIMIT 1").run(fixtureUuid("duplicate-permanent-key")),/write-identity-conflict/u);
        assert.throws(()=>raw.exec("UPDATE write_intents SET system=NULL"),/write-retry-or-identity-refused/u);
        assert.throws(()=>raw.exec("DELETE FROM write_attempts"),/retained-evidence-required/u);
        assert.throws(()=>raw.exec("DELETE FROM write_intents"),/write-identity-retained/u);
      }finally{raw.close();}
      const run=world.database.authority.runs.get(fixture.commit.transaction.runId);assert.ok(run);
      assert.equal(testRunService(world.database,historyClock).delete({runId:run.envelope.runId,expectedVersion:run.version,commandId:fixtureUuid("immutable-tombstone")}).state,"deleted");
      const checked=new DatabaseSync(world.path);
      try {
        assert.throws(()=>checked.exec("DELETE FROM deleted_runs"),/tombstone|retained/u);
        assert.deepEqual(checked.prepare("PRAGMA foreign_key_check").all(),[]);
      }finally{checked.close();}
    }finally{world.dispose();}
  });

  it("validates current operation scalar mirrors independently from strict payloads",()=>{
    const world=historyWorld();
    try {
      world.commit(82);releaseSeededWriteOwners(world.database,historyClock.now().toISOString());
      using saved=new DatabaseSync(world.path);
      const attempt=saved.prepare("SELECT id,generation FROM write_attempts").get();assert.ok(attempt);
      const generation=attempt.generation;assert.ok(typeof generation==="number");
      using _restore={ [Symbol.dispose]() { fault(world.path,["write_attempts_immutable"],raw=>{raw.prepare("UPDATE write_attempts SET generation=? WHERE id=?").run(generation,attempt.id);}); } };
      fault(world.path,["write_attempts_immutable"],raw=>assert.equal(raw.exec("UPDATE write_attempts SET generation=8"),undefined));
      const before=readFileSync(world.path);
      assert.throws(()=>inspectAuthorityBackupReadOnly(world.path),/write-attempt|record|generation/u);
      assert.throws(()=>AuthorityDatabase.open({path:world.path,busyTimeoutMs:250,migrationOwner:"current-operation-mirror"},historyClock),/write-attempt|record|generation/u);
      assert.deepEqual(readFileSync(world.path),before);
    }finally{world.dispose();}
  });

  it.each(["write_intents","write_attempts"] as const)("refuses extra fields in the current %s whole payload before read or reopen",table=>{
    const world=historyWorld();
    try {
      world.commit(83);releaseSeededWriteOwners(world.database,historyClock.now().toISOString());
      using saved=new DatabaseSync(world.path);
      const row=saved.prepare(`SELECT id,payload_json FROM ${table}`).get();assert.ok(row);
      const payload=row.payload_json;assert.ok(typeof payload==="string");
      using _restore={ [Symbol.dispose]() { fault(world.path,table==="write_attempts"?["write_attempts_immutable"]:[],raw=>{raw.prepare(`UPDATE ${table} SET payload_json=? WHERE id=?`).run(payload,row.id);}); } };
      fault(world.path,table==="write_attempts"?["write_attempts_immutable"]:[],raw=>{
        assert.equal(raw.prepare(`UPDATE ${table} SET payload_json=json_set(payload_json,?,true)`).run("$.unexpectedField").changes,1);
      });
      const bytes=readFileSync(world.path);
      assert.throws(()=>inspectAuthorityBackupReadOnly(world.path),/record|strict|invalid/u);
      assert.throws(()=>AuthorityDatabase.open({path:world.path,busyTimeoutMs:250,migrationOwner:"current-operation-payload"},historyClock),/record|strict|invalid/u);
      assert.deepEqual(readFileSync(world.path),bytes);
    }finally{world.dispose();}
  });
});
