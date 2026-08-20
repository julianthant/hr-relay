import { z } from "zod";
import { CapabilityAvailabilitySchema } from "../absence.js";
import {
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  LocalOperatorActorSchema,
  WorkflowIdSchema,
} from "../ids.js";
import { WorkflowModuleRoleSchema } from "../workflow/module-role.js";
import { WorkflowCodeSchema } from "../workflow/presentation.js";
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

/**
 * `code` is the descriptor's OWN 2-char code — the prefix of every one of its
 * trace ids, guarded `/^[a-z0-9]{2}$/` at `defineWorkflow` (`base/workflow.ts`).
 * The Workflow Panel's launcher and the Run Modal's picker both draw it, so the
 * control is never an anonymous glyph; deriving two letters from the label on
 * the client would put a value the server never issued beside the identity an
 * operator selects a real HR workflow by.
 *
 * `categoryId` is the RAW category the descriptor declares, and it is all the
 * server contributes to grouping. The heading text and the display ORDER are
 * the frontend's (doc 03 §Shell: "the frontend hardcodes only the display
 * order, membership is the descriptor's, an unlisted category appends, and an
 * empty category drops") — this wire used to also carry a `workflowCategories`
 * projection whose label was `id.replace(/-/g, " ")` and whose order was
 * first-seen, i.e. two display decisions the server invented and no operator
 * chose. Both moved to `dashboard/surfaces/workflow-category.ts`.
 *
 * `role` is the RAW membership fact the module declares (doc 02 §1.2.1, D219)
 * — `standalone`, `composition`, or `chunk-harness` naming the composition this
 * entry is a step of. It is required, and display stays the frontend's on the
 * standing R2 D17/D18 split: the ONE grouping rule that nests a harness under
 * its composition lives in `dashboard/surfaces/workflow-category.ts` beside the
 * category rule, so no two workflow-listing surfaces can disagree about what is
 * a step and what is a workflow.
 */
export const WorkflowBootstrapPrimitiveSchema = z.strictObject({
  id: WorkflowIdSchema,
  code: WorkflowCodeSchema,
  label: z.string().min(1),
  categoryId: z.string().regex(/^[a-z][a-z0-9-]*$/),
  descriptorFingerprint: FingerprintSchema,
  availability: CapabilityAvailabilitySchema,
  role: WorkflowModuleRoleSchema,
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
  /**
   * A harness's `of` must name a composition IN THIS DOCUMENT (D219).
   *
   * The composition root already refuses a dangling or non-composition target
   * at load, so this is not a second authority over the fact — it is the wire
   * refusing to describe a nesting the receiving surface could not draw. A
   * served entry pointing at a workflow this document does not carry would
   * leave the frontend's ONE grouping rule with a parent it cannot find, and
   * the only ways out of that are inventing a group or silently promoting the
   * harness to a peer — which is the exact ruling D219 overturned.
   */
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
