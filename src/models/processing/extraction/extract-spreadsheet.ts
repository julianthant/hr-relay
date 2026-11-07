/** String-only cells prevent Excel serial coercion; content-addressed input has no age budget. */
import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { ServedHeaderCandidateSchema } from "../../../rules/intake/header-discovery.js";
import { DetectedColumnSchema } from "../../intake/mapping.js";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const ExtractSpreadsheetInputSchema = z.strictObject({
  artifact: ArtifactRefSchema,
    /* Which worksheet to read; absent means the first, and a `.csv` has exactly one, named `default`. */
  sheet: z.string().min(1).optional(),
    /* The operator's explicit header-row choice; present means "re-parse against exactly this row", and a row that does not exist is refused rather than clamped. */
  headerRowIndex: z.number().int().nonnegative().optional(),
});

export const ExtractSpreadsheetOutputSchema = z.strictObject({
  /** Every worksheet in the file, in file order, so the UI can offer a switch. */
  sheets: z.array(z.string().min(1)).min(1),
  sheet: z.string().min(1),
    /* Null when discovery found no confident, unambiguous candidate: the operator then picks, and nothing downstream may proceed on a guess. */
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
