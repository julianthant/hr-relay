import { z } from "zod";
import { EidSchema, IsoInstantSchema, PageStateIdSchema } from "../../rules/identity/ids.js";

export const UCPATH_PAYPATH_POSITION_READY = PageStateIdSchema.parse("ucpath.paypath.position-data-ready");

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

export const UCPATH_PAYPATH_REFUSAL_CODES = [
  "employee-not-found",
  "subject-mismatch",
  "paypath-multiple-records",
  "paypath-alert-shown",
  "paypath-identity-unreadable",
  "unexpected-page-state",
] as const;
export type UcpathPayPathRefusalCode = (typeof UCPATH_PAYPATH_REFUSAL_CODES)[number];

/** A typed refusal from the PayPath page; `alertText` is set only for `paypath-alert-shown`. */
export class UcpathPayPathRefusedError extends Error {
  constructor(readonly code: UcpathPayPathRefusalCode, readonly alertText?: string) {
    super(code);
    this.name = "UcpathPayPathRefusedError";
  }
}

export interface UcpathPayPathDriver {
  /** Opens PayPath Actions for one Empl ID and reads its header and current Position Data without changing anything. */
  readPayPathPosition(input: Readonly<{ emplId: z.output<typeof EidSchema> }>): Promise<UcpathPayPathRead>;
}
