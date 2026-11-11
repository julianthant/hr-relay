import assert from "node:assert/strict";
import type { admitDelegation } from "../../../../src/backend/runs/lifecycle/delegation-admission.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { WriteIntentRecordSchema, deriveWriteBindingProofDigest } from "../../../../src/rules/write-safety/write-safety.js";
import { deriveWriteAuthorityReason } from "../../../../src/rules/write-safety/write-authority-reason.js";
import { WRITE_INTENT_ATTEMPTING } from "../../fixtures/phase1c-contract-fixtures.js";

export function assertDelegationWriteRecoveryRefusals(native: typeof admitDelegation, ...[dependencies, batch, plans, lifecycle]: Parameters<typeof admitDelegation>) {
  const database = dependencies.database;
  const run = batch.run;
  const bindingProof = { ...WRITE_INTENT_ATTEMPTING.bindingProof, runId: run.envelope.runId };
  for (const status of ["attempting", "parked"] as const) {
    const intent = WriteIntentRecordSchema.parse({ ...WRITE_INTENT_ATTEMPTING,
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId, runId: run.envelope.runId,
      bindingProof, bindingProofDigest: deriveWriteBindingProofDigest(bindingProof), status,
      ...(status === "attempting" ? {} : { parkedCode: "unknown", message: "Synthetic UNKNOWN",
        authorityReason: deriveWriteAuthorityReason("recovery-probe-unknown", "probe", "synthetic") }) });
    const observed = new Proxy(database, { get(target, key) {
      if (key === "evidenceSchemaHash") return target.evidenceSchemaHash.bind(target);
      if (key === "withAuthorityTransaction") return <Result>(work: (repositories: AuthorityRepositories) => Result) =>
        target.withAuthorityTransaction(repositories => work({ ...repositories, writeIntents: { ...repositories.writeIntents,
          listAttemptingByItem: query => {
            assert.deepEqual(query, { workflowId: run.envelope.workflow, itemId: run.envelope.itemId });
            return status === "attempting" ? [intent] : [];
          },
          listByRun: runId => { assert.equal(runId, run.envelope.runId); return status === "parked" ? [intent] : []; },
        } }));
      return Reflect.get(target, key, target);
    } });
    const generation = database.getMeta().authorityGeneration;
    assert.throws(() => native({ ...dependencies, database: observed }, batch, plans, lifecycle),
      /delegation-write-recovery-required/u);
    assert.equal(database.getMeta().authorityGeneration, generation);
    assert.deepEqual(database.authority.runs.listChildren(run.envelope.runId), []);
    assert.deepEqual(database.authority.delegationManifests.listByParentRun(run.envelope.runId), []);
    assert.deepEqual(database.authority.lifecycleJournal.listDelegationInvocations(run.envelope.runId), []);
    assert.deepEqual(database.authority.dependencies.listByParentRun(run.envelope.runId), []);
  }
}
