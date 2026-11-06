import { i9CheckModule } from "../../support/helpers/registered-workflows.js";
import assert from "node:assert/strict";
import { afterEach, expect, it } from "vitest";
import { CHILD_ONLY_WORKFLOW_MODULES, createWorkflowRegistry, workflowModuleOf } from "../../../src/backend/app/registries/workflow-registry.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { executeClaimedRun } from "../../../src/backend/runtime/execution/run-executor.js";
import { planStart } from "../../../src/backend/runs/start/plan.js";
import { buildQueuedRun } from "../../../src/backend/runs/start/enqueue.js";
import { I9CheckInput, I9CheckCanonicalInput } from "../../../src/models/workflows/i9-check/input.js";
import { ReadRetentionRow } from "../../../src/models/workflows/i9-check/check.js";
import { I9CheckRowSchema } from "../../../src/models/workflows/i9-check/check.js";
import { descriptorRuntimeNodes, workflowProjections } from "../../../src/workflow-kit/workflow.js";
import { createRunExecutorTestWorld } from "../../support/helpers/backend/run-executor-world.js";
import { sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { testWorkerPorts, testWorkerLifetime } from "../../support/fixtures/run-lifecycle-fixtures.js";
import { sequentialIdFactory } from "../../support/fixtures/phase1f-run-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { i9Candidate, i9CheckInput, i9Search } from "../../support/fixtures/i9-check.js";
import { compileFixtureWorkflow } from "../../support/fixtures/workflow-definition-fixtures.js";
import { createSearchWorkflowDefinitionFixtures } from "../../support/helpers/search-workflow-definition-fixtures.js";
import { composeWorkflowModule } from "../../../src/workflow-kit/workflow-definition.js";
import { WorkflowIdSchema } from "../../../src/rules/identity/ids.js";
import type { SearchPersonOrgInputSchema } from "../../../src/models/systems/ucpath/search-person-org.js";
import type { z } from "zod";

const descriptor = i9CheckModule.descriptor;
const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

it("i9-check/person — admits I-9 only as a declared child and limits it to read-only UCPath operations", () => {
  expect(CHILD_ONLY_WORKFLOW_MODULES).toContain(i9CheckModule);
  expect(() => workflowModuleOf("i9-check")).toThrow(/not registered/u);
  expect(descriptor.surfaces).toEqual({});
  expect(workflowProjections(descriptor).systems).toEqual(["ucpath"]);
  expect(descriptorRuntimeNodes(descriptor).every(node => node.kind === "task")).toBe(true);
  expect(workflowProjections(descriptor).contracts.every(contract => contract.effect === "read")).toBe(true);
  expect(descriptor.timeline.map(step => step.key)).toEqual(["person-match", "person-lookup", "roster-match"]);
  const { fixtureWorkflow } = createSearchWorkflowDefinitionFixtures();
  const parent = composeWorkflowModule(compileFixtureWorkflow(fixtureWorkflow("i9-fixture-parent", ({ delegate, result }) => {
    const child = delegate({ id: "check", target: { id: WorkflowIdSchema.parse("i9-check"), input: I9CheckInput, result: ReadRetentionRow.output },
      edgeId: "check", cardinality: "one", await: "none", join: "none",
      policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
    }, [], { bind: () => i9CheckInput, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "work", label: "Work" }, [child]]], result: result(I9CheckCanonicalInput, [], () => i9CheckInput) };
  })), []);
  const registry = createWorkflowRegistry([parent], [i9CheckModule]);
  expect(registry.childModuleOf("i9-fixture-parent", "i9-check")).toBe(i9CheckModule);
  expect(() => registry.childModuleOf("person-lookup", "i9-check")).toThrow(/does not declare/u);
});

