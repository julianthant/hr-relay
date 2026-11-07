import { describe,expect,it } from "vitest";
import { nativeOrdinaryRecordFromRow } from "../../../../src/backend/storage/sqlite/native-record-row.js";
import { deriveCheckpointOutputDigest } from "../../../../src/models/run/result.js";
import { WorkerPoolRecordSchema } from "../../../../src/models/run/worker-pool.js";
import { RunCheckpointRecordSchema,checkpointRecordKey } from "../../../../src/models/workflow/checkpoint.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { HASH_A,NOW,UUID_1,UUID_2 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
describe("native ordinary whole records", () => {
  it("refuses a valid payload whose physical scalar identity differs and unknown whole payload fields", () => {
    const record = WorkerPoolRecordSchema.parse({ workflow:"person-lookup",desiredWorkers:0,version:1,plannedBy:"local-operator",plannedAt:NOW,createdAt:NOW,updatedAt:NOW });
    const row = {workflow:record.workflow,desired_workers:0,version:1,payload_json:canonicalJsonStringify(record),created_at:NOW,updated_at:NOW};
    expect(nativeOrdinaryRecordFromRow("worker_pools",row)).toEqual(record);
    expect(()=>nativeOrdinaryRecordFromRow("worker_pools",{...row,desired_workers:1})).toThrow(/desired_workers-mismatch/u);
    expect(()=>nativeOrdinaryRecordFromRow("worker_pools",{...row,payload_json:canonicalJsonStringify({...record,legacy:1})})).toThrow();
    expect(()=>nativeOrdinaryRecordFromRow("worker_pools",{...row,retired_column:1})).toThrow(/columns-mismatch/u);
  });
  it("binds the exact checkpoint tuple, execution generation and value-free output digest", () => {
    const record = RunCheckpointRecordSchema.parse({workflowId:"person-lookup",itemId:UUID_1,nodeId:"probe",attempt:1,claimGeneration:2,
      runId:UUID_2,output:{schemaHash:HASH_A,value:{name:"Synthetic"}},descriptorVersion:1,contractFingerprint:HASH_A,implFingerprint:HASH_A,provenance:[],writtenAt:NOW});
    const row = {id:checkpointRecordKey(record),run_id:record.runId,workflow:record.workflowId,item_id:record.itemId,node_id:record.nodeId,
      attempt:record.attempt,claim_generation:record.claimGeneration,output_digest:deriveCheckpointOutputDigest(record.output),payload_json:canonicalJsonStringify(record),created_at:record.writtenAt};
    expect(nativeOrdinaryRecordFromRow("run_checkpoints",row)).toEqual(record);
    expect(()=>nativeOrdinaryRecordFromRow("run_checkpoints",{...row,claim_generation:1})).toThrow(/claim_generation-mismatch/u);
    expect(()=>nativeOrdinaryRecordFromRow("run_checkpoints",{...row,output_digest:"b".repeat(64)})).toThrow(/output_digest-mismatch/u);
    expect(()=>nativeOrdinaryRecordFromRow("run_checkpoints",{...row,id:row.id.replaceAll("\u0000",":")})).toThrow(/id-mismatch/u);
  });
});
