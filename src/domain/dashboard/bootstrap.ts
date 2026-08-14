import { z } from "zod";
import { CapabilityAvailabilitySchema } from "../absence.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  LocalOperatorActorSchema,
  WorkflowIdSchema,
} from "../ids.js";
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
  zone: z.literal("America/Los_Angeles"),
});
/**
 * The at-rest storage indicator (doc 03 §2.5).
 *
 * `authority` HAD a third arm, `degraded`, and nothing could emit it — the
 * D181 shape, one level smaller. `buildBootstrap` decides this by calling
 * `authorityMeta()`, which either answers or throws, and the dashboard
 * composition opens the store with `AuthorityDatabase.open`, which throws
 * rather than returning a reduced handle. There is no third outcome to read.
 *
 * The tempting repair was to wire `AuthorityBootStore`, whose report carries a
 * `degraded-read-only` state — but that state holds NO database at all
 * (`authority-boot.ts`: the degraded constructor passes `undefined`, and only
 * `requireWritable` exists). Nothing durable can be read there either, which
 * is what this wire's `unavailable` already says. Emitting `degraded` from it
 * would have been a finer word for the same fact.
 *
 * Degradation is not lost, and it did not need this arm to be reported: the
 * storage DOCTOR (`domain/dashboard/storage.ts`) carries
 * `authority: { state: "degraded", cause }` with the closed cause code and its
 * one-line summary, which is strictly more than a bare word, and the Settings
 * surface already renders it. **What would bring the arm back** is a
 * composition that genuinely serves reads it cannot serve writes for — a
 * read-only dashboard over a `degraded-read-only` boot report. Add the arm in
 * the commit that adds that composition, never before it.
 */
export const StorageHealthSummaryWireSchema = z.strictObject({
  authority: z.enum(["healthy", "unavailable"]),
  backup: z.enum(["current", "stale", "missing"]),
  checkedAt: IsoInstantSchema,
});

export const WorkflowBootstrapPrimitiveSchema = z.strictObject({
  id: WorkflowIdSchema,
  label: z.string().min(1),
  categoryId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  descriptorFingerprint: FingerprintSchema,
  availability: CapabilityAvailabilitySchema,
});
export const WorkflowCategoryPrimitiveSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  order: z.number().int().nonnegative(),
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

/**
 * ONE doctor check, as the Top Bar's standing indicator reads it (doc 13 §5,
 * the Top Bar row's "storage/preflight summary").
 *
 * `blocks` names what this check's failure would break — never "some
 * workflows" — because the whole point of the doctor is knowing what will fail
 * BEFORE a Duo prompt is spent finding out. `checkedAt` is an instant and the
 * surface formats it; a display string on the wire would put the server's
 * locale on a Pacific operator's screen.
 *
 * The field is OPTIONAL on the bootstrap document and NOTHING serves it today
 * — `config/pending-wire-bindings.json` declares
 * `FrontendBootstrapWireSchema#preflight` as `declared-unserved`. The Top Bar's
 * popover renders only when it arrives; there is no fabricated verdict in the
 * meantime, because a green stethoscope over checks nobody ran is exactly the
 * lie this program forbids.
 */
export const PreflightCheckWireSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().min(1),
  verdict: PreflightVerdictSchema,
  detail: z.string().min(1),
  blocks: z.array(z.string().min(1)),
  remediation: z.string().min(1).optional(),
  checkedAt: IsoInstantSchema,
});

interface BootstrapParts {
  readonly workflow: z.ZodType;
  readonly workflowCategory: z.ZodType;
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
    projectionGeneration: ProjectionGenerationSchema,
    actor: ActorWireSchema,
    serverClock: ServerClockWireSchema,
    storage: StorageHealthSummaryWireSchema,
    workflows: z.array(parts.workflow),
    workflowCategories: z.array(parts.workflowCategory),
    systemInstances: z.array(parts.systemInstance),
    settingsSections: z.array(parts.settingsSection),
    featureAvailability: z.array(FeatureAvailabilityWireSchema),
    // Absent until the preflight service lands. Its ABSENCE is the honest
    // state, so the surface draws nothing rather than a verdict it invented.
    preflight: z.array(PreflightCheckWireSchema).optional(),
  });
}

export const FrontendBootstrapWireSchema = createFrontendBootstrapWireSchema({
  workflow: WorkflowBootstrapPrimitiveSchema,
  workflowCategory: WorkflowCategoryPrimitiveSchema,
  systemInstance: SystemInstancePrimitiveSchema,
  settingsSection: SettingsSectionPrimitiveSchema,
}).superRefine((bootstrap, context) => {
  const workflows = z.array(WorkflowBootstrapPrimitiveSchema).parse(bootstrap.workflows);
  const workflowCategories = z.array(WorkflowCategoryPrimitiveSchema).parse(bootstrap.workflowCategories);
  const systemInstances = z.array(SystemInstancePrimitiveSchema).parse(bootstrap.systemInstances);
  const settingsSections = z.array(SettingsSectionPrimitiveSchema).parse(bootstrap.settingsSections);
  const identities = [
    ["workflows", workflows.map(({ id }) => id)],
    ["workflowCategories", workflowCategories.map(({ id }) => id)],
    ["systemInstances", systemInstances.map(({ system }) => system)],
    ["settingsSections", settingsSections.map(({ id }) => id)],
    ["featureAvailability", bootstrap.featureAvailability.map(({ feature }) => feature)],
  ] as const;
  for (const [path, values] of identities) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", path: [path], message: `${path} identities must be unique` });
    }
  }
});

export type FrontendBootstrapWire = z.infer<typeof FrontendBootstrapWireSchema>;
