import { z } from "zod";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScenarioIdSchema,
  ScreenIdSchema,
} from "../../rules/identity/ids.js";

export {
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScreenIdSchema,
} from "../../rules/identity/ids.js";
export type {
  BrowserSystemId,
  ElementId,
  ObservationId,
  PageStateId,
  ScreenId,
} from "../../rules/identity/ids.js";

export const UiSemanticKindSchema = z.enum(["screen", "element", "page-state", "observation"]);
export const UiSensitivitySchema = z.enum(["public", "hr", "restricted"]);
export const UiRoleSchema = z.enum([
  "button", "field", "grid", "row", "dialog", "heading", "link", "status", "display",
]);
export const UiEffectSchema = z.enum(["observe", "navigate", "prepare", "external-commit"]);
export const UiEvidenceReferenceSchema = z.string().regex(
  /^(?:docs\/rebuild\/evidence\/selectors|tests\/support\/fixtures\/ui)\/[a-z0-9/_.-]+\.json$/,
  "UI evidence refs must be checked-in sanitized JSON manifests",
);
export const UiSourceLinkSchema = z.string().regex(
  /^src\/(?:stores|backend\/systems)\/[a-z0-9-]+\/driver\/[a-z0-9-]+\.ts#[A-Z0-9_]+$/,
);
export const UiPortMapRowReferenceSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  legacyKey: z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/),
});

export const UiVerificationBaseSchema = z.strictObject({
  verifiedAt: DateOnlySchema,
  fixtureEvidenceRef: UiEvidenceReferenceSchema,
  liveReadOnlyEvidenceRef: UiEvidenceReferenceSchema,
  scenarios: z.array(ScenarioIdSchema).min(1),
});
export const UiVerificationSchema = UiVerificationBaseSchema.extend({
  portMapRows: z.array(UiPortMapRowReferenceSchema).min(1),
});

export const UiVerificationAssertionSchema = z.enum([
  "exactly-one-visible",
    /* Strictly stronger than `exactly-one-visible`: the recipe resolved to one node AND that node was ENABLED and (for a text control) EDITABLE on the live page; it still claims nothing about a WRITE. */
  "exactly-one-editable",
  "accepts-canonical-eid",
  "displayed-eid-equals-query",
  "recipe-resolves",
]);

export const UiVerificationEvidenceManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  evidenceKind: z.enum(["deterministic-fixture", "live-read-only"]),
  system: BrowserSystemIdSchema,
  screens: z.array(ScreenIdSchema).min(1),
  verifiedAt: DateOnlySchema,
  method: z.enum(["deterministic-driver", "playwright-cli-duo-autopilot"]),
  assertions: z.array(z.strictObject({
    semanticId: z.union([ScreenIdSchema, ElementIdSchema, PageStateIdSchema, ObservationIdSchema]),
    screen: ScreenIdSchema,
    scenarioId: ScenarioIdSchema,
    portMapRows: z.array(UiPortMapRowReferenceSchema).min(1),
    assertion: UiVerificationAssertionSchema,
        /* How many nodes the recipe resolved, VERBATIM: the real invariant is one distinct ACTION, not one node, and the `exactly-one-*` assertions still pin the count. */
    matchedCount: z.number().int().positive(),
    capturedValue: z.literal(false),
  })).min(1).superRefine((assertions, ctx) => {
    for (const [index, assertion] of assertions.entries()) {
      if (assertion.assertion === "recipe-resolves") continue;
      if (assertion.matchedCount !== 1) {
        ctx.addIssue({
          code: "custom",
          path: [index, "matchedCount"],
          message: `${assertion.semanticId} claims ${assertion.assertion} and recorded `
            + `${String(assertion.matchedCount)} matched nodes; that assertion IS the count`,
        });
      }
    }
  }),
  rejectedCandidates: z.array(z.strictObject({
    legacyKey: z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/),
    candidateDescription: z.string().min(1),
    reason: z.literal("zero-live-matches"),
    matchedCount: z.literal(0),
    replacementSemanticId: ElementIdSchema,
  })).optional(),
  paginationProofs: z.array(z.strictObject({
    context: z.enum(["search-results", "employment-instances"]),
    initialState: z.enum(["enabled-view-all", "disabled-view-all"]),
    finalState: z.enum(["view-n", "disabled-view-all"]),
    counterBefore: z.string().regex(/^\d+(?:-\d+)? of \d+$/),
    counterAfter: z.string().regex(/^\d+(?:-\d+)? of \d+$/),
    renderedUnit: z.enum(["rows", "assignment-grids"]),
    renderedBefore: z.number().int().positive(),
    renderedAfter: z.number().int().positive(),
  })).optional(),
  externalWriteAttempted: z.literal(false),
  sanitized: z.literal(true),
});

export const UiVerificationScenarioSchema = z.strictObject({
  id: ScenarioIdSchema,
  kind: z.literal("ui-verification"),
  title: z.string().min(1),
  system: BrowserSystemIdSchema,
  semanticIds: z.array(z.union([ElementIdSchema, PageStateIdSchema, ObservationIdSchema])).min(1),
  fixtureEvidenceRef: UiEvidenceReferenceSchema,
  liveReadOnlyEvidenceRef: UiEvidenceReferenceSchema,
  assertions: z.array(UiVerificationAssertionSchema).min(1),
});

export type UiVerificationEvidenceManifest = z.infer<typeof UiVerificationEvidenceManifestSchema>;
export type UiVerificationScenario = z.infer<typeof UiVerificationScenarioSchema>;
