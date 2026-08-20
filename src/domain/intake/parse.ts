/**
 * The intake PARSE VIEW — the re-derived half of a session (ref data-intake-and-edit-data §2.2, D170).
 *
 * A session retains the operator's decisions and the immutable source identity.
 * Everything else an intake surface shows — which worksheets the file holds,
 * which rows rank as header candidates, which columns exist, what their sample
 * values are, and the data rows themselves — is a pure function of
 * `(artifact bytes, sheet, headerRowIndex)`. It is therefore RE-DERIVED on every
 * read rather than stored: a stored copy could only ever drift from its own
 * source, and there is nothing it could be reconciled against.
 *
 * This module owns the SHAPE of that derivation, not the derivation itself. The
 * parse is produced behind the kernel's injected `intakeParser` seam because a
 * spreadsheet parser lives in `src/stores/**`, which neither `src/domain` nor
 * `src/core` may reach.
 *
 * ## Why `layout` is nullable rather than a second refusal code
 *
 * "This sheet has no settled header row" is a normal, expected state — ref data-intake-and-edit-data
 * §3's discovery deliberately preselects nothing when two candidates are
 * structurally indistinguishable, and the operator then picks. That is not a
 * failure to read the file, so it is not a refusal; the candidates are still
 * served so the picker has something to show. A refusal means the BYTES could
 * not yield a grid at all.
 */
import { z } from "zod";
import { FingerprintSchema } from "../ids.js";
import { HeaderDiscoverySchema, ServedHeaderCandidateSchema } from "./header-discovery.js";
import { DetectedColumnSchema } from "./mapping.js";

/**
 * `header-row-absent` is the parser's own arm: the three others come verbatim
 * from the shared grid edge, while an explicitly requested header row that the
 * sheet does not contain is a refusal this layer discovers.
 */
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
  /**
   * Data rows, header-relative and in file order, with wholly blank rows
   * dropped: source row N is `rows[N - 1]`. A blank row is not a data row, and
   * counting one would reject a person who is not in the file.
   */
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

/**
 * The `inspect-intake` selection, resolved in ONE place.
 *
 * The kernel arm and the caller that prepares the parse for it must agree
 * exactly on which `(sheet, headerRowIndex)` pair the command asks for —
 * two independent resolutions of one selection is a drift surface, and the
 * kernel would fail loud on a key nobody prepared.
 *
 * A sheet change discards the header row: a row index means nothing on a
 * different sheet, so the selection falls back to discovery rather than
 * carrying a number across.
 */
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
