import assert from "node:assert/strict";
import { renameSync, chmodSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { foundationFixture, NOW } from "../database-foundation/fixtures.js";
import { ledgerCommitFixture } from "../fixtures/ledger-projection-fixtures.js";
import { atomicWriteCheckpoint } from "../helpers/timeline-write-fixture.js";
import { ARCHIVED_RUN, ARCHIVE_RELAUNCH, VERSION_PLAN_ROW, VERSION_BUMP_APPLICATION } from "../../fixtures/archive-fixtures.js";
import { attachFile } from "./fixtures.js";
import { withStoppedArchiveConversion, AuthorityDatabase } from "../../helpers/synthetic-storage-admission.js";
import { SQLITE_MIGRATIONS, AUTHORITY_APPLICATION_ID } from "../../../src/infra/sqlite/migrations.js";

export function historicalFixture() {
  const f=foundationFixture();
  f.db.authority.runs.transition({runId:f.run.envelope.runId,expectedVersion:f.run.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:NOW},now:NOW});
  const file=attachFile(f.db,f.root,f.run.envelope.runId,9800);
  const transaction=ledgerCommitFixture(75,{runId:f.run.envelope.runId,workflowId:f.run.envelope.workflow,itemId:f.run.envelope.itemId,traceId:f.run.envelope.traceId,configFingerprint:f.run.envelope.configFingerprint,confirmedAt:NOW});
  assert.equal(f.db.authority.writeIntents.fenceAttempt({intent:transaction.intent,attempt:transaction.attempt}).state,"fenced");
  f.db.commitWriteAttempt(transaction.commit,atomicWriteCheckpoint(transaction.commit));
  f.createRun(ARCHIVE_RELAUNCH.runId);
  f.db.close();
  // Build an exact released v48 schema, then copy synthetic current source rows into it.
  const schema=new DatabaseSync(":memory:"),source=new DatabaseSync(f.path,{readOnly:true}),target=new DatabaseSync(`${f.path}.historical`);
  try {
    for(const migration of SQLITE_MIGRATIONS.filter(row=>row.version<=48))for(const statement of migration.statements)schema.exec(statement);
    const objects=schema.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid").all().map(row=>z.object({type:z.string(),name:z.string(),sql:z.string()}).parse(row));
    target.exec("PRAGMA foreign_keys=OFF");
    for(const object of objects.filter(row=>row.type==="table")) {
      target.exec(object.sql);
      if(object.name==="database_upgrades" || source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(object.name)===undefined)continue;
      for(const row of source.prepare(`SELECT * FROM ${object.name}`).all()) {
        const columns=Object.keys(row);target.prepare(`INSERT INTO ${object.name} (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`).run(...Object.values(row));
      }
    }
    target.exec("UPDATE database_state SET schema_version=48");
    for(const object of objects.filter(row=>row.type!=="table"))target.exec(object.sql);
    target.exec(`PRAGMA user_version=48; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA foreign_keys=ON`);
  } finally {schema.close();source.close();target.close();}
  renameSync(`${f.path}.historical`,f.path);chmodSync(f.path,0o600);
  const result={...f,file};
  withHistoricalAuthority(result,db=>{
    db.authority.versionPlans.insert(VERSION_PLAN_ROW);
    db.authority.versionPlans.consume({versionPlanId:VERSION_PLAN_ROW.versionPlanId,expectedVersion:1,planFingerprint:VERSION_PLAN_ROW.planFingerprint,now:NOW});
    db.authority.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
    db.authority.archivedRuns.insert(ARCHIVED_RUN);

  });
  const lineage = new DatabaseSync(f.path);
  try { lineage.prepare("INSERT INTO archive_relaunches(record_key,archived_run_id,record_json,created_at) VALUES (?,?,?,?)").run(ARCHIVE_RELAUNCH.runId, ARCHIVE_RELAUNCH.archivedRunId, JSON.stringify(ARCHIVE_RELAUNCH), ARCHIVE_RELAUNCH.relaunchedAt); } finally { lineage.close(); }
  return result;
}
export function withHistoricalAuthority<T>(f: Pick<ReturnType<typeof foundationFixture>,"path"|"clock">,work:(database:AuthorityDatabase)=>T):T {
  const raw=new DatabaseSync(f.path);
  raw.exec("PRAGMA foreign_keys=ON; BEGIN EXCLUSIVE");
  try {const result=withStoppedArchiveConversion(raw,f.path,f.clock,undefined,work);raw.exec("COMMIT");return result;}
  catch(error){if(raw.isTransaction)raw.exec("ROLLBACK");throw error;}
  finally{raw.close();}
}
