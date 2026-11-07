import assert from "node:assert/strict";
import { afterAll, afterEach, it } from "vitest";
import { z } from "zod";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { WriteFixturePrepare, WriteFixtureCommit, buildWriteFixtureRegistry, createWriteFixtureWorld, writeFixtureSessions, WRITE_FIXTURE_EID } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../../src/rules/identity/ids.js";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";

const profiles = createProfileFixtureSet(), world = createRunExecutorTestWorld(profiles.create);
afterAll(() => profiles.close());
afterEach(world.cleanup);
const input = z.strictObject({ eid: EidSchema });
const { __sealed: _commitSeal, ...commitDefinition } = WriteFixtureCommit;
const prepare = WriteFixturePrepare;
const commit = defineTaskContract({ ...commitDefinition, errorCodes: ["CONTACT_SAVE_UNAVAILABLE"] });
const compiled = compileWorkflow(defineWorkflow({ id: "fixture-transaction-bind-refusal", version: 1, code: "fbr", label: "Transaction bind refusal",
  icon: "Users", category: "operations", input, canonicalInput: defineCanonicalInput(input, input, [{ eid: WRITE_FIXTURE_EID }]),
  requiredWorkbookTypeIds: [], inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], scenarios: ["fixture-transaction-bind-refusal/happy"], identity: { matchKey: value => value.eid },
  presentation: { title: value => value.eid }, role: defineWorkflowRole({ kind: "standalone" }),
  steps: author => {
    const contact = author.transaction({ id: "contact", prepare, commit, dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 45_000 }, [], {
      prepareBind: ({ input }) => input,
      commitBind: () => { throw new TaskError(commit.id, "CONTACT_SAVE_UNAVAILABLE", "Contact Save is unavailable."); },
    });
    return { steps: [[{ key: "contact", label: "Contact" }, [contact]]], result: author.result(commit.output, [contact], ({ outputs }) => outputs.contact.output) };
  },
}));

it("terminalizes a named real transaction bind refusal before sequencer, probe or browser acquisition", async () => {
  const driver = createWriteFixtureWorld(), stores = buildWriteFixtureRegistry(driver), sessions = writeFixtureSessions(driver);
  const h = await world.executorHarness({ descriptor: compiled.descriptor, stores, sessions });
  let calls = 0;
  const refuseSequencer = async () => { calls++; throw new Error("sequencer-must-not-run"); };
  const execution = canonicalChildExecution({ ...h.deps, writeSequencer: { executeTransaction: refuseSequencer, executeDryRun: refuseSequencer } },
    h.authority.database, h.authority.path, id => id === compiled.descriptor.id ? compiled.descriptor : undefined);
  const run = execution.start(compiled.descriptor, { eid: WRITE_FIXTURE_EID }, { dryRun: false });
  const result = await execution.execute(run, world.SIGNAL);
  assert.equal(result.run?.lifecycle.state, "terminal");
  assert.equal(result.outcomes.at(-1)?.state, "failed");
  assert.equal(h.authority.database.authority.failures.listByRun(run.envelope.runId)[0]?.code, "CONTACT_SAVE_UNAVAILABLE");
  assert.equal(calls, 0);
  assert.equal(sessions.opens(), 0);
  assert.deepEqual(driver.events, []);
  assert.deepEqual(h.authority.database.authority.writeIntents.countDryRunEvidenceByRun(run.envelope.runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
  assert.deepEqual(h.authority.database.authority.writeIntents.listByRun(run.envelope.runId), []);
});
