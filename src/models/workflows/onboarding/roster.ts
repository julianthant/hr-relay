import { z } from "zod";
import { EidSchema, IsoInstantSchema, FingerprintSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { WorkbookIdSchema } from "../../dashboard/workbooks.js";
import { UcpathApprovalStatusSchema, UcpathTransactionReceiptSchema } from "../../ui/ucpath-ss-smart-hr.js";

const namePart = z.string().min(1).refine(value => value.trim() === value);
const RosterPersonNameSchema = z.strictObject({
  firstName: namePart, lastName: namePart, middleName: z.string().refine(value => value.trim() === value),
});

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
export const ONBOARDING_ROSTER_FIELDS = ["email", "firstName", "lastName", "middleName",
  "roster.livedFirstName", "roster.livedLastName", "roster.livedMiddleName"] as const;

export const OnboardingRosterSnapshotRowSchema = z.strictObject({
  binding: OnboardingRosterBindingSchema,
  references: z.strictObject({ legalName: RosterPersonNameSchema, livedName: RosterPersonNameSchema.nullable() }),
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
  eid: EidSchema.optional(), i9ProfileId: z.string().min(1).optional(),
  transactionNumber: UcpathTransactionReceiptSchema.optional(),
  transactionApprovalStatus: UcpathApprovalStatusSchema.optional(),
}).refine(cells => Object.values(cells).some(value => value !== undefined), "a roster fill needs at least one result cell")
  .refine(cells => (cells.transactionNumber === undefined) === (cells.transactionApprovalStatus === undefined),
    "transaction number and approval status must be supplied together");

export const OnboardingRosterWriteInputSchema = z.strictObject({
  target: z.literal("master"), source: OnboardingRosterBindingSchema, cells: OnboardingRosterCellsSchema,
});
export const OnboardingRosterWriteOutputSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("filled"), workbookId: WorkbookIdSchema, rowKey: OnboardingRosterRowKeySchema,
    changeLogId: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("resolve-required"), workbookId: WorkbookIdSchema, rowKey: OnboardingRosterRowKeySchema,
    reason: z.enum(["row-missing", "row-ambiguous", "operator-edited-cell"]),
  }),
]);
