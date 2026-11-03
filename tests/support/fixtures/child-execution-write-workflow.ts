import { z } from "zod";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/models/workflow/presentation.js";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { compileWorkflow, composeWorkflowModule, defineWorkflow } from "../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../src/workflow-kit/validation/module-role.js";
import { WRITE_FIXTURE_EID, writeFixtureDescriptor, WriteFixturePrepare, WriteFixtureCommit,
  buildWriteFixtureRegistry, type WriteFixtureWorld } from "./write-sequencer-fixtures.js";
import { fixtureBuildManifest } from "./workflow-definition-fixtures.js";
import { defineTaskStoreRegistry } from "../../../src/workflow-kit/task-registry.js";
import { Plan1Input, Plan1CanonicalInput, Plan1Output, plan1Contract, plan1Leaf, plan1Stores } from "./plan1-operation-workflows.js";
import { childExecutionNested } from "./child-execution-workflows.js";
import { childExecutionBuildManifest } from "./child-execution-build-manifest.js";

const input = z.strictObject({ eid: EidSchema });
const output = z.strictObject({ transactionId: z.string().min(1) });
const id = "fixture-child-write-recovery";
export const childWriteRecoveryRoot = compileWorkflow(defineWorkflow({ id, version: 1, code: "fcw", label: "Synthetic child write recovery", icon: "ShieldCheck",
  category: "operations", input, canonicalInput: defineCanonicalInput(input, input, [{ eid: WRITE_FIXTURE_EID }]),
  inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], identity: { matchKey: value => `eid:${value.eid}` }, presentation: { title: () => "Synthetic child write recovery" },
  scenarios: ["write-fixture/happy"], role: defineWorkflowRole({ kind: "standalone" }), steps: ({ delegate, result }) => {
    const child = delegate({ id: "write", target: { id: writeFixtureDescriptor.id, input, result: output }, edgeId: "write",
      cardinality: "one", await: "terminal", join: "one", policy: { cascadeCancel: "cascade", onChildFailed: "fail-parent",
        afterChildRetry: "resume-parent", visibility: "inline" } }, [],
    { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "write", label: "Write child" }, [child]]], result: result(output, [child], ({ outputs }) => {
      if (outputs.write.state !== "done") throw new Error("write-child-not-done");
      return outputs.write.output;
    }, [{ path: "transactionId", source: { kind: "child-output", entryId: "write", path: "transactionId" } }]) };
  } }), { manifest: fixtureBuildManifest([id]) });

const crashChildId = "fixture-child-crash-write", crashRootId = "fixture-child-crash-write-root";
const crashManifest = childExecutionBuildManifest;
const crashCommon = { version: 1, label: "Synthetic child write crash", icon: "ShieldCheck" as const,
  category: "operations" as const, input, canonicalInput: defineCanonicalInput(input, input, [{ eid: WRITE_FIXTURE_EID }]),
  inputSubject: "eid" as const, surface: { shape: "single" as const }, enqueue: "reject-active" as const,
  actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], identity: { matchKey: (value: z.output<typeof input>) => `eid:${value.eid}` },
  presentation: { title: () => "Synthetic child write crash" }, scenarios: ["write-fixture/happy"] as const,
  role: defineWorkflowRole({ kind: "standalone" }) };
export const childCrashWrite = compileWorkflow(defineWorkflow({ ...crashCommon, id: crashChildId, code: "fcx",
  steps: ({ transaction, result }) => {
    const write = transaction({ id: "write", label: "Write", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [], {
      prepareBind: ({ input }) => input, commitBind: ({ input }) => input,
    });
    return { steps: [[{ key: "write", label: "Write" }, [write]]],
      result: result(output, [write], ({ outputs }) => outputs.write.output) };
  } }), { manifest: crashManifest });
export const childCrashWriteRoot = compileWorkflow(defineWorkflow({ ...crashCommon, id: crashRootId, code: "fcq",
  steps: ({ delegate, result }) => {
    const child = delegate({ id: "write", target: { id: childCrashWrite.descriptor.id, input, result: output }, edgeId: "write",
      cardinality: "one", await: "terminal", join: "one", policy: { cascadeCancel: "cascade", onChildFailed: "fail-parent",
        afterChildRetry: "resume-parent", visibility: "inline" } }, [],
    { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "write", label: "Write child" }, [child]]], result: result(output, [child], ({ outputs }) => {
      if (outputs.write.state !== "done") throw new Error("write-child-not-done");
      return outputs.write.output;
    }, [{ path: "transactionId", source: { kind: "child-output", entryId: "write", path: "transactionId" } }]) };
  } }), { manifest: crashManifest });

