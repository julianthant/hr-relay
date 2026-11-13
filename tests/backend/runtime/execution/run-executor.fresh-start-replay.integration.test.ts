import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { z } from "zod";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { deriveSettingsPatchFingerprint, SETTINGS_SCHEMA_HASH } from "../../../../src/models/config/settings.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { executeSettingsCommand } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { buildExplainRunView } from "../../../../src/backend/runs/explain/explain-run.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { bindWorkflowDelegationTargets, descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { Plan1CanonicalInput, Plan1Input, Plan1Output, plan1Contract, plan1ControlledFailureStores, plan1Leaf } from "../../../support/fixtures/plan1-operation-workflows.js";
import { canonicalChildExecution } from "../../../support/helpers/backend/canonical-child-execution.js";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";

const world = createRunExecutorTestWorld();
afterEach(world.cleanup);

const leaf = { id: plan1Leaf.descriptor.id, input: Plan1Input, result: Plan1Output };
const policy = { onChildFailed: "fail-parent" as const, cascadeCancel: "cascade" as const,
  afterChildRetry: "resume-parent" as const, visibility: "inline" as const };

/** source (checkpoint) → delegated lookup → dependent (checkpoint) → review gate. */
function freshStartRoot(version: number) {
  return compileWorkflow(defineWorkflow({ version, id: "fixture-fresh-start-replay", code: "ffs", label: "Fresh start replay",
    icon: "Search", category: "operations", input: Plan1Input, canonicalInput: Plan1CanonicalInput, inputSubject: "eid",
    surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [],
    identity: { matchKey: (input: { emplId: string }) => input.emplId }, presentation: { title: () => "Fresh start replay" },
    scenarios: ["fixture-plan1/happy"], role: defineWorkflowRole({ kind: "standalone" }),
    steps: ({ task, delegate, gate, result }) => {
      const source = task({ id: "source", contract: plan1Contract, replay: "checkpoint" }, [],
        ({ input }) => ({ ...input, text: `source:${input.text}`, mode: "ok" as const }));
      const lookup = delegate({ id: "lookup", target: leaf, edgeId: "lookup", cardinality: "one", await: "terminal", join: "one", policy }, [source],
        { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
      const dependent = task({ id: "dependent", contract: plan1Contract, replay: "checkpoint" }, [source, lookup],
        ({ input, outputs }) => {
          if (outputs.lookup.state !== "done") throw new Error("lookup-not-done");
          return { ...input, text: `dependent:${outputs.lookup.output.disposition}`, mode: "ok" as const };
        });
      const review = gate({ id: "review", label: "Review", result: z.strictObject({ approved: z.boolean() }) }, [dependent]);
      return { steps: [[{ key: "source", label: "Source" }, [source]], [{ key: "lookup", label: "Lookup" }, [lookup]],
        [{ key: "dependent", label: "Dependent" }, [dependent]], [{ key: "review", label: "Review" }, [review]]],
      result: result(Plan1Input, [review], ({ input }) => input) };
    } }));
}

async function fixture(versions: readonly [number, number]) {
  const [first, second] = versions.map(freshStartRoot) as [ReturnType<typeof freshStartRoot>, ReturnType<typeof freshStartRoot>];
  bindWorkflowDelegationTargets([plan1Leaf.descriptor]);
  const observed: string[] = [];
  const stores = plan1ControlledFailureStores(input => { observed.push(input.text); return input.mode === "fail"; });
  const h = await world.executorHarness({ descriptor: first.descriptor, stores });
  const { database, clock, path, stateRoot } = h.authority;
  const patch = { "actor.label": { set: "Synthetic operator" } } as const;
  assert.equal(executeSettingsCommand({ authority: database, clock, ids: { uuid: randomUUID },
    settings: createSettingsApplicationExecutor(value => resolveConfigWithProvenance(value, hostConfigFacts({}), clock), createCredentialStore({ stateRoot })) },
  { commandId: randomUUID(), family: "settings", type: "apply-settings", source: "settings-surface", requestedBy: "local-operator",
    requestedAt: clock.now().toISOString(), target: { expectedRevision: 1 },
    payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } }).state, "applied");
  let root: AnyWorkflowDescriptor = first.descriptor;
  const execution = canonicalChildExecution({ ...h.deps, stores }, database, path,
    id => id === root.id ? root : id === plan1Leaf.descriptor.id ? plan1Leaf.descriptor : undefined);
  const command = (type: "cancel", run: RunRecord) => execution.kernel.execute({ commandId: randomUUID(), family: "run", type, source: "dashboard",
    requestedBy: "local-operator", requestedAt: clock.now().toISOString(), reason: "Synthetic cancellation",
    target: { runId: run.envelope.runId, expectedVersion: run.version } });
  const runUntilSettled = async (run: RunRecord) => {
    for (let steps = 0; steps < 10; steps += 1) {
      const current = database.authority.runs.get(run.envelope.runId); assert.ok(current);
      if (current.lifecycle.state === "terminal" || current.lifecycle.state === "parked-gate") return current;
      await execution.step(run, world.SIGNAL);
    }
    throw new Error(`run ${run.envelope.runId} did not settle`);
  };
  return { database, execution, observed, command, runUntilSettled,
    start: (input: z.input<typeof Plan1Input>) => execution.start(root, input, { dryRun: false }),
    upgrade: () => { root = second.descriptor; } };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

function explainTimeline(f: Fixture, run: RunRecord) {
  const descriptor = freshStartRoot(run.envelope.descriptorVersion).descriptor;
  return buildExplainRunView({ run, checkpoints: f.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId),
    writes: [], nodeIds: descriptorRuntimeNodes(descriptor).map(node => String(node.id)), dependencies: [] }).timeline;
}

function rowsOf(f: Fixture, run: RunRecord) {
  return f.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId)
    .filter(row => row.runId === run.envelope.runId).map(row => String(row.nodeId)).sort();
}

function replayedFrom(f: Fixture, run: RunRecord) {
  return f.database.authority.timelineEvents.page({ runId: run.envelope.runId })
    .flatMap(event => event.payload.kind === "checkpoint-replayed" ? [[String(event.payload.checkpoint.nodeId), event.payload.checkpoint.runId]] : []);
}

async function cancelledRunA(f: Fixture, text = "a") {
  const a = await f.runUntilSettled(f.start({ emplId: "10800000", text, mode: "ok" }));
  assert.equal(a.lifecycle.state, "parked-gate");
  assert.deepEqual(rowsOf(f, a), ["dependent", "source"]);
  assert.equal(f.database.authority.runs.listChildren(a.envelope.runId).length, 1);
  assert.equal(f.command("cancel", a).state, "applied");
  const cancelled = f.database.authority.runs.get(a.envelope.runId);
  assert.ok(cancelled?.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
  return cancelled;
}

async function assertFreshStart(f: Fixture, a: RunRecord) {
  f.observed.length = 0;
  const b = await f.runUntilSettled(f.start({ emplId: "10800000", text: "b", mode: "ok" }));
  assert.equal(b.envelope.itemId, a.envelope.itemId, "a later Start lands on the same item");
  assert.equal(b.envelope.continuation, undefined);
  assert.equal(b.envelope.retryOf, undefined);
  assert.equal(b.lifecycle.state, "parked-gate");
  assert.deepEqual(rowsOf(f, b), ["dependent", "source"], "B executed every checkpoint step itself");
  assert.deepEqual(f.observed, ["source:b", "b", "b", "dependent:b/b"], "source, both child reads and the dependent all ran again");
  assert.equal(f.database.authority.runs.listChildren(b.envelope.runId).length, 1, "the delegation was issued again");
  // B resumes after the delegation yield by replaying its own source row, and nothing else.
  assert.deepEqual(replayedFrom(f, b), [["source", b.envelope.runId]]);
  const explained = explainTimeline(f, b).filter(entry => entry.disposition === "replayed-from-checkpoint");
  assert.deepEqual(explained.map(entry => entry.nodeId), ["source"]);
  assert.ok(explained.every(entry => entry.detail.startsWith(`checkpoint written by run ${b.envelope.runId} `)));
}

it("a plain Start after a Cancel replays no checkpoint of the cancelled run", async () => {
  const f = await fixture([1, 1]);
  await assertFreshStart(f, await cancelledRunA(f));
});

// The root's version guard already refuses the older rows; the unchanged leaf child is where the replay bit.
it("a plain Start under the next descriptor version replays no checkpoint of the older version, in the root or its child", async () => {
  const f = await fixture([1, 2]);
  const a = await cancelledRunA(f);
  f.upgrade();
  await assertFreshStart(f, a);
});

it("a plain Start re-issues a delegation whose earlier child did not finish done", async () => {
  const f = await fixture([1, 1]);
  const a = await f.runUntilSettled(f.start({ emplId: "10800000", text: "a", mode: "fail" }));
  assert.ok(a.lifecycle.state === "terminal" && a.lifecycle.outcome === "failed", JSON.stringify(a.lifecycle));
  assert.deepEqual(rowsOf(f, a), ["source"]);
  const child = f.database.authority.runs.listChildren(a.envelope.runId)[0];
  assert.ok(child?.lifecycle.state === "terminal" && child.lifecycle.outcome === "failed");
  f.observed.length = 0;
  const b = await f.runUntilSettled(f.start({ emplId: "10800000", text: "b", mode: "ok" }));
  assert.equal(b.envelope.itemId, a.envelope.itemId);
  assert.equal(b.envelope.retryOf, undefined);
  assert.equal(b.lifecycle.state, "parked-gate");
  // A failed without a Cancel, so its source row stays a valid ancestor; the undone delegation does not.
  assert.deepEqual(rowsOf(f, b), ["dependent"], "B replays A's source and executes the dependent itself");
  assert.equal(f.database.authority.runs.listChildren(b.envelope.runId).length, 1, "the delegation was issued again");
  assert.deepEqual(f.observed, ["b", "b", "dependent:b/b"], "the child reads and the dependent ran again; source did not");
  assert.ok(replayedFrom(f, b).every(([nodeId, runId]) => nodeId === "source" && runId === a.envelope.runId));
});
