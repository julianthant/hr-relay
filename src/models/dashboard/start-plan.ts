/** The start-plan wire: ONE owner for what the browser sends, what the server admits and what it answers — three schemas, one shape, browser-bundle-safe on purpose. */
import { RerunSourceSchema, PublicRerunPlanSchema } from "../run/rerun.js";
import { StartSupersedeTargetsSchema } from "../run/start-supersede.js";
import { z } from "zod";
import { JsonValueSchema } from "../../rules/validation/canonical-json.js";
import {
  ActorIdSchema,
  ConfigSnapshotIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  StartPlanIdSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import { BrowserPresentationModeSchema, InstanceSelectionSchema, RunPrioritySchema } from "../run/envelope.js";
import { StartRefusalCodeSchema } from "../run/start-refusal.js";
import { TimelineCategoryKeySchema } from "../workflow/presentation.js";
import { StepOmissionsSchema } from "../workflow/step-omission.js";

/** The leaves both sides agree on verbatim. */
const SHARED_REQUEST_LEAVES = {
  workflowId: WorkflowIdSchema,
  rerunSource: RerunSourceSchema.optional(),
  warningAcknowledgment: FingerprintSchema.optional(),
  submissions: z.array(JsonValueSchema).min(1),
  dryRun: z.boolean(),
  /** The surface may request `bulk` explicitly; the server stamps the default. */
  priority: RunPrioritySchema.optional(),
  requestedInstance: InstanceSelectionSchema.optional(),
  selectedStepKeys: z.array(z.string().min(1)).min(1).optional(),
    /* Typed facts for each omitted step; a request carrying omissions without an explicit `selectedStepKeys` is refused, because which steps run is the operator's statement. */
  stepOmissions: StepOmissionsSchema.optional(),
} as const;

export const StartPlanRequestSchema = z.strictObject({
  ...SHARED_REQUEST_LEAVES,
  browserMode: BrowserPresentationModeSchema,
  captureBrowserScreenshots: z.boolean(),
});
export type StartPlanRequest = z.infer<typeof StartPlanRequestSchema>;

export const StartPlanIngressSchema = z.strictObject({
  ...SHARED_REQUEST_LEAVES,
  // Historical/programmatic request callers retain the established headless
  // default; every dashboard submission sends an explicit value.
  browserMode: BrowserPresentationModeSchema.default("headless"),
  captureBrowserScreenshots: z.boolean().default(false),
  /** Trusted server stamp; the surface may request `bulk` explicitly. */
  priority: RunPrioritySchema.default("interactive"),
});
export type StartPlanIngress = z.infer<typeof StartPlanIngressSchema>;

export const StartPlanWireSchema = z.strictObject({
  wireVersion: z.literal(1),
  startPlanId: StartPlanIdSchema,
  workflowId: WorkflowIdSchema,
  /** The CAS token the `start-run` command target carries. */
  expectedVersion: z.number().int().positive(),
  expiresAt: IsoInstantSchema,
  dryRun: z.boolean(),
  browserMode: BrowserPresentationModeSchema.optional(),
  captureBrowserScreenshots: z.boolean().optional(),
  /** The omitted step KEYS, in timeline order, and never the facts. */
  omittedSteps: z.array(TimelineCategoryKeySchema).min(1).optional(),
  priority: RunPrioritySchema,
  plannedBy: ActorIdSchema,
  configSnapshotId: ConfigSnapshotIdSchema,
  /** Everything the `start-run` command payload must echo back, verbatim. */
  fingerprints: z.strictObject({
    descriptorFingerprint: FingerprintSchema,
    configFingerprint: FingerprintSchema,
    ingressSchemaHash: FingerprintSchema,
    canonicalInputSchemaHash: FingerprintSchema,
    inputFingerprint: FingerprintSchema,
  }),
  rerun: PublicRerunPlanSchema.optional(),
  planned: z.array(z.strictObject({
    supersedeTargets: StartSupersedeTargetsSchema.optional(),
    logicalKey: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string().min(1).optional(),
    matchKey: z.string().min(1),
  })),
  refused: z.array(z.strictObject({
    entry: z.number().int().positive(),
    code: StartRefusalCodeSchema,
    message: z.string().min(1),
  })),
});
export type StartPlanWire = z.infer<typeof StartPlanWireSchema>;
