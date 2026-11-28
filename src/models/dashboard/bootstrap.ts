import { WorkbookCheckRequirementSchema, WorkbookFieldRequirementSchema, WorkbookRequirementDeclarationSchema } from "./workbook-library.js";
import { z } from "zod";
import { StorageAuthoritySummarySchema } from "../storage/storage-status.js";
import { ActivityTimeZoneSchema } from "./activity-volume.js";
import { CapabilityAvailabilitySchema } from "../../rules/validation/absence.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  LocalOperatorActorSchema,
  PositiveIntSchema,
  WorkflowIdSchema,
} from "../../rules/identity/ids.js";
import { InputRunSurfaceSchema, UploadRunSurfaceSchema } from "../workflow/ingress.js";
import { WorkflowModuleRoleSchema } from "../../workflow-kit/validation/module-role.js";
import { PreflightCheckIdSchema } from "../preflight/preflight-contract.js";
import { EnqueuePolicySchema, IconNameSchema, WorkflowCodeSchema } from "../workflow/presentation.js";
import {
  StartRowKindSchema,
  StartRowLockReasonSchema,
  StartRowOffSchema,
  StartRowMemberSchema,
  StartRowTargetSchema,
  StepOmissionFormSchema,
} from "../workflow/step-omission.js";
import {
  AppVersionSchema,
  DashboardWireVersionSchema,
  FeatureAvailabilityWireSchema,
  ProjectionGenerationSchema,
} from "./primitives.js";

export const ActorWireSchema = LocalOperatorActorSchema;
export const ServerClockWireSchema = z.strictObject({
  now: IsoInstantSchema,
  zone: ActivityTimeZoneSchema,
});

/** Serve descriptor codes and raw category/role facts; the frontend owns presentation. */
/** The Run Modal's start facts for ONE workflow, SERVED from the same descriptor the daemon plans with: strict, and only what the modal reads. */
const StepKeySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/** Source readiness is a selection fact, never a global workbook default. */
export const WorkflowStartReadinessSchema = z.discriminatedUnion("state", [
  z.strictObject({ scope: z.literal("workbook-sources"), state: z.literal("ready") }),
  z.strictObject({ scope: z.literal("workbook-sources"), state: z.literal("selection-needed"),
    fixAction: z.strictObject({ kind: z.literal("choose-workbook-sources"), workflowId: WorkflowIdSchema }) }),
  z.strictObject({ scope: z.literal("workbook-sources"), state: z.literal("unavailable"), reason: z.string().min(1),
    reasonCode: z.enum(["WORKBOOK_LIBRARY_EMPTY", "WORKBOOK_FIELDS_MISSING", "WORKBOOK_FIELDS_DUPLICATE"]),
    fixAction: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("import-workbook"), workflowId: WorkflowIdSchema }),
      z.strictObject({ kind: z.literal("review-workbook-fields"), workflowId: WorkflowIdSchema,
        requiredFields: WorkbookRequirementDeclarationSchema.shape.requiredWorkbookFields }),
    ]) }),
]);
export type WorkflowStartReadiness = z.infer<typeof WorkflowStartReadinessSchema>;

export const WorkflowStartWireSchema = z.strictObject({
  readiness: WorkflowStartReadinessSchema,
  summary: z.string().min(1).optional(),
  enqueue: EnqueuePolicySchema,
  version: PositiveIntSchema,
  inputRun: InputRunSurfaceSchema.optional(),
  uploadRun: UploadRunSurfaceSchema.optional(),
  spreadsheetIntake: z.boolean(),
  requiredWorkbookFields: z.array(z.string().min(1)).refine(ids => new Set(ids).size === ids.length),
  workbookReference: WorkbookFieldRequirementSchema.optional(),
  /** The optional second check: the launcher lists every sheet that maps its key field, and a start may pick none. */
  workbookCheck: WorkbookCheckRequirementSchema.optional(),
  steps: z.array(z.strictObject({
    key: StepKeySchema,
    label: z.string().min(1),
    includedByDefault: z.boolean(),
    systems: z.array(BrowserSystemIdSchema).optional(),
          /* The step's ONE way not to run, as a closed union; `omittable` carries the step folder's declared FORM. */
    control: z.discriminatedUnion("state", [
      z.strictObject({ state: z.literal("selectable"), inputField: z.string().min(1) }),
      z.strictObject({
        state: z.literal("omittable"),
        form: StepOmissionFormSchema,
        stop: z.string().min(1).optional(),
        forces: z.array(StepKeySchema),
      }),
      z.strictObject({ state: z.literal("required"), reason: z.string().min(1) }),
    ]),
  })).min(1),
  /** The rows Start run shows: kind, lock reason, members and the step a switch addresses. The backend always serves it. */
  rows: z.array(z.strictObject({
    key: StepKeySchema,
    label: z.string().min(1),
    includedByDefault: z.boolean(),
    kind: StartRowKindSchema,
    off: StartRowOffSchema.optional(),
    stop: z.string().min(1).optional(),
    requiresStep: StepKeySchema.optional(),
    startWithValuesAlone: z.literal(true).optional(),
    lockReason: StartRowLockReasonSchema.optional(),
    members: z.array(StartRowMemberSchema).min(1),
    target: StartRowTargetSchema.optional(),
    manual: z.strictObject({ form: StepOmissionFormSchema, forces: z.array(StepKeySchema) }).optional(),
    selection: z.strictObject({ inputField: z.string().min(1) }).optional(),
  })).min(1).optional(),
}).superRefine((start, context) => {
  const checked = WorkbookRequirementDeclarationSchema.safeParse({
    requiredWorkbookFields: start.requiredWorkbookFields,
    ...(start.workbookReference === undefined ? {} : { workbookReference: start.workbookReference }),
    ...(start.workbookCheck === undefined ? {} : { workbookCheck: start.workbookCheck }),
  });
  if (!checked.success) context.addIssue({ code: "custom", message: "invalid workflow workbook requirement" });
});
export type WorkflowStartWire = z.infer<typeof WorkflowStartWireSchema>;

