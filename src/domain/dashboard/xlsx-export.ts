/**
 * DCR5 operator XLSX export: a strict, redacted selection document.
 *
 * The current search arm contains only the D283 separations corpus already
 * admitted by `CrossDateSearchResultSchema`. Full run, trace and retry ids are
 * required to prove the authority selection, but the workbook composer omits
 * them; its durable run number is the only row label that leaves in the file.
 */
import { z } from "zod";
import { ArtifactRefSchema } from "../artifacts.js";
import { FingerprintSchema, IsoInstantSchema, NonNegativeIntSchema } from "../ids.js";
import {
  CROSS_DATE_SEARCH_ORDER,
  CrossDateSearchQuerySchema,
  CrossDateSearchResultSchema,
} from "./search.js";
import { ActivityReportWireSchema, activityReportCaveats } from "./activity.js";

export const OPERATOR_XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

export const OperatorXlsxSearchSelectionSchema = z.strictObject({
  kind: z.literal("search"),
  query: CrossDateSearchQuerySchema.omit({ cursor: true }),
  snapshot: z.strictObject({
    generatedAt: IsoInstantSchema,
    sourceIdentity: FingerprintSchema,
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

export const OperatorXlsxActivitySelectionSchema = z.strictObject({
  kind: z.literal("activity"),
  snapshot: z.strictObject({
    from: z.iso.date(),
    to: z.iso.date(),
    generatedAt: IsoInstantSchema,
    sourceIdentity: FingerprintSchema,
    totalRuns: NonNegativeIntSchema,
  }).refine(
    (snapshot) => snapshot.from <= snapshot.to,
    { path: ["from"], message: "an Activity XLSX selection starts on or before it ends" },
  ),
});

export const OperatorXlsxActivityDocumentSchema = z.strictObject({
  selection: OperatorXlsxActivitySelectionSchema,
  report: ActivityReportWireSchema,
}).superRefine((document, context) => {
  const { snapshot } = document.selection;
  if (document.report.from !== snapshot.from || document.report.to !== snapshot.to
    || document.report.generatedAt !== snapshot.generatedAt
    || document.report.totalRuns !== snapshot.totalRuns) {
    context.addIssue({
      code: "custom",
      path: ["report"],
      message: "Activity workbook report must belong to its exact selected date snapshot",
    });
  }
});
export type OperatorXlsxActivityDocument = z.infer<typeof OperatorXlsxActivityDocumentSchema>;

export const OperatorXlsxWorkbookDocumentSchema = z.union([
  OperatorXlsxSearchDocumentSchema,
  OperatorXlsxActivityDocumentSchema,
]);
export type OperatorXlsxWorkbookDocument = z.infer<typeof OperatorXlsxWorkbookDocumentSchema>;

export const OperatorXlsxExportIdSchema = z.string().uuid().brand<"OperatorXlsxExportId">();

const OperatorXlsxSearchExportRequestSelectionSchema = z.strictObject({
    kind: z.literal("search"),
    query: CrossDateSearchQuerySchema.omit({ cursor: true }),
    snapshot: z.strictObject({
      authorityGeneration: NonNegativeIntSchema,
      order: z.literal(CROSS_DATE_SEARCH_ORDER),
    }),
});

const OperatorXlsxActivityExportRequestSelectionSchema = z.strictObject({
  kind: z.literal("activity"),
  from: z.iso.date(),
  to: z.iso.date(),
}).refine(
  (selection) => selection.from <= selection.to,
  { path: ["from"], message: "an Activity XLSX selection starts on or before it ends" },
);

export const OperatorXlsxExportRequestSchema = z.strictObject({
  selection: z.union([
    OperatorXlsxSearchExportRequestSelectionSchema,
    OperatorXlsxActivityExportRequestSelectionSchema,
  ]),
});
export type OperatorXlsxExportRequest = z.infer<typeof OperatorXlsxExportRequestSchema>;

export const OperatorXlsxFileNameSchema = z.union([
  z.string().regex(/^hr-run-search-\d{4}-\d{2}-\d{2}-g\d+\.xlsx$/u),
  z.string().regex(/^hr-activity-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/u),
]);

const OperatorXlsxSearchFileNameSchema = z.string()
  .regex(/^hr-run-search-\d{4}-\d{2}-\d{2}-g\d+\.xlsx$/u);
const OperatorXlsxActivityFileNameSchema = z.string()
  .regex(/^hr-activity-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/u);

function operatorXlsxDownloadEvidenceSchema(
  filename: typeof OperatorXlsxSearchFileNameSchema | typeof OperatorXlsxActivityFileNameSchema,
) {
  return z.strictObject({
  filename,
  mediaType: z.literal(OPERATOR_XLSX_MEDIA_TYPE),
  contentDisposition: z.string().min(1),
  byteLength: z.number().int().positive(),
  sha256: FingerprintSchema,
  });
}

const OperatorXlsxExportEvidenceBaseSchema = z.strictObject({
  exportId: OperatorXlsxExportIdSchema,
  workbookVersion: z.literal(1),
  createdAt: IsoInstantSchema,
  artifact: ArtifactRefSchema,
});

const OperatorXlsxSearchExportEvidenceSchema = OperatorXlsxExportEvidenceBaseSchema.extend({
  selection: OperatorXlsxSearchSelectionSchema,
  workbook: z.strictObject({
    sheetNames: z.tuple([z.literal("Read Me"), z.literal("Runs")]),
    rowCount: NonNegativeIntSchema,
  }),
  download: operatorXlsxDownloadEvidenceSchema(OperatorXlsxSearchFileNameSchema),
}).superRefine((evidence, context) => {
  if (evidence.workbook.rowCount !== evidence.selection.snapshot.totalMatches) {
    context.addIssue({
      code: "custom",
      path: ["workbook", "rowCount"],
      message: "operator XLSX evidence row count must equal the selected snapshot total",
    });
  }
  if (evidence.artifact.mediaType !== evidence.download.mediaType
    || evidence.artifact.bytes !== evidence.download.byteLength
    || evidence.artifact.sha256 !== evidence.download.sha256) {
    context.addIssue({
      code: "custom",
      path: ["download"],
      message: "operator XLSX download evidence must exactly match the content-addressed artifact",
    });
  }
  if (evidence.download.contentDisposition !== `attachment; filename="${evidence.download.filename}"`) {
    context.addIssue({
      code: "custom",
      path: ["download", "contentDisposition"],
      message: "operator XLSX content disposition must name its exact persisted filename",
    });
  }
  const expectedFilename = `hr-run-search-${evidence.selection.snapshot.generatedAt.slice(0, 10)}`
    + `-g${String(evidence.selection.snapshot.authorityGeneration)}.xlsx`;
  if (evidence.download.filename !== expectedFilename) {
    context.addIssue({
      code: "custom",
      path: ["download", "filename"],
      message: "search XLSX filename must name its exact selected authority snapshot",
    });
  }
});

const OperatorXlsxActivityExportEvidenceSchema = OperatorXlsxExportEvidenceBaseSchema.extend({
  selection: OperatorXlsxActivitySelectionSchema,
  workbook: z.strictObject({
    sheetNames: z.tuple([
      z.literal("Read Me"),
      z.literal("Summary"),
      z.literal("By Day"),
      z.literal("By Workflow"),
      z.literal("By Category"),
      z.literal("By Status"),
      z.literal("By Outcome"),
      z.literal("Failures"),
      z.literal("Ledger"),
    ]),
    rowCount: NonNegativeIntSchema,
  }),
  download: operatorXlsxDownloadEvidenceSchema(OperatorXlsxActivityFileNameSchema),
}).superRefine((evidence, context) => {
  if (evidence.workbook.rowCount !== evidence.selection.snapshot.totalRuns) {
    context.addIssue({
      code: "custom",
      path: ["workbook", "rowCount"],
      message: "operator XLSX evidence row count must equal the selected snapshot total",
    });
  }
  if (evidence.artifact.mediaType !== evidence.download.mediaType
    || evidence.artifact.bytes !== evidence.download.byteLength
    || evidence.artifact.sha256 !== evidence.download.sha256) {
    context.addIssue({
      code: "custom",
      path: ["download"],
      message: "operator XLSX download evidence must exactly match the content-addressed artifact",
    });
  }
  if (evidence.download.contentDisposition !== `attachment; filename="${evidence.download.filename}"`) {
    context.addIssue({
      code: "custom",
      path: ["download", "contentDisposition"],
      message: "operator XLSX content disposition must name its exact persisted filename",
    });
  }
  const expectedFilename = `hr-activity-${evidence.selection.snapshot.from}_${evidence.selection.snapshot.to}.xlsx`;
  if (evidence.download.filename !== expectedFilename) {
    context.addIssue({
      code: "custom",
      path: ["download", "filename"],
      message: "Activity XLSX filename must name its exact selected date range",
    });
  }
});

export const OperatorXlsxExportEvidenceSchema = z.union([
  OperatorXlsxSearchExportEvidenceSchema,
  OperatorXlsxActivityExportEvidenceSchema,
]);
export type OperatorXlsxExportEvidence = z.infer<typeof OperatorXlsxExportEvidenceSchema>;

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

export function operatorXlsxActivityCaveats(document: OperatorXlsxActivityDocument): readonly string[] {
  return Object.freeze([
    ...activityReportCaveats(document.report),
    "This workbook omits every sampled run identifier carried by the served Activity report. Counts remain exact; no full or shortened identifier is substituted.",
    "Every day is a typed spreadsheet date. Duration values are typed milliseconds, and absent medians or longest durations retain their served reason instead of becoming zero.",
  ]);
}
