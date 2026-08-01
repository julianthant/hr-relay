import { z } from "zod";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScenarioIdSchema,
  ScreenIdSchema,
  TaskIdSchema,
} from "../ids.js";

export {
  ElementIdSchema,
  ObservationIdSchema,
  PageStateIdSchema,
  ScreenIdSchema,
} from "../ids.js";
export type {
  BrowserSystemId,
  ElementId,
  ObservationId,
  PageStateId,
  ScreenId,
} from "../ids.js";

export const UiSemanticKindSchema = z.enum(["screen", "element", "page-state", "observation"]);
export const UiSensitivitySchema = z.enum(["public", "hr", "restricted"]);
export const UiRoleSchema = z.enum([
  "button", "field", "grid", "row", "dialog", "heading", "link", "status", "display",
]);
export const UiEffectSchema = z.enum(["observe", "navigate", "prepare", "external-commit"]);
export const UiEvidenceReferenceSchema = z.string().regex(
  /^(?:evidence|tests\/unit\/fixtures)\/ui\/[a-z0-9/_.-]+\.json$/,
  "UI evidence refs must be checked-in sanitized JSON manifests",
);
export const UiSourceLinkSchema = z.string().regex(
  /^src\/stores\/[a-z0-9-]+\/driver\/[a-z0-9-]+\.ts#[A-Z0-9_]+$/,
);
export const UiPortMapRowReferenceSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  legacyKey: z.string().regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\(\)$/),
});

export const UiCatalogVerificationSchema = z.strictObject({
  verifiedAt: DateOnlySchema,
  fixtureEvidenceRef: UiEvidenceReferenceSchema,
  liveReadOnlyEvidenceRef: UiEvidenceReferenceSchema,
  scenarios: z.array(ScenarioIdSchema).min(1),
});
export const UiVerificationSchema = UiCatalogVerificationSchema.extend({
  portMapRows: z.array(UiPortMapRowReferenceSchema).min(1),
});

export const UiVerificationAssertionSchema = z.enum([
  "exactly-one-visible",
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
    matchedCount: z.literal(1),
    capturedValue: z.literal(false),
  })).min(1),
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

const CatalogCommonSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  label: z.string().min(1),
  searchTerms: z.array(z.string().min(1)).min(1),
  sensitivity: UiSensitivitySchema,
  verification: UiCatalogVerificationSchema,
  taskUses: z.array(TaskIdSchema),
  sourceLink: UiSourceLinkSchema,
});

export const UiCatalogEntrySchema = z.discriminatedUnion("kind", [
  CatalogCommonSchema.extend({ kind: z.literal("screen"), id: ScreenIdSchema }),
  CatalogCommonSchema.extend({
    kind: z.literal("element"),
    id: ElementIdSchema,
    screen: ScreenIdSchema,
    role: UiRoleSchema,
    effect: UiEffectSchema,
  }),
  CatalogCommonSchema.extend({
    kind: z.literal("page-state"),
    id: PageStateIdSchema,
    screen: ScreenIdSchema,
  }),
  CatalogCommonSchema.extend({
    kind: z.literal("observation"),
    id: ObservationIdSchema,
    screen: ScreenIdSchema,
    authoritativeFor: z.array(z.enum(["subject", "completion", "page-state"])).min(1),
  }),
]);

export const UiCatalogSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entries: z.array(UiCatalogEntrySchema),
});

export type UiCatalog = z.infer<typeof UiCatalogSchema>;
export type UiCatalogEntry = z.infer<typeof UiCatalogEntrySchema>;
export type UiVerificationEvidenceManifest = z.infer<typeof UiVerificationEvidenceManifestSchema>;
export type UiVerificationScenario = z.infer<typeof UiVerificationScenarioSchema>;
