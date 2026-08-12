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
