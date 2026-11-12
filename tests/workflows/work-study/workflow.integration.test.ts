import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { deterministicPayPathOperations } from "../../../src/backend/systems/ucpath/driver/paypath-fake.js";
import { UcpathPayPathReadSchema } from "../../../src/models/ui/ucpath-paypath.js";
import { WorkStudyResultSchema } from "../../../src/models/workflows/work-study/result.js";
import { compileWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { workStudyWorkflow } from "../../../src/workflows/work-study/workflow.js";
import { canonicalChildExecution } from "../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);
const compiled = compileWorkflow(workStudyWorkflow);
const read = UcpathPayPathReadSchema.parse({
  pageStateId: "ucpath.paypath.position-data-ready", observedAt: "2026-08-01T12:00:00.000Z", emplId: "10000001", displayedName: "Lee, Jordan",
  position: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
});

it("work-study/planned-transaction — plans from the PayPath read with zero write intents, attempts and confirmations", async () => {
  const sessions = sessionFactoryHarness({ ucpath: () => ({ ...createDeterministicUcpathPersonOrgDriver(), ...deterministicPayPathOperations({ read }) }) });
  const h = await world.executorHarness({ descriptor: compiled.descriptor, sessions });
  const { database } = h.authority;
  const execution = canonicalChildExecution(h.deps, database, h.authority.path, id => id === compiled.descriptor.id ? compiled.descriptor : undefined);
  const run = execution.start(compiled.descriptor, { emplId: "10000001", effectiveDate: "2026-08-03" });
  await execution.execute(run, world.SIGNAL);
  const runId = run.envelope.runId;
  assert.deepEqual(database.authority.failures.listByRun(runId).map(failure => failure.summary), []);
  const stored = database.authority.runResults.get(runId);
  assert.ok(stored);
  assert.deepEqual(WorkStudyResultSchema.parse(stored.result.value), { state: "planned", plan: {
    emplId: "10000001", name: "Lee, Jordan", effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F",
    comments: "Updated pool id to F per work study award 08/03/2026",
    current: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
  } });
  assert.deepEqual(database.authority.writeIntents.listByRun(runId), []);
  assert.deepEqual(database.authority.writeIntents.countDryRunEvidenceByRun(runId), { writeIntents: 0, writeAttempts: 0, confirmedOperations: 0 });
});
