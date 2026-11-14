import { z } from "zod";
import { EidSchema, IsoInstantSchema, PageStateIdSchema } from "../../rules/identity/ids.js";
import type { MutationCapability } from "./driver.js";
import { UcpathUsDateSchema } from "./ucpath-smart-hr-termination.js";

export const UCPATH_PAYPATH_POSITION_READY = PageStateIdSchema.parse("ucpath.paypath.position-data-ready");
export const UCPATH_PAYPATH_WORK_STUDY_STAGED = PageStateIdSchema.parse("ucpath.paypath.work-study-staged");
export const UcpathPayPathDisplayedNameSchema = z.literal("ucpath.paypath.displayed-name").brand<"ObservationId">();
/** The name the PayPath employee header shows on the staged page; the write binds the subject to it before the fence. */
export const UCPATH_PAYPATH_DISPLAYED_NAME = UcpathPayPathDisplayedNameSchema.parse("ucpath.paypath.displayed-name");
export type UcpathPayPathObservations = Readonly<Record<typeof UCPATH_PAYPATH_DISPLAYED_NAME, string>>;

/** Position Data values exactly as PayPath displays them before any change; blank is a real displayed value. */
export const UcpathPayPathPositionSchema = z.strictObject({
  effectiveDate: z.string(),
  positionChangeReason: z.string(),
  positionPool: z.string(),
  positionNumber: z.string(),
});
export type UcpathPayPathPosition = z.infer<typeof UcpathPayPathPositionSchema>;

export const UcpathPayPathReadSchema = z.strictObject({
  pageStateId: z.literal(UCPATH_PAYPATH_POSITION_READY),
  emplId: EidSchema,
  displayedName: z.string().trim().min(1),
  position: UcpathPayPathPositionSchema,
  observedAt: IsoInstantSchema,
});
export type UcpathPayPathRead = z.infer<typeof UcpathPayPathReadSchema>;

/** The work-study transaction one run files: the plan's values and the PayPath name it was planned for. */
export const UcpathPayPathWorkStudyTargetSchema = z.strictObject({
  emplId: EidSchema,
  expectedName: z.string().trim().min(1),
  effectiveDate: UcpathUsDateSchema,
  positionChangeReason: z.literal("JRL"),
  positionPool: z.literal("F"),
  comments: z.string().trim().min(1),
});
export type UcpathPayPathWorkStudyTarget = z.infer<typeof UcpathPayPathWorkStudyTargetSchema>;

/** Every value the staged PayPath page shows after filling, read back from the page rather than echoed from the fill. */
export const UcpathPayPathStagedValuesSchema = z.strictObject({
  effectiveDate: z.string(),
  positionChangeReason: z.string(),
  positionPool: z.string(),
  jobDataComments: z.string(),
  initiatorComments: z.string(),
});
export type UcpathPayPathStagedValues = z.infer<typeof UcpathPayPathStagedValuesSchema>;

export const UcpathPayPathStagedSchema = z.strictObject({
  pageStateId: z.literal(UCPATH_PAYPATH_WORK_STUDY_STAGED),
  emplId: EidSchema,
  displayedName: z.string().trim().min(1),
  values: UcpathPayPathStagedValuesSchema,
  observedAt: IsoInstantSchema,
});
export type UcpathPayPathStaged = z.infer<typeof UcpathPayPathStagedSchema>;

export const UCPATH_PAYPATH_REFUSAL_CODES = [
  "paypath-hr-tasks-not-shown",
  "paypath-search-not-shown",
  "employee-not-found",
  "subject-mismatch",
  "paypath-multiple-records",
  "paypath-alert-shown",
  "paypath-identity-unreadable",
  "paypath-position-already-dated",
  "unexpected-page-state",
  "staged-value-mismatch",
] as const;
export type UcpathPayPathRefusalCode = (typeof UCPATH_PAYPATH_REFUSAL_CODES)[number];

/** A typed refusal from the PayPath page; `alertText` is set only for `paypath-alert-shown`. */
export class UcpathPayPathRefusedError extends Error {
  constructor(readonly code: UcpathPayPathRefusalCode, readonly alertText?: string, options?: ErrorOptions) {
    super(code, options);
    this.name = "UcpathPayPathRefusedError";
  }
}

/** PeopleSoft answered Save and Submit with an alert; the click happened, so the caller treats it as post-fence uncertainty. */
export class UcpathPayPathSubmitRefusedError extends Error {
  constructor(readonly alertText: string) {
    super("paypath-submit-refused");
    this.name = "UcpathPayPathSubmitRefusedError";
  }
}

export interface UcpathPayPathDriver {
  /** Opens PayPath Actions for one Empl ID and reads its header and current Position Data without changing anything. */
  readPayPathPosition(input: Readonly<{ emplId: z.output<typeof EidSchema> }>): Promise<UcpathPayPathRead>;
  /** Opens PayPath Actions for the target, fills Position Data, Job Data comments and Initiator's comments, and reads every value back; saves nothing. */
  stagePayPathWorkStudy(input: UcpathPayPathWorkStudyTarget): Promise<UcpathPayPathStaged>;
  /** Reads the employee name the PayPath header shows on the current page, for the subject binding before the fence. */
  readPayPathSubject(): Promise<string>;
  /** Clicks Save and Submit once on the staged page under a minted capability and waits for PeopleSoft to settle. */
  submitPayPathWorkStudy(input: UcpathPayPathWorkStudyTarget, capability: MutationCapability): Promise<void>;
}
