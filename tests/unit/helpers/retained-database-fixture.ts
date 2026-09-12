import assert from "node:assert/strict";
import { readFileSync,rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AUTHORITY_APPLICATION_ID,SQLITE_MIGRATIONS } from "../../../src/infra/sqlite/migrations.js";
import { inspectAuthorityBackupReadOnly } from "../../../src/infra/compat/backup-inspection.js";

/** Replace only a caller-owned synthetic fixture with an inspected frozen schema-46 image. */
export function restoreRetainedFixture(path:string,source:URL):void {
  const {rows}=z.object({rows:z.record(z.string().regex(/^[a-z_]+$/u),z.array(z.record(z.string(),z.union([z.string(),z.number(),z.null()]))))}).parse(JSON.parse(readFileSync(source,"utf8")));
  rmSync(path);
  const raw=new DatabaseSync(path);
  try {
    raw.exec("PRAGMA foreign_keys=OFF; BEGIN EXCLUSIVE");
    for(const migration of SQLITE_MIGRATIONS.filter(row=>row.version<=46))for(const sql of migration.statements)raw.exec(sql);
    const triggers=z.array(z.object({name:z.string().regex(/^[a-z_]+$/u),sql:z.string()})).parse(raw.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all());
    for(const trigger of triggers)raw.exec(`DROP TRIGGER ${trigger.name}`);
    for(const [table,records] of Object.entries(rows))for(const row of records) {
      const columns=Object.keys(row);raw.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`).run(...Object.values(row));
    }
    for(const trigger of triggers)raw.exec(trigger.sql);
    raw.exec(`PRAGMA user_version=46; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}`);
    assert.deepEqual(raw.prepare("PRAGMA foreign_key_check").all(),[]);raw.exec("COMMIT");
  }finally{raw.close();}
  assert.equal(inspectAuthorityBackupReadOnly(path).schemaVersion,46);
}
