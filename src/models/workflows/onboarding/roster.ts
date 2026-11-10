import { z } from "zod";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { collapseWhitespace } from "../../fields/cell-coercion.js";
import { containsDryRunSample } from "../../workflow/dry-run.js";
import { IsoInstantSchema, FingerprintSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { WorkbookIdSchema } from "../../dashboard/workbooks.js";
import { UcpathTransactionReceiptSchema } from "../../ui/ucpath-ss-smart-hr.js";

const RosterNameCellSchema = z.string().min(1).refine(value => collapseWhitespace(value) === value);

export const OnboardingRosterRowKeySchema = z.strictObject({ email: z.email() });

export const OnboardingRosterReferenceBindingSchema = z.strictObject({
  workbookType: z.literal("onboarding-roster"), workbookId: WorkbookIdSchema,
  referenceDigest: FingerprintSchema, workbookVersion: z.number().int().positive(), capturedAt: IsoInstantSchema,
  rowKey: OnboardingRosterRowKeySchema,
});

export const OnboardingRosterBindingSchema = OnboardingRosterReferenceBindingSchema.extend({
  sheetId: z.string().min(1), rowId: z.string().min(1),
});

export const ONBOARDING_ROSTER_TYPE_ID = "onboarding-roster";
export const ONBOARDING_ROSTER_GATE_ID = "roster-choice";
export const ONBOARDING_ROSTER_NAME_FIELDS = ["email", "fullName", "livedName"] as const;
export const ONBOARDING_ROSTER_OUTPUT_FIELDS = ["eid", "transactionNumber"] as const;
export const ONBOARDING_ROSTER_FIELDS = [...ONBOARDING_ROSTER_NAME_FIELDS, ...ONBOARDING_ROSTER_OUTPUT_FIELDS] as const;

export const OnboardingRosterSnapshotRowSchema = z.strictObject({
  binding: OnboardingRosterBindingSchema,
  references: z.strictObject({ legalName: RosterNameCellSchema, livedName: RosterNameCellSchema.nullable() }),
});

export const OnboardingRosterChoiceSchema = z.strictObject({
  decision: z.literal("selected"), row: OnboardingRosterSnapshotRowSchema,
});

export const OnboardingRosterReadInputSchema = z.strictObject({
  runId: RunIdSchema, workbookType: z.literal("onboarding-roster"),
  workbookId: WorkbookIdSchema, rowKey: OnboardingRosterRowKeySchema,
});
export const OnboardingRosterReadOutputSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("resolved"), row: OnboardingRosterSnapshotRowSchema }),
  z.strictObject({
    state: z.literal("resolve-required"), binding: OnboardingRosterReferenceBindingSchema,
    reason: z.enum(["row-missing", "row-ambiguous"]),
  }),
]);

export const OnboardingRosterCellsSchema = z.strictObject({
  eid: CANONICAL_FIELDS.eid.schema.optional(), transactionNumber: UcpathTransactionReceiptSchema,
}).refine(cells => !containsDryRunSample(cells), "Preview samples cannot fill a master cell");
