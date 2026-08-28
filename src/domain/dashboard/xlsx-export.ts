/**
 * DCR5 operator XLSX export: a strict, redacted selection document.
 *
 * The current search arm contains only the D283 separations corpus already
 * admitted by `CrossDateSearchResultSchema`. Full run, trace and retry ids are
 * required to prove the authority selection, but the workbook composer omits
 * them; its durable run number is the only row label that leaves in the file.
 */
import { z } from "zod";
import { IsoInstantSchema, NonNegativeIntSchema } from "../ids.js";
import {
  CROSS_DATE_SEARCH_ORDER,
  CrossDateSearchQuerySchema,
  CrossDateSearchResultSchema,
} from "./search.js";

export const OPERATOR_XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

export const OperatorXlsxSearchSelectionSchema = z.strictObject({
  kind: z.literal("search"),
  query: CrossDateSearchQuerySchema.omit({ cursor: true }),
  snapshot: z.strictObject({
    generatedAt: IsoInstantSchema,
    authorityGeneration: NonNegativeIntSchema,
    order: z.literal(CROSS_DATE_SEARCH_ORDER),
    totalMatches: NonNegativeIntSchema,
  }),
});

export const OperatorXlsxSearchDocumentSchema = z.strictObject({
  selection: OperatorXlsxSearchSelectionSchema,
  results: z.array(CrossDateSearchResultSchema),
}).superRefine((document, context) => {
  if (document.results.length !== document.selection.snapshot.totalMatches) {
    context.addIssue({
      code: "custom",
      path: ["results"],
      message: "search workbook rows must exactly cover the selected snapshot total",
    });
  }
  const seen = new Set<string>();
  for (const [index, result] of document.results.entries()) {
    if (seen.has(result.runId)) {
      context.addIssue({
        code: "custom",
        path: ["results", index, "runId"],
        message: `search workbook repeats run ${result.runId}`,
      });
    }
    seen.add(result.runId);
  }
});

export type OperatorXlsxSearchDocument = z.infer<typeof OperatorXlsxSearchDocumentSchema>;

export function operatorXlsxSearchCaveats(document: OperatorXlsxSearchDocument): readonly string[] {
  return Object.freeze([
    "This workbook is a snapshot of non-archived run authority for the exact cross-date search selection recorded with the export.",
    `The current measured corpus admits only Separations dry runs; this snapshot contains ${String(document.results.length)} row${document.results.length === 1 ? "" : "s"}.`,
    "Person, run, trace and retry identifiers are omitted. A durable workflow run number is the only row label included in the workbook.",
    "Search text is retained in the export evidence but omitted from workbook cells so an identifier-shaped query cannot become exported data.",
    "Rows retain the authority order: match strength, enqueue instant descending, then run id ascending. The final run-id tie-break is not displayed.",
    "Every instant is a typed spreadsheet date displayed in UTC; partition days remain Pacific calendar dates from the search authority.",
  ]);
}
