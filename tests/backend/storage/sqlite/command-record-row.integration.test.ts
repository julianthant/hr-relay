import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach,describe,it } from "vitest";
import { NativeCommandAuditSchema } from "../../../../src/backend/storage/sqlite/command-record-row.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { absentProbeEvidence,writeFixtureDescriptor,writeFixtureParallelDescriptor } from "../../../support/fixtures/write-sequencer-fixtures.js";

const disposers: (() => void)[] = [];
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); });
function harness(parallel = false) { const h = sourceBoundHarness(parallel ? writeFixtureParallelDescriptor : writeFixtureDescriptor); disposers.push(h.dispose); return h; }
async function completed(h: ReturnType<typeof harness>) {
  const run = h.start(h.proposal());
  h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
  const outcome = await h.execute(run);
  assert.equal(outcome.state, "done", JSON.stringify(outcome.state === "failed" ? h.database.authority.failures.get(outcome.failureId) : outcome));
  return h.fresh(run);
}

describe("source-bound repeat through planner, kernel, service and interpreter", () => {

  it.each(["target","missing-audit","audit-owner"])("refuses malformed or ambiguous terminal history owner %s before deletion",async fault=>{
    const h=harness(),source=await completed(h),raw=new DatabaseSync(h.authorityPath);
    try {
      const row=raw.prepare("SELECT * FROM commands WHERE target_id=? AND json_extract(request_json,'$.operation')='terminalize'").get(source.envelope.runId);
      assert.ok(row && typeof row.id==="string" && typeof row.outcome_json==="string");
      const auditRow=raw.prepare("SELECT * FROM command_audits WHERE command_id=?").get(row.id);assert.ok(auditRow);
      if(fault==="target")raw.prepare("UPDATE commands SET target_id=? WHERE id=?").run(h.ids.uuid(),row.id);
      else if(fault==="missing-audit"){raw.exec("DROP TRIGGER command_audits_retained");raw.prepare("DELETE FROM command_audits WHERE command_id=?").run(row.id);}
      else {
        raw.exec("DROP TRIGGER command_audits_immutable");
        const original=NativeCommandAuditSchema.parse(JSON.parse(row.outcome_json));
        assert.ok("kind" in original && original.kind==="run-lifecycle" && original.result.kind==="run");
        const audit={...original,result:{...original.result,runId:h.ids.uuid()}};
        raw.prepare("UPDATE command_audits SET payload_json=? WHERE command_id=?").run(canonicalJsonStringify(audit),row.id);
        raw.prepare("UPDATE commands SET outcome_json=? WHERE id=?").run(canonicalJsonStringify(audit),row.id);
      }
    }finally{raw.close();}
    const generation=h.database.getMeta().authorityGeneration,commandId=h.ids.uuid();
    assert.throws(()=>h.lifecycle.delete({commandId,runId:source.envelope.runId,expectedVersion:source.version}),/identity-mismatch|terminal-audit-missing|terminal-owner-mismatch/u);
    assert.deepEqual(h.fresh(source),source);assert.equal(h.database.getMeta().authorityGeneration,generation);
    assert.equal(h.database.authority.lifecycleJournal.getCommand(commandId),undefined);
  });



});
