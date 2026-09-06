import { z } from "zod";
import { flow } from "../../../src/base/flow.js";
import { defineWorkflowDescriptor } from "../../../src/base/workflow.js";
import { defineServiceStore, defineTaskStoreRegistry } from "../../../src/base/store.js";
import { defineTask } from "../../../src/base/task.js";
import { defineTaskContract } from "../../../src/domain/contracts/base.js";
import { EidSchema, ScenarioIdSchema, taskId } from "../../../src/domain/ids.js";
import { defineCanonicalInput } from "../../../src/domain/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../src/domain/workflow/presentation.js";
import type { WriteFixtureWorld } from "./write-sequencer-fixtures.js";

const Input = z.strictObject({ eid: EidSchema, memo: z.string().optional() });
const Output = z.strictObject({ eid: EidSchema });
const scenario = ScenarioIdSchema.parse("ocr/capability-wiring-happy");
export const sourceBoundReadContract = defineTaskContract({ id: taskId("ocr/extract-form-page"), title: "Read submitted memo", effect: "read",
  input: Input, output: Output, errorCodes: ["provider-unavailable"], subject: { kind: "none", reason: "synthetic read-only source proof" },
  scenarios: [scenario], freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "live" }, example: { eid: "10812345" } });
export const sourceBoundReadDescriptor = defineWorkflowDescriptor({ id: "source-read", version: 1,
  contractFingerprint: "a".repeat(64), code: "sr", label: "Source read", icon: "Search", category: "operations",
  canonicalInput: defineCanonicalInput(Input, z.strictObject({ eid: EidSchema, memo: z.string().optional() }), [{ eid: "10812345" }]),
  inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  surfaces: {}, details: [], identity: { matchKey: (input) => input.eid }, presentation: { title: (input) => input.eid },
  scenarios: ["source-read/happy"],
  flow: flow(Input).step("read", sourceBoundReadContract, { dependsOn: [], replay: "checkpoint", bind: ({ input }) => input })
    .build({ schema: Output, dependsOn: ["read"], derive: ({ outputs }) => outputs.read }),
});
export function sourceBoundReadStores(world: WriteFixtureWorld) {
  const task = defineTask(sourceBoundReadContract, { sessions: [], async run({ input, ctx }) {
    ctx.recordData({ direction: "read", field: "eid", value: input.eid });
    world.events.push(`read:${input.memo ?? "absent"}`); return { eid: input.eid };
  } });
  return defineTaskStoreRegistry([defineServiceStore("ocr", { read: task })], {
    scenarioIds: [scenario], tasks: [{ id: sourceBoundReadContract.id, effect: sourceBoundReadContract.effect }],
  });
}