export function childCrashWriteModules(world: WriteFixtureWorld) {
  const stores = buildWriteFixtureRegistry(world);
  return { stores, modules: [childCrashWrite, childCrashWriteRoot].map(compiled => composeWorkflowModule(compiled, stores.stores)) };
}


export const childPrerequisiteRoot = compileWorkflow(defineWorkflow({ ...crashCommon,
  id: "fixture-child-prerequisites-root", code: "fcp", input: Plan1Input, canonicalInput: Plan1CanonicalInput,
  identity: { matchKey: value => value.emplId },
  steps: ({ task, transaction, delegate, result }) => {
    const observe = task({ id: "observe", contract: plan1Contract, replay: "checkpoint" }, [], ({ input }) => input);
    const write = transaction({ id: "write", label: "Write", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [observe], {
      prepareBind: ({ input }) => ({ eid: input.emplId }), commitBind: ({ input }) => ({ eid: input.emplId }),
    });
    const child = delegate({ id: "child", target: { id: plan1Leaf.descriptor.id, input: Plan1Input, result: Plan1Output }, edgeId: "child",
      cardinality: "one", await: "terminal", join: "one", policy: { cascadeCancel: "cascade", onChildFailed: "fail-parent",
        afterChildRetry: "resume-parent", visibility: "inline" } }, [observe, write],
    { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    return { steps: [[{ key: "observe", label: "Observe" }, [observe]], [{ key: "write", label: "Write" }, [write]],
      [{ key: "child", label: "Child" }, [child]]], result: result(Plan1Output, [child], ({ outputs }) => {
      if (outputs.child.state !== "done") throw new Error("child-not-done");
      return outputs.child.output;
    }, [
      { path: "eid", source: { kind: "child-output", entryId: "child", path: "eid" } },
      { path: "disposition", source: { kind: "child-output", entryId: "child", path: "disposition" } },
      { path: "providerState", source: { kind: "child-output", entryId: "child", path: "providerState" } },
    ]) };
  } }), { manifest: childExecutionBuildManifest });

export const childReadPreviewRoot = compileWorkflow(defineWorkflow({ ...crashCommon,
  id: "fixture-child-read-preview-root", code: "fcrp", input: Plan1Input, canonicalInput: Plan1CanonicalInput,
  identity: { matchKey: value => value.emplId }, steps: ({ delegate, transaction, result }) => {
    const lookup = delegate({ id: "lookup", target: { id: childExecutionNested.descriptor.id, input: Plan1Input, result: Plan1Output },
      edgeId: "lookup", cardinality: "one", await: "terminal", join: "one", policy: { cascadeCancel: "cascade", onChildFailed: "fail-parent",
        afterChildRetry: "resume-parent", visibility: "inline" } }, [],
    { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    const write = transaction({ id: "write", label: "Write", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [lookup], {
      prepareBind: ({ outputs }) => { if (outputs.lookup.state !== "done") throw new Error("lookup-not-done"); return { eid: outputs.lookup.output.eid }; },
      commitBind: ({ outputs }) => { if (outputs.lookup.state !== "done") throw new Error("lookup-not-done"); return { eid: outputs.lookup.output.eid }; },
    });
    return { steps: [[{ key: "lookup", label: "Lookup" }, [lookup]], [{ key: "write", label: "Write" }, [write]]],
      result: result(Plan1Input, [], ({ input }) => input) };
  } }), { manifest: childExecutionBuildManifest });

export const childGateResumeRoot = compileWorkflow(defineWorkflow({ ...crashCommon,
  id: "fixture-child-gate-resume-root", code: "fcgr", input: Plan1Input, canonicalInput: Plan1CanonicalInput,
  identity: { matchKey: value => value.emplId }, steps: ({ delegate, gate, transaction, result }) => {
    const lookup = delegate({ id: "lookup", target: { id: plan1Leaf.descriptor.id, input: Plan1Input, result: Plan1Output },
      edgeId: "lookup", cardinality: "one", await: "terminal", join: "one", policy: { cascadeCancel: "cascade", onChildFailed: "fail-parent",
        afterChildRetry: "resume-parent", visibility: "inline" } }, [],
    { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    const review = gate({ id: "review", label: "Review", statusKey: "awaitingReview", result: z.strictObject({ approved: z.boolean() }) }, []);
    const write = transaction({ id: "write", label: "Write", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [lookup, review], {
      prepareBind: ({ outputs }) => { if (outputs.lookup.state !== "done") throw new Error("lookup-not-done"); return { eid: outputs.lookup.output.eid }; },
      commitBind: ({ outputs }) => { if (outputs.lookup.state !== "done") throw new Error("lookup-not-done"); return { eid: outputs.lookup.output.eid }; },
    });
    return { steps: [[{ key: "lookup", label: "Lookup" }, [lookup]], [{ key: "review", label: "Review" }, [review]], [{ key: "write", label: "Write" }, [write]]],
      result: result(output, [write], ({ outputs }) => outputs.write.output) };
  } }), { manifest: childExecutionBuildManifest });

export const childUnsupportedPreviewTarget = compileWorkflow(defineWorkflow({ ...crashCommon,
  id: "fixture-child-unsupported-preview-target", code: "fcut", steps: ({ transaction, result }) => {
    const write = transaction({ id: "write", label: "Write", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "unsupported", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [], {
      prepareBind: ({ input }) => input, commitBind: ({ input }) => input,
    });
    return { steps: [[{ key: "write", label: "Write" }, [write]]], result: result(output, [write], ({ outputs }) => outputs.write.output) };
  } }), { manifest: childExecutionBuildManifest });

export const childUnsupportedPreviewRoot = compileWorkflow(defineWorkflow({ ...crashCommon,
  id: "fixture-child-unsupported-preview-root", code: "fcur", input: Plan1Input, canonicalInput: Plan1CanonicalInput,
  identity: { matchKey: value => value.emplId }, steps: ({ delegate, transaction, result }) => {
    const child = delegate({ id: "child", target: { id: childUnsupportedPreviewTarget.descriptor.id, input, result: output },
      edgeId: "child", cardinality: "one", await: "terminal", join: "one", policy: { cascadeCancel: "cascade", onChildFailed: "fail-parent",
        afterChildRetry: "resume-parent", visibility: "inline" } }, [],
    { bind: ({ input }) => ({ eid: input.emplId }), deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    const write = transaction({ id: "write", label: "Write", prepare: WriteFixturePrepare, commit: WriteFixtureCommit,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000 }, [child], {
      prepareBind: ({ input }) => ({ eid: input.emplId }), commitBind: ({ input }) => ({ eid: input.emplId }),
    });
    return { steps: [[{ key: "child", label: "Child" }, [child]], [{ key: "write", label: "Write" }, [write]]],
      result: result(Plan1Input, [], ({ input }) => input) };
  } }), { manifest: childExecutionBuildManifest });

export function childPrerequisiteModules(world: WriteFixtureWorld) {
  const write = buildWriteFixtureRegistry(world);
  const stores = defineTaskStoreRegistry([...plan1Stores.stores, ...write.stores], {
    scenarioIds: [...new Set([...plan1Stores.corpus.scenarioIds, ...write.corpus.scenarioIds])],
    tasks: [...plan1Stores.stores, ...write.stores].flatMap(store => Object.values(store.tasks))
      .map(({ contract }) => ({ id: contract.id, effect: contract.effect })),
  });
  return { stores, modules: [composeWorkflowModule(childPrerequisiteRoot, stores.stores), composeWorkflowModule(plan1Leaf, stores.stores),
    composeWorkflowModule(childExecutionNested, stores.stores), composeWorkflowModule(childReadPreviewRoot, stores.stores), composeWorkflowModule(childGateResumeRoot, stores.stores),
    composeWorkflowModule(childUnsupportedPreviewTarget, stores.stores), composeWorkflowModule(childUnsupportedPreviewRoot, stores.stores)] };
}

export const parallelChildWriteRecoveryRoot = compileWorkflow(defineWorkflow({ ...crashCommon, id: "fixture-parallel-child-write-recovery", code: "fpw",
  steps: ({ delegate, parallel, result }) => {
    const policy = { cascadeCancel: "cascade", onChildFailed: "fail-parent", afterChildRetry: "resume-parent", visibility: "inline" } as const;
    const read = delegate({ id: "read", target: { id: plan1Leaf.descriptor.id, input: Plan1Input, result: Plan1Output }, edgeId: "read",
      cardinality: "one", await: "terminal", join: "one", policy }, [],
    { bind: ({ input }) => ({ emplId: input.eid, text: "parallel read", mode: "ok" as const }), deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    const write = delegate({ id: "write", target: { id: childCrashWrite.descriptor.id, input, result: output }, edgeId: "write",
      cardinality: "one", await: "terminal", join: "one", policy }, [],
    { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
    const children = parallel({ id: "children", join: "all", failure: "fail-fast" }, [{ id: "read", leaves: [read] }, { id: "write", leaves: [write] }]);
    return { steps: [[{ key: "children", label: "Children" }, [children]]], result: result(input, [], ({ input }) => input) };
  } }), { manifest: childExecutionBuildManifest });
