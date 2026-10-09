/**
 * `extraction/extract-spreadsheet` — ref data-intake-and-edit-data §3's parse contract.
 *
 * Ref data-intake-and-edit-data names it `extraction/parse-csv` and describes it as "Parse CSV/XLSX
 * into rows + detected columns". One task handles both formats, so the id says
 * so: a caller must not have to know which of two ids to reach for based on a
 * file extension it should not be inspecting.
 *
 * ## Every cell crosses this boundary as a canonical STRING
 *
 * `.xlsx` gives typed cells — a date cell is a real `Date`, a number is a
 * `number`. Passing those through would put format-dependent values into the
 * mapping grid and, worse, would let an unconverted Excel serial (`45678`)
 * reach a date coercer. So the implementation canonicalizes at the edge: a
 * date-typed cell becomes ISO `YYYY-MM-DD`, a number becomes its decimal text,
 * a blank becomes `""`. `parseUsOrIsoDate` then accepts the ISO form and
 * REFUSES a bare serial, which is exactly the split we want — the parser knew
 * it was a date and said so, or nobody did and nobody guesses.
 *
 * ## Deterministic, so its freshness is infinite
 *
 * The input is a content-addressed artifact. Re-parsing the same bytes with the
 * same header selection yields the same rows, so there is nothing for age to
 * invalidate. That is a justified `Infinity`, not a waiver: the value is a pure
 * function of an immutable input.
 */
import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { ServedHeaderCandidateSchema } from "../../../rules/intake/header-discovery.js";
import { DetectedColumnSchema } from "../../intake/mapping.js";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const ExtractSpreadsheetInputSchema = z.strictObject({
  artifact: ArtifactRefSchema,
  /**
   * Which worksheet to read. Absent means the first. A `.csv` has exactly one
   * and names it `default`.
   */
  sheet: z.string().min(1).optional(),
  /**
   * The operator's explicit header-row choice, when discovery could not
   * preselect one. Absent means "discover"; present means "re-parse against
   * exactly this row", and a row that does not exist is refused rather than
   * clamped.
   */
  headerRowIndex: z.number().int().nonnegative().optional(),
});

export const ExtractSpreadsheetOutputSchema = z.strictObject({
  /** Every worksheet in the file, in file order, so the UI can offer a switch. */
  sheets: z.array(z.string().min(1)).min(1),
  sheet: z.string().min(1),
  /**
   * Null when discovery found no confident, unambiguous candidate. The operator
   * then picks from `headerCandidates`; nothing downstream may proceed on a
   * guess (ref data-intake-and-edit-data §3).
   */
  headerRowIndex: z.number().int().nonnegative().nullable(),
  headerCandidates: z.array(ServedHeaderCandidateSchema),
  /** Populated only once a header row is settled; `[]` while it is null. */
  columns: z.array(DetectedColumnSchema),
  /** Data rows beneath the header, header-relative. `[]` while it is null. */
  rows: z.array(z.array(z.string())),
  /** Rows above and including the header, so the grid can show the preamble. */
  skippedRows: z.number().int().nonnegative(),
});
export type ExtractSpreadsheetOutput = z.infer<typeof ExtractSpreadsheetOutputSchema>;

export const ExtractSpreadsheet = defineTaskContract({
  id: taskId("extraction/extract-spreadsheet"),
  title: "Parsing spreadsheet",
  effect: "read",
  input: ExtractSpreadsheetInputSchema,
  output: ExtractSpreadsheetOutputSchema,
  errorCodes: ["unreadable-file", "empty-sheet", "unknown-sheet", "invalid-header-selection"],
  subject: { kind: "none", reason: "deterministic local artifact parsing resolves no person" },
  freshness: {
    // Content-addressed bytes do not age: the artifact id IS its digest, so the
    // same input can only ever produce the same output.
    defaultMaxAgeMs: Number.POSITIVE_INFINITY,
    defaultOverride: "forbidden",
  },
  provenance: { default: "live" },
  artifacts: "content-addressed",
  scenarios: [
    "intake/spreadsheet/happy",
    "intake/spreadsheet/no-header",
    "intake/spreadsheet/duplicate-headers",
    "intake/spreadsheet/unreadable",
  ],
  example: {
    sheets: ["default"],
    sheet: "default",
    headerRowIndex: 0,
    headerCandidates: [{ rowIndex: 0, cells: ["Employee ID#", "Effective Date"], confidence: 0.87 }],
    columns: [
      {
        sourceColumnId: "eyJub3JtYWxpemVkSGVhZGVyIjoiZW1wbG95ZWUgaWQjIiwib2NjdXJyZW5jZSI6MX0",
        header: "Employee ID#",
        normalizedHeader: "employee id#",
        occurrence: 1,
        currentIndex: 0,
        samples: ["10456712"],
      },
      {
        sourceColumnId: "eyJub3JtYWxpemVkSGVhZGVyIjoiZWZmZWN0aXZlIGRhdGUiLCJvY2N1cnJlbmNlIjoxfQ",
        header: "Effective Date",
        normalizedHeader: "effective date",
        occurrence: 1,
        currentIndex: 1,
        samples: ["2026-07-01"],
      },
    ],
    rows: [["10456712", "2026-07-01"]],
    skippedRows: 1,
  },
});