export const WorkflowBootstrapPrimitiveSchema = z.strictObject({
  id: WorkflowIdSchema,
  code: WorkflowCodeSchema,
  label: z.string().min(1),
  icon: IconNameSchema,
  categoryId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  descriptorFingerprint: FingerprintSchema,
  availability: CapabilityAvailabilitySchema,
  role: WorkflowModuleRoleSchema,
  start: WorkflowStartWireSchema,
});
export const PreflightVerdictSchema = z.enum(["pass", "warning", "fail"]);

/** ONE doctor check, as the Top Bar's standing indicator reads it. */
export const PreflightCheckWireSchema = z.strictObject({
  id: PreflightCheckIdSchema,
  label: z.string().min(1),
  verdict: PreflightVerdictSchema,
  detail: z.string().min(1),
  blocks: z.array(z.string().min(1)),
  remediation: z.string().min(1).optional(),
  checkedAt: IsoInstantSchema,
});

interface BootstrapParts {
  readonly workflow: z.ZodType;
}

/** Composes the stable bootstrap shell with closed owner-provided projections as later slices land. */
export function createFrontendBootstrapWireSchema(parts: BootstrapParts) {
  return z.strictObject({
    wireVersion: DashboardWireVersionSchema,
    appVersion: AppVersionSchema,
    descriptorHash: FingerprintSchema,
    settingsSchemaHash: FingerprintSchema,
    protectedSchemaHash: FingerprintSchema,
    projectionGeneration: ProjectionGenerationSchema,
    actor: ActorWireSchema,
    serverClock: ServerClockWireSchema,
    storage: StorageAuthoritySummarySchema,
    workflows: z.array(parts.workflow),
    featureAvailability: z.array(FeatureAvailabilityWireSchema).min(1).optional(),
    // Optional permits older producers; current composition must supply the strict report.
    preflight: z.array(PreflightCheckWireSchema).optional(),
  });
}

export const FrontendBootstrapWireSchema = createFrontendBootstrapWireSchema({
  workflow: WorkflowBootstrapPrimitiveSchema,
}).superRefine((bootstrap, context) => {
  const workflows = z.array(WorkflowBootstrapPrimitiveSchema).parse(bootstrap.workflows);
  const identities = [
    ["workflows", workflows.map(({ id }) => id)],
    ["featureAvailability", (bootstrap.featureAvailability ?? []).map(({ feature }) => feature)],
  ] as const;
  for (const [path, values] of identities) {
    if (new Set<string>(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [path], message: `${path} identities must be unique` });
    }
  }
    /* A harness's `of` must name a composition IN THIS DOCUMENT; the composition root already refuses a dangling or non-composition target. */
  const compositions = new Set(
    workflows.filter(({ role }) => role.kind === "composition").map(({ id }) => String(id)),
  );
  for (const [index, workflow] of workflows.entries()) {
    if (workflow.role.kind !== "chunk-harness") continue;
    if (compositions.has(String(workflow.role.of))) continue;
    context.addIssue({
      code: "custom",
      path: ["workflows", index, "role", "of"],
      message: `${String(workflow.id)} is served as a chunk harness of ${String(workflow.role.of)}, `
        + "which this document does not carry as a composition",
    });
  }
});

export type FrontendBootstrapWire = z.infer<typeof FrontendBootstrapWireSchema>;
