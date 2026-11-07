import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,expect,it } from "vitest";
import { commandFromRow,insertNativeCommand,settleNativeCommand } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { SQLITE_MIGRATIONS } from "../../../../src/backend/storage/sqlite/migrations.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { LATER,NOW,UUID_1,UUID_2,UUID_3 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
const databases:DatabaseSync[]=[];
afterEach(()=>{for(const db of databases.splice(0))db.close();});
const request={commandId:UUID_1,runId:UUID_2,expectedVersion:5};
const command={kind:"run-lifecycle",commandId:UUID_1,operation:"delete",request,
  requestFingerprint:sha256Hex(`hrauto:run-lifecycle-command:v1\0delete\0${canonicalJsonStringify(request)}`),
  fence:{kind:"version",expectedVersion:5},recordedAt:NOW};
describe("whole native internal commands",()=>{
  it("persists the complete admitted request, immutable outcome and exact replay",()=>{
    const db=new DatabaseSync(":memory:");databases.push(db);
    for(const migration of SQLITE_MIGRATIONS)for(const sql of migration.statements)db.exec(sql);
    expect(insertNativeCommand(db,command)).toBe(1);
    expect(commandFromRow(db.prepare("SELECT * FROM commands").get())).toEqual(command);
    expect(db.prepare("SELECT target_id FROM commands").get()?.target_id).toBe(UUID_2);
    expect(()=>commandFromRow({...db.prepare("SELECT * FROM commands").get(),target_id:UUID_3})).toThrow(/identity-mismatch/u);
    const audit={kind:"run-lifecycle",auditId:UUID_3,request:command,result:{kind:"deletion",runIds:[UUID_2]},completedAt:LATER};
    settleNativeCommand(db,audit);expect(insertNativeCommand(db,command)).toBe(0);settleNativeCommand(db,audit);
    expect(db.prepare("SELECT state,updated_at,outcome_json FROM commands").get()).toEqual({state:"succeeded",updated_at:LATER,outcome_json:canonicalJsonStringify(audit)});
    expect(()=>settleNativeCommand(db,{...audit,result:{kind:"deletion",runIds:[UUID_3]}})).toThrow();
    expect(()=>insertNativeCommand(db,{...command,request:{...request,expectedVersion:6}})).toThrow();
  });
});
