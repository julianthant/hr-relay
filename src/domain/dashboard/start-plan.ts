/**
 * The start-plan wire (ref frontend-backend-integration §3.4): ONE owner for what the
 * browser sends to `POST /api/v1/start-plans`, what the server admits, and
 * what it answers. Before 2026-09-03 the client and the server each declared
 * their own copy — the client's with generic strings and `unknown[]`
 * submissions, "mirroring" a server shape it could drift from silently.
 *
 * Three schemas, one shape:
 *
 * - `StartPlanRequestSchema` — what a browser AUTHORS. Every leaf the operator
 *   chose is explicit; there are no defaults here, because a default in the
 *   client would let a surface omit a choice the server then fills in as if
 *   the operator had made it.
 * - `StartPlanIngressSchema` — what the server ADMITS: the same leaves, with
 *   the server-owned defaults for historical/programmatic callers. Defaults
 *   live only at this ingress boundary.
 * - `StartPlanWireSchema` — the answer. It never echoes `rawInput` or D307
 *   omission FACTS back (a step form can hold an employee id or a date about
 *   a real person); only the omitted step KEYS ride the wire.
 *
 * Browser-bundle-safe on purpose: zod and src/domain/** only.
 */
import { RerunSourceSchema, PublicRerunPlanSchema } from "../run/rerun.js";
import { z } from "zod";
import { JsonValueSchema } from "../canonical-json.js";
import {
  ActorIdSchema,
  ConfigSnapshotIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  StartPlanIdSchema,
  WorkflowIdSchema,
} from "../ids.js";
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
  /**
   * D307 — typed facts for each omitted step. The schema proves the SHAPE; the
   * descriptor's own forms and cascade prove the content, in
   * `resolveStartStepOmissions`, before a plan row exists. A request carrying
   * omissions without an explicit `selectedStepKeys` is refused there: which
   * steps run is the operator's statement, and facts without it would be
   * omissions for steps nobody said were omitted.
   */
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
  /** D307 — the omitted step KEYS, in timeline order, and never the facts. */
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
