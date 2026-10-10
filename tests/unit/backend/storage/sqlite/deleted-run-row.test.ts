import { describe, expect, it } from "vitest";
import { DeletedRunRecordSchema } from "../../../../../src/models/run/deleted-run.js";
import { deletedRunFromRow } from "../../../../../src/backend/storage/sqlite/deleted-run-row.js";
import { canonicalJsonStringify } from "../../../../../src/rules/validation/canonical-json.js";
import { NOW, UUID_1, UUID_2, UUID_3, HASH_A } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
const receipt = DeletedRunRecordSchema.parse({runId:UUID_1,workflow:"person-lookup",itemId:UUID_2,attempt:2,runNumber:9,
  traceId:"pl-170000-2222",ordinalSource:"tombstone",origin:"queue",commandId:UUID_3,deletedAt:NOW,tallyVersion:3,
  removed:[{table:"timeline_events",rows:3},{table:"runs",rows:1}]});
const files = [{ref:{id:UUID_2,sha256:HASH_A,bytes:13,mediaType:"application/json"},disposition:"remove",storedSha256:HASH_A,storedBytes:200}];
function row() { return {run_id:receipt.runId,workflow:receipt.workflow,item_id:receipt.itemId,attempt:receipt.attempt,
  run_number:receipt.runNumber,trace_id:receipt.traceId,command_id:receipt.commandId,deleted_at:NOW,cleanup_state:"pending",
  receipt_json:canonicalJsonStringify(receipt),files_json:canonicalJsonStringify(files)}; }
describe("native immutable deletion evidence", () => {
  it("admits the full receipt and independently validated byte manifest through cleanup", () => {
    expect(deletedRunFromRow(row())).toEqual({receipt,files,cleanupState:"pending"});
    expect(deletedRunFromRow({...row(),cleanup_state:"complete"})).toEqual({receipt,files,cleanupState:"complete"});
    expect(()=>deletedRunFromRow({...row(),files_json:canonicalJsonStringify([{...files[0],retiredPath:"old"}])})).toThrow();
    expect(()=>deletedRunFromRow({...row(),files_json:canonicalJsonStringify([...files,...files])})).toThrow();
  });
  it.each(["run_id","workflow","item_id","attempt","run_number","trace_id","command_id","deleted_at"])("refuses a forged %s scalar", key => {
    expect(()=>deletedRunFromRow({...row(),[key]:key === "attempt" ? 3 : "forged"})).toThrow();
  });
  it("refuses historical receipt variants, duplicate counts and unknown whole-record fields", () => {
    expect(()=>DeletedRunRecordSchema.parse({...receipt,itemId:null})).toThrow();
    expect(()=>DeletedRunRecordSchema.parse({...receipt,ordinalSource:"span-root-backfill"})).toThrow();
    expect(()=>DeletedRunRecordSchema.parse({...receipt,tallyVersion:1})).toThrow();
    expect(()=>DeletedRunRecordSchema.parse({...receipt,removed:[{table:"write_intents",rows:1}]})).toThrow();
    expect(()=>DeletedRunRecordSchema.parse({...receipt,removed:[...receipt.removed,receipt.removed[0]]})).toThrow();
    expect(()=>deletedRunFromRow({...row(),receipt_json:canonicalJsonStringify({...receipt,converted:true})})).toThrow();
  });
});
