/** Workflow capabilities are descriptor facts; system-host facts carry explicit test availability. */
import { z } from "zod";
import {
  BrowserSystemIdSchema,
  NodeIdSchema,
  NonNegativeIntSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";

/** The system-host section wire identity. */
export const SETTINGS_SYSTEM_HOSTS_SECTION_ID = "system-hosts";
export const SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID = "workflow-capabilities";

/** Explicit test-host availability states. */
export const SystemHostTestWireSchema = z.union([
  z.strictObject({ state: z.literal("not-provisioned") }),
  z.strictObject({ state: z.literal("not-distinct") }),
  z.strictObject({ state: z.literal("provisioned"), url: z.url() }),
]);
export type SystemHostTestWire = z.infer<typeof SystemHostTestWireSchema>;

/** Each system has its production entry and test availability. */
export const SystemHostWireSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  production: z.url(),
  test: SystemHostTestWireSchema,
});
export type SystemHostWire = z.infer<typeof SystemHostWireSchema>;

/** Whole-workflow preview support and its first preparation boundary. */
export const DryRunPostureWireSchema = z.union([
  z.strictObject({ state: z.literal("supported"), firstTransactionNodeId: NodeIdSchema }),
  z.strictObject({ state: z.literal("unsupported"), reason: z.literal("no-transaction-node") }),
  z.strictObject({
    state: z.literal("unsupported"),
    reason: z.literal("node-declares-unsupported"),
    nodeId: NodeIdSchema,
  }),
]);
export type DryRunPostureWire = z.infer<typeof DryRunPostureWireSchema>;

/** The Edit Data posture as the descriptor declares it; `read-only` is the default and means the Context rail offers no correction at all. */
export const EditDataPostureWireSchema = z.union([
  z.strictObject({ state: z.literal("read-only") }),
  z.strictObject({ state: z.literal("declared"), editableFields: NonNegativeIntSchema }),
]);
export type EditDataPostureWire = z.infer<typeof EditDataPostureWireSchema>;

/** ONE workflow's descriptor-derived capabilities: the vocabulary is exactly what a registered descriptor DECLARES, and nothing more. */
export const WorkflowCapabilityRowWireSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  dryRun: DryRunPostureWireSchema,
  /** The typed-input door — `surfaces.inputRun` is declared. */
  typedStart: z.boolean(),
  /** `capabilities.review` — a Review panel exists for this workflow's rows. */
  reviewPanel: z.boolean(),
  editData: EditDataPostureWireSchema,
  /** The gate nodes an OPERATOR resolves; `children-terminal` / `external` gates are not operator work. */
  operatorGates: z.array(NodeIdSchema),
  /** Browser systems only — service and `workflow:<id>` stores contribute none. */
  browserSystems: z.array(BrowserSystemIdSchema),
});
export type WorkflowCapabilityRowWire = z.infer<typeof WorkflowCapabilityRowWireSchema>;

export const SettingsFactsWireSchema = z.strictObject({
    /* `.min(1)` because the system list is a CLOSED enum and every one of them has a production entry in the config defaults — a deployment cannot provision zero. */
  systemHosts: z.array(SystemHostWireSchema).min(1),
    /* NOT `.min(1)`: a composition that registers no workflow is a real build, and the surface draws that absence by name. */
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
