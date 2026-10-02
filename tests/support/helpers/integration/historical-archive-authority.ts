import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Clock } from "../../../../src/rules/time/clock.js";
import { withStoppedArchiveConversion, AuthorityDatabase } from "../synthetic-storage-admission.js";
import { AUTHORITY_APPLICATION_ID, SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { createRunSummaries } from "../../../../src/backend/storage/sqlite/run-summaries.js";

/** Frozen mirror-model tests use the released v48 schema explicitly. Current opens still refuse it.
 * Each operation borrows the same stopped conversion capability used by the production migrator. */
export function historicalArchiveAuthority(path:string,clock:Clock):AuthorityDatabase {
  if(!existsSync(path)) {
    const raw=new DatabaseSync(path);
    try {
      for(const migration of SQLITE_MIGRATIONS.filter(row=>row.version<=48))for(const statement of migration.statements)raw.exec(statement);
      raw.prepare("INSERT INTO database_state(singleton_id,schema_version,authority_generation,updated_at) VALUES (1,48,0,?)").run(clock.now().toISOString());
      raw.exec(`PRAGMA user_version=48; PRAGMA application_id=${String(AUTHORITY_APPLICATION_ID)}; PRAGMA journal_mode=WAL`);
    }finally{raw.close();}
  }
  const target=AuthorityDatabase.open({path,busyTimeoutMs:250,migrationOwner:"historical-archive-proof",openMode:"storage-upgrade-preflight-read-only-no-migrate"},clock);
  let closed=false;
  let active:AuthorityDatabase|undefined;
  const call=(database:AuthorityDatabase,keys:PropertyKey[],args:unknown[]):unknown=>{
    let owner:object=database;
    for(const key of keys.slice(0,-1)){const next:unknown=Reflect.get(owner,key);if(typeof next!=="object"||next===null)throw new Error("historical fixture owner missing");owner=next;}
    const method:unknown=Reflect.get(owner,keys.at(-1)??"");if(typeof method!=="function")throw new Error("historical fixture method missing");
    return Reflect.apply(method,owner,args) as unknown;
  };
  const invoke=(keys:PropertyKey[],args:unknown[])=>{
    if(keys.length===1&&(keys[0]==="close"||keys[0]===Symbol.dispose)){if(!closed)target.close();closed=true;return;}
    if(closed)throw new Error("historical fixture closed");
    if(active!==undefined)return call(active,keys,args);
    const raw=new DatabaseSync(path);raw.exec("PRAGMA foreign_keys=ON; BEGIN EXCLUSIVE");
    try {
      const result=withStoppedArchiveConversion(raw,path,clock,undefined,database=>{
        const before=z.object({count:z.number()}).parse(raw.prepare("SELECT total_changes() AS count").get()).count;
        active=database;
        let value:unknown;
        try { value=call(database,keys,args); } finally {active=undefined;}
        const after=z.object({count:z.number()}).parse(raw.prepare("SELECT total_changes() AS count").get()).count;
        if(after>before){
          raw.exec("UPDATE database_state SET authority_generation=authority_generation+1");
          const generation=z.object({authority_generation:z.number()}).parse(raw.prepare("SELECT authority_generation FROM database_state").get()).authority_generation;
          if(raw.prepare("SELECT 1 FROM summary_publication").get()!==undefined)createRunSummaries(raw).refresh(generation,clock.now().toISOString());
        }
        return value;
      });
      raw.exec("COMMIT");return result;
    }catch(error){if(raw.isTransaction)raw.exec("ROLLBACK");throw error;}
    finally{raw.close();}
  };
  const wrap=(value:unknown,keys:PropertyKey[]):unknown=>{
    if(typeof value==="function")return (...args:unknown[])=>invoke(keys,args);
    if(typeof value==="object"&&value!==null)return new Proxy({}, {get:(_target,key)=>wrap(Reflect.get(value,key),[...keys,key])});
    return value;
  };
  return new Proxy(target,{get:(object,key)=>wrap(Reflect.get(object,key),[key])});
}
