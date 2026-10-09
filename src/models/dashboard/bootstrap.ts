import { z } from "zod";
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
import { InputRunSurfaceSchema } from "../workflow/ingress.js";
import { WorkflowModuleRoleSchema } from "../../workflow-kit/validation/module-role.js";
import { PreflightCheckIdSchema } from "../preflight/preflight-contract.js";
import { EnqueuePolicySchema, WorkflowCodeSchema } from "../workflow/presentation.js";
import { StepOmissionFormSchema } from "../workflow/step-omission.js";
import {
  AppVersionSchema,
  DashboardWireVersionSchema,
  FeatureAvailabilityWireSchema,
  ProjectionGenerationSchema,
  RevisionSchema,
} from "./primitives.js";

export const ActorWireSchema = LocalOperatorActorSchema;
export const ServerClockWireSchema = z.strictObject({
  now: IsoInstantSchema,
  zone: ActivityTimeZoneSchema,
});
/** Store failure throws; no reduced handle can report an intermediate availability. */
export const StorageHealthSummaryWireSchema = z.strictObject({
  authority: z.enum(["healthy", "unavailable"]),
  backup: z.enum(["current", "stale", "missing"]),
  checkedAt: IsoInstantSchema,
});

/** Serve descriptor codes and raw category/role facts; the frontend owns presentation. */
/** The Run Modal's start facts for ONE workflow, SERVED from the same descriptor the daemon plans with: strict, and only what the modal reads. */
const StepKeySchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const WorkflowStartWireSchema = z.strictObject({
  summary: z.string().min(1).optional(),
  enqueue: EnqueuePolicySchema,
  version: PositiveIntSchema,
  inputRun: InputRunSurfaceSchema.optional(),
  spreadsheetIntake: z.boolean(),
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
        forces: z.array(StepKeySchema),
      }),
      z.strictObject({ state: z.literal("required"), reason: z.string().min(1) }),
    ]),
  })).min(1),
});
export type WorkflowStartWire = z.infer<typeof WorkflowStartWireSchema>;

export const WorkflowBootstrapPrimitiveSchema = z.strictObject({
  id: WorkflowIdSchema,
  code: WorkflowCodeSchema,
  label: z.string().min(1),
  categoryId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  descriptorFingerprint: FingerprintSchema,
  availability: CapabilityAvailabilitySchema,
  role: WorkflowModuleRoleSchema,
  start: WorkflowStartWireSchema,
});
export const SystemInstancePrimitiveSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  prod: z.literal("available"),
  test: CapabilityAvailabilitySchema,
});
export const SettingsSectionPrimitiveSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  revision: RevisionSchema,
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
  readonly systemInstance: z.ZodType;
  readonly settingsSection: z.ZodType;
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
    storage: StorageHealthSummaryWireSchema,
    workflows: z.array(parts.workflow),
    systemInstances: z.array(parts.systemInstance),
    settingsSections: z.array(parts.settingsSection),
    featureAvailability: z.array(FeatureAvailabilityWireSchema),
    // Optional permits older producers; current composition must supply the strict report.
    preflight: z.array(PreflightCheckWireSchema).optional(),
  });
}

export const FrontendBootstrapWireSchema = createFrontendBootstrapWireSchema({
  workflow: WorkflowBootstrapPrimitiveSchema,
  systemInstance: SystemInstancePrimitiveSchema,
  settingsSection: SettingsSectionPrimitiveSchema,
}).superRefine((bootstrap, context) => {
  const workflows = z.array(WorkflowBootstrapPrimitiveSchema).parse(bootstrap.workflows);
  const systemInstances = z.array(SystemInstancePrimitiveSchema).parse(bootstrap.systemInstances);
  const settingsSections = z.array(SettingsSectionPrimitiveSchema).parse(bootstrap.settingsSections);
  const identities = [
    ["workflows", workflows.map(({ id }) => id)],
    ["systemInstances", systemInstances.map(({ system }) => system)],
    ["settingsSections", settingsSections.map(({ id }) => id)],
    ["featureAvailability", bootstrap.featureAvailability.map(({ feature }) => feature)],
  ] as const;
  for (const [path, values] of identities) {
    if (new Set(values).size !== values.length) {
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
