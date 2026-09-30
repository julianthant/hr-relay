import { WriteFixturePrepare, WriteFixtureCommit, writeFixtureMemoDescriptor, WRITE_FIXTURE_NODE_ID } from "../../fixtures/write-sequencer-fixtures.js";
import { z } from "zod";
import { EidSchema } from "../../../src/domain/ids.js";
import { defineCanonicalInput } from "../../../src/domain/workflow/canonical-input.js";
import { defineTaskContract } from "../../../src/domain/contracts/base.js";
import { defineTaskStoreRegistry } from "../../../src/base/store.js";
import { flow } from "../../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../../src/base/workflow.js";
import type { RerunValueMappingSpec } from "../../../src/domain/workflow/rerun-values.js";
import type { RerunValuesDependencies } from "../../../src/services/start/rerun-values.js";
import { sourceBoundHarness } from "../../fixtures/source-bound-fixtures.js";
import { sourceBoundReadContract as contract, sourceBoundReadDescriptor as original, sourceBoundReadStores } from "../../fixtures/source-bound-read-fixtures.js";

export const eidMapping = { nodeId: "read", fieldPath: "eid", label: "Employee ID", targetFieldPath: "eid" };
export function mappedReadDescriptor(mappings: readonly RerunValueMappingSpec[] = [eidMapping]) {
  return defineWorkflowDescriptor({ id: original.id, version: original.version, contractFingerprint: original.contractFingerprint,
    code: original.code, label: original.label, icon: original.icon, category: original.category,
    canonicalInput: original.canonicalInput, inputSubject: "eid", surface: original.surface, enqueue: original.enqueue,
    actions: original.actions, surfaces: {}, details: [], identity: { matchKey: (input) => input.eid },
    presentation: { title: (input) => input.eid }, scenarios: ["source-read/happy"], rerunValues: mappings,
    flow: flow(contract.input).step("read", contract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
      .build({ schema: contract.output, dependsOn: ["read"], derive: ({ outputs }) => outputs.read }),
  });
}
export function rerunValuesHarness() { return sourceBoundHarness(mappedReadDescriptor(), sourceBoundReadStores); }
export function rerunValuesDeps(h: ReturnType<typeof sourceBoundHarness>): RerunValuesDependencies {
  return { reader: h.lifecycle, database: h.database, descriptors: { resolve: () => h.descriptor } };
}

/** Descriptor and authority fixture for retained partial source evidence. */
export function valueShapeHarness() {
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
  // Historical checkpoint fixture: no runtime implementation or external session is available.
  return sourceBoundHarness(descriptor, () => defineTaskStoreRegistry([], { scenarioIds: [], tasks: [] }));
}

export function mappedTransactionHarness() {
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
  return sourceBoundHarness(descriptor);
}