it.each(["match", "name", "ambiguous", "failure"] as const)("executes the registered child through the real executor: %s", async mode => {
  let matches = 0, searches = 0;
  const sessions = sessionFactoryHarness({ ucpath: () => ({ ...createDeterministicUcpathPersonOrgDriver(i9Search()),
    async searchPersonMatch() { matches++; const hit = { emplId: i9Candidate.emplId, name: i9Candidate.name }; return { hits: [hit], confirmed: mode === "ambiguous" ? [hit, { ...hit, emplId: "10000002" }] : [hit], dropped: [] }; },
    async searchPersonOrg(request: z.output<typeof SearchPersonOrgInputSchema>) {
      searches++;
      expect(request).toEqual({ kind: "by-name", name: i9CheckInput.person.name, keepNonHdh: true });
      if (mode === "failure") throw new Error("Fixture UCPath unavailable");
      return i9Search();
    },
  }) });
  const harness = await world.executorHarness({ descriptor, sessions });
  const { database, clock, path } = harness.authority;
  const input = I9CheckInput.parse({ ...i9CheckInput, person: { ...i9CheckInput.person, ...((mode === "match" || mode === "ambiguous") ? { dob: "2000-01-15" } : {}) } });
  const plan = planStart({ authority: database, clock, ids: sequentialIdFactory("f"), planTtlMs: 600000 }, {
    descriptor, submissions: [input], dryRun: false, priority: "bulk", shape: "operation-member", plannedBy: "local-operator",
    configFingerprint: CONFIG_SNAPSHOT.fingerprint, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
  });
  assert.equal(plan.refused.length, 0);
  const entry = plan.planned[0]; assert.ok(entry);
  const queued = buildQueuedRun({ descriptor, runId: "22222222-2222-4222-8222-222222222222", itemId: entry.itemId, traceId: "ic-090000-2222",
    rawInput: entry.rawInput, canonicalInput: entry.input, ingressSchemaHash: plan.ingressSchemaHash,
    configFingerprint: plan.configFingerprint, configSnapshotId: plan.configSnapshotId, resolvedInstance: plan.resolvedInstance,
    shape: plan.shape, priority: plan.priority, dryRun: false, attempt: 1, runNumber: 1, appVersion: "0.1.0", now: clock.now().toISOString() });
  testWorkerPorts(database, clock, { path, descriptor, poolIndex: 1 });
  const slot = database.authority.workerSlots.list(descriptor.id).find(member => member.poolIndex === 1 && member.retiredAt === null); assert.ok(slot);
  database.authority.runs.enqueue(queued);
  const lifetime = testWorkerLifetime(database, descriptor.id, 1);
  const claimed = database.authority.runs.claimNext({ workflow: descriptor.id, workerId: slot.workerId, workerLifetime: lifetime.workerLifetime, now: clock.now().toISOString() });
  assert.equal(claimed.state, "claimed");
  if (claimed.state !== "claimed") throw new Error("Fixture claim failed");
  const result = await executeClaimedRun(harness.deps, { run: claimed.run, claim: { workerId: slot.workerId, claimGeneration: claimed.run.claimGeneration }, signal: new AbortController().signal });
  const failures = database.authority.failures.listByRun(queued.envelope.runId);
  expect(result.state, failures.map(failure => failure.summary).join("; ")).toBe(mode === "failure" ? "failed" : "done");
  expect(matches).toBe(mode === "match" || mode === "ambiguous" ? 1 : 0);
  expect(searches).toBe(mode === "match" ? 0 : 1);
  if (mode !== "failure") {
    const terminal = database.authority.runResults.get(queued.envelope.runId); assert.ok(terminal);
    const output = ReadRetentionRow.output.parse(terminal.result.value);
    expect(I9CheckRowSchema.parse(output.row)).toMatchObject({ ucpathEmplId: "10000001", ppsEid: "000012345", action: "Keep" });
    expect(terminal.dependencies.length).toBeGreaterThan(0);
  } else expect(failures[0]?.code).toBe("PERSON_LOOKUP_UCPATH_SEARCH_FAILED");
});
