import { WriteFixturePrepare, WriteFixtureCommit, writeFixtureMemoDescriptor, WRITE_FIXTURE_NODE_ID } from "./write-sequencer-fixtures.js";
import { z } from "zod";
import { EidSchema } from "../../../src/rules/identity/ids.js";
import { defineCanonicalInput } from "../../../src/models/workflow/canonical-input.js";
import { defineTaskContract } from "../../../src/models/task/task-contract.js";
import { defineTaskStoreRegistry } from "../../../src/workflow-kit/task-registry.js";
import { flow } from "../../../src/workflow-kit/flow.js";
import { defineWorkflowDescriptor } from "../../../src/workflow-kit/workflow.js";
import type { RerunValueMappingSpec } from "../../../src/models/workflow/rerun-values.js";
import type { RerunValuesDependencies } from "../../../src/backend/runs/start/rerun-values.js";
import { sourceBoundHarness } from "./integration/source-bound-fixtures.js";
import { sourceBoundReadContract as contract, sourceBoundReadDescriptor as original, sourceBoundReadStores } from "./source-bound-read-fixtures.js";

export const eidMapping = { nodeId: "read", fieldPath: "eid", label: "Employee ID", targetFieldPath: "eid" };
export function mappedReadDescriptor(mappings: readonly RerunValueMappingSpec[] | undefined = undefined,
  current: { version?: number; contractFingerprint?: string; canonicalInput?: typeof original.canonicalInput; stepKey?: string; nodeId?: "read" | "current-read"; gate?: boolean } = {}) {
  const nodeId = current.nodeId ?? "read";
  const readFlow = () => flow(contract.input).step(nodeId, contract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input });
  const graphWithGate = readFlow().gate("approval", { dependsOn: [nodeId], label: "Approval", statusKey: "needsReview",
    resolvedBy: "operator", result: z.strictObject({ approved: z.boolean() }) })
    .build({ schema: contract.output, dependsOn: [nodeId], derive: ({ outputs }) => outputs[nodeId] });
  const graphWithoutGate = readFlow().build({ schema: contract.output, dependsOn: [nodeId], derive: ({ outputs }) => outputs[nodeId] });
  const descriptor = { id: original.id, version: current.version ?? original.version, contractFingerprint: current.contractFingerprint ?? original.contractFingerprint,
    code: original.code, label: original.label, icon: original.icon, category: original.category,
    canonicalInput: current.canonicalInput ?? original.canonicalInput, inputSubject: "eid", surface: original.surface, enqueue: original.enqueue,
    actions: original.actions, surfaces: {}, details: [], identity: { matchKey: (input: { eid: string }) => input.eid },
    presentation: { title: (input: { eid: string }) => input.eid }, scenarios: ["source-read/happy"], rerunValues: mappings ?? [{ ...eidMapping, nodeId }],
    timeline: [{ key: current.stepKey ?? "read", label: "Read", nodes: current.gate ? [nodeId, "approval"] : [nodeId] }],
  } as const;
  return current.gate
    ? defineWorkflowDescriptor({ ...descriptor, flow: graphWithGate })
    : defineWorkflowDescriptor({ ...descriptor, flow: graphWithoutGate });
}
export async function rerunValuesHarness() { return await sourceBoundHarness(mappedReadDescriptor(), sourceBoundReadStores); }
export function rerunValuesDeps(h: Awaited<ReturnType<typeof sourceBoundHarness>>): RerunValuesDependencies {
  return { reader: h.lifecycle, database: h.database, descriptors: { resolve: () => h.descriptor } };
}

/** Descriptor and authority fixture for retained partial source evidence. */
export async function valueShapeHarness() {
  const Input = z.strictObject({ eid: EidSchema, documentNumber: z.string().optional(), memo: z.string().optional() });
  const Output = z.strictObject({ eid: EidSchema, documentNumber: z.string().optional(), embedded: z.string(), missing: z.string().optional(), invalidEid: z.string() });
  const valueContract = defineTaskContract({ id: contract.id, title: "Read source values", effect: "read", input: Input, output: Output,
    errorCodes: ["provider-unavailable"], subject: { kind: "none", reason: "synthetic source value proof" },
    scenarios: contract.scenarios, freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
    provenance: { default: "live" }, example: { eid: "10812345", embedded: "safe", invalidEid: "invalid" } });
  const descriptor = defineWorkflowDescriptor({ id: "source-values", version: 1, contractFingerprint: original.contractFingerprint,
    code: "sv", label: "Source values", icon: original.icon, category: original.category,
    canonicalInput: defineCanonicalInput(Input, Input, [{ eid: "10812345" }]), inputSubject: "eid",
    surface: original.surface, enqueue: original.enqueue, actions: original.actions, surfaces: {}, details: [],
    identity: { matchKey: (input) => input.eid }, presentation: { title: (input) => input.eid }, scenarios: ["source-values/happy"],
    rerunValues: [eidMapping, ...["documentNumber", "embedded", "missing", "invalidEid"].map((fieldPath) =>
      ({ nodeId: "read", fieldPath, label: fieldPath, targetFieldPath: fieldPath === "invalidEid" ? "eid" : "memo" }))],
    flow: flow(Input).step("read", valueContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
      .step("later", valueContract, { dependsOn: ["read"], replay: "checkpoint", bind: ({ input }) => input })
      .build({ schema: Output, dependsOn: ["read"], derive: ({ outputs }) => outputs.read }),
  });

  return await sourceBoundHarness(descriptor, () => defineTaskStoreRegistry([], { scenarioIds: [], tasks: [] }));
}

export async function mappedTransactionHarness() {
  const prior = writeFixtureMemoDescriptor;
  const Input = z.strictObject({ eid: EidSchema, memo: z.string().optional() });
  const descriptor = defineWorkflowDescriptor({ id: prior.id, version: prior.version, contractFingerprint: prior.contractFingerprint,
    code: prior.code, label: prior.label, icon: prior.icon, category: prior.category,
    canonicalInput: defineCanonicalInput(Input, Input, [{ eid: "10812345" }]), inputSubject: "eid", surface: prior.surface,
    enqueue: prior.enqueue, actions: prior.actions, surfaces: {}, details: [],
    identity: { matchKey: (input) => `eid:${input.eid}` }, presentation: { title: (input) => input.eid }, scenarios: ["write-fixture/happy"],
    rerunValues: [{ nodeId: WRITE_FIXTURE_NODE_ID, fieldPath: "output.value.transactionId", label: "Transaction", targetFieldPath: "memo" }],
    flow: flow(Input).transaction(WRITE_FIXTURE_NODE_ID, { dependsOn: [],
      prepare: { uses: WriteFixturePrepare, bind: ({ input }) => ({ eid: input.eid }) },
      commit: { uses: WriteFixtureCommit, bind: ({ input }) => ({ eid: input.eid }) },
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 30_000,
    }).build({ schema: WriteFixtureCommit.output, dependsOn: [WRITE_FIXTURE_NODE_ID], derive: ({ outputs }) => outputs[WRITE_FIXTURE_NODE_ID].output }),
  });
  return await sourceBoundHarness(descriptor);
}
