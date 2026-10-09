/** Re-derive the parse view from artifact/sheet/header; store only operator decisions and identity. */
import { z } from "zod";
import { FingerprintSchema } from "../../rules/identity/ids.js";
import { HeaderDiscoverySchema, ServedHeaderCandidateSchema } from "../../rules/intake/header-discovery.js";
import { DetectedColumnSchema } from "./mapping.js";

/** A requested but absent header is this parser's refusal; shared grid errors remain unchanged. */
export const IntakeParseRefusalCodeSchema = z.enum([
  "unreadable-file",
  "unknown-sheet",
  "empty-sheet",
  "header-row-absent",
]);
export type IntakeParseRefusalCode = z.infer<typeof IntakeParseRefusalCodeSchema>;

/** What a settled header row yields. Absent until one is settled. */
export const IntakeLayoutSchema = z.strictObject({
  headerRowIndex: z.number().int().nonnegative(),
  columns: z.array(DetectedColumnSchema),
  /** Ref data-intake-and-edit-data §2.3's order-insensitive layout identity, over these exact columns. */
  headerFingerprint: FingerprintSchema,
    /* Data rows, header-relative and in file order, with wholly blank rows dropped: source row N is `rows[N - 1]`, and counting a blank row would reject a person who is not in the file. */
  rows: z.array(z.array(z.string())),
});
export type IntakeLayout = z.infer<typeof IntakeLayoutSchema>;

export const IntakeParseSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("refused"),
    code: IntakeParseRefusalCodeSchema,
    message: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("parsed"),
    /** Every worksheet the file declares, so the operator can switch. */
    sheets: z.array(z.string().min(1)).min(1),
    sheet: z.string().min(1),
    candidates: z.array(ServedHeaderCandidateSchema),
    discoveryReason: HeaderDiscoverySchema.shape.reason,
    layout: IntakeLayoutSchema.nullable(),
  }),
]);
export type IntakeParse = z.infer<typeof IntakeParseSchema>;

/** What a caller must name to get one exact parse back. */
export const IntakeParseRequestSchema = z.strictObject({
  sha256: FingerprintSchema,
  sheet: z.string().min(1),
  /** Null asks discovery to settle it; a number is the operator's own choice. */
  headerRowIndex: z.number().int().nonnegative().nullable(),
});
export type IntakeParseRequest = z.infer<typeof IntakeParseRequestSchema>;

/** The `inspect-intake` selection, resolved in ONE place; a sheet change discards the header row, because a row index means nothing on a different sheet. */
export function resolveInspectSelection(
  session: Readonly<{ sheet: string; headerRowIndex: number | null }>,
  payload: Readonly<{ sheet?: string | undefined; headerRowIndex?: number | undefined }>,
): Readonly<{ sheet: string; headerRowIndex: number | null }> {
  const sheet = payload.sheet ?? session.sheet;
  if (payload.headerRowIndex !== undefined) {
    return Object.freeze({ sheet, headerRowIndex: payload.headerRowIndex });
  }
  return Object.freeze({ sheet, headerRowIndex: sheet === session.sheet ? session.headerRowIndex : null });
}
