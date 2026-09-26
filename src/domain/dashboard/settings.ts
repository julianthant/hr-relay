/** Workflow capabilities are live descriptor facts. The system-host arm is retained for wire compatibility; its test state is unavailable for new runs. */
import { z } from "zod";
import {
  BrowserSystemIdSchema,
  NodeIdSchema,
  NonNegativeIntSchema,
  WorkflowIdSchema,
} from "../ids.js";

/** The retired host id stays parseable for older facts wires. */
export const SETTINGS_SYSTEM_HOSTS_SECTION_ID = "system-hosts";
export const SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID = "workflow-capabilities";

/** Old wire states remain readable; current projections offer no test host. */
export const SystemHostTestWireSchema = z.union([
  z.strictObject({ state: z.literal("not-provisioned") }),
  z.strictObject({ state: z.literal("not-distinct") }),
  z.strictObject({ state: z.literal("provisioned"), url: z.url() }),
]);
export type SystemHostTestWire = z.infer<typeof SystemHostTestWireSchema>;

/** Production entry stays available in the compatibility projection. */
export const SystemHostWireSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  production: z.url(),
  test: SystemHostTestWireSchema,
});
export type SystemHostWire = z.infer<typeof SystemHostWireSchema>;

/**
 * Where a dry run stops, per workflow (SE41's *Where a dry run stops* table) —
 * the wire face of `base/workflow.ts`'s `WorkflowDryRunSupport` (D209).
 *
 * It is carried STRUCTURED, all three arms, because the three are exactly the
 * three cell shapes SE41 asks for and collapsing them is the defect the demo's
 * own note names: `no-transaction-node` is a decision ("this graph writes to no
 * system of record, so every run of it is already a rehearsal") and
 * `node-declares-unsupported` is a gap with a named offender, and an operator
 * plans differently depending on which it is.
 */
export const DryRunPostureWireSchema = z.union([
  z.strictObject({ state: z.literal("supported"), stopsAt: NodeIdSchema }),
  z.strictObject({ state: z.literal("unsupported"), reason: z.literal("no-transaction-node") }),
  z.strictObject({
    state: z.literal("unsupported"),
    reason: z.literal("node-declares-unsupported"),
    nodeId: NodeIdSchema,
  }),
]);
export type DryRunPostureWire = z.infer<typeof DryRunPostureWireSchema>;

/**
 * The Edit Data posture (ref data-intake-and-edit-data §6.2, D166), as the descriptor declares it.
 *
 * `read-only` is the default and means the Context rail offers no correction at
 * all. `declared` means the descriptor named the policy; `editableFields` is
 * `0` for the bare `true` form — which keeps the Data section visible with ZERO
 * editable paths — and the exact count for the `{ fields }` form. Zero is not
 * folded into `read-only`: "declared, and no path is correctable" and "never
 * declared" are different statements about the same screen.
 */
export const EditDataPostureWireSchema = z.union([
  z.strictObject({ state: z.literal("read-only") }),
  z.strictObject({ state: z.literal("declared"), editableFields: NonNegativeIntSchema }),
]);
export type EditDataPostureWire = z.infer<typeof EditDataPostureWireSchema>;

/**
 * ONE workflow's descriptor-derived capabilities (SE41).
 *
 * The vocabulary is exactly what a registered descriptor DECLARES, and no
 * larger. The demo's page carried sixteen capability columns; twelve of them
 * (roster, workers, presets, duplicate check, multi-file, merge,
 * sub-selections, member outcomes, delegation …) are not declarations anything
 * in this tree carries, and D274 item 4's rule for exactly this case is to build
 * the SERVED vocabulary and name the absence rather than invent a column. The
 * surface names it; this schema simply has no field for it.
 */
export const WorkflowCapabilityRowWireSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  dryRun: DryRunPostureWireSchema,
  /** D250's typed-input door — `surfaces.inputRun` is declared. */
  typedStart: z.boolean(),
  /** `capabilities.review` — a Review panel exists for this workflow's rows. */
  reviewPanel: z.boolean(),
  editData: EditDataPostureWireSchema,
  /** The gate nodes an OPERATOR resolves; `children-terminal` / `external` gates are not operator work. */
  operatorGates: z.array(NodeIdSchema),
  /** Browser systems only — service and `workflow:<id>` stores contribute none (D2/D15). */
  browserSystems: z.array(BrowserSystemIdSchema),
});
export type WorkflowCapabilityRowWire = z.infer<typeof WorkflowCapabilityRowWireSchema>;

export const SettingsFactsWireSchema = z.strictObject({
  /**
   * `.min(1)` because the system list is a CLOSED enum (`BrowserSystemIdSchema`)
   * and every one of them has a production entry in the config defaults — a
   * deployment cannot provision zero. So an empty array is not an empty state
   * the surface should draw, it is a producer that stopped working, and the
   * wire refuses it here rather than letting the page render a header row over
   * nothing and call that the truth.
   */
  systemHosts: z.array(SystemHostWireSchema).min(1),
  /**
   * NOT `.min(1)`: a composition that registers no workflow is a real (if
   * unusual) build, and the surface draws that absence by name.
   */
  workflowCapabilities: z.array(WorkflowCapabilityRowWireSchema),
}).superRefine((facts, context) => {
  const identities = [
    ["systemHosts", facts.systemHosts.map(({ system }) => String(system))],
    ["workflowCapabilities", facts.workflowCapabilities.map(({ workflowId }) => String(workflowId))],
  ] as const;
  for (const [path, values] of identities) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [path], message: `${path} identities must be unique` });
    }
  }
});
export type SettingsFactsWire = z.infer<typeof SettingsFactsWireSchema>;
