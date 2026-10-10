/** Frozen v1/v2 contracts: historical evidence and requests retain their original meaning. */
/** Operator XLSX export: a strict, redacted selection document; the workbook composer omits full ids, and the durable run number is the only row label that leaves. */
import { z } from "zod";
import { ArtifactRefSchema } from "../artifacts/artifacts.js";
import {
  ActorIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  NonNegativeIntSchema,
} from "../../rules/identity/ids.js";
import {
  HISTORICAL_CROSS_DATE_SEARCH_ORDER,
  compareHistoricalCrossDateSearchResults,
  HistoricalCrossDateSearchQuerySchema,
  HistoricalCrossDateSearchResultSchema,
  HistoricalCrossDateSearchSnapshotTokenSchema,
} from "./search-history.js";
import { ActivityReportWireSchema } from "./activity.js";

export const HISTORICAL_OPERATOR_XLSX_MEDIA_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

export const HistoricalOperatorXlsxSearchSelectionSchema = z.strictObject({
  kind: z.literal("search"),
  query: HistoricalCrossDateSearchQuerySchema.omit({ cursor: true }),
  snapshot: z.strictObject({
    generatedAt: IsoInstantSchema,
    sourceIdentity: FingerprintSchema,
    authorityGeneration: NonNegativeIntSchema,
    order: z.literal(HISTORICAL_CROSS_DATE_SEARCH_ORDER),
    totalMatches: NonNegativeIntSchema,
  }),
});

export const HistoricalOperatorXlsxSearchDocumentSchema = z.strictObject({
  selection: HistoricalOperatorXlsxSearchSelectionSchema,
  results: z.array(HistoricalCrossDateSearchResultSchema),
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
    const previous = document.results[index - 1];
    if (previous !== undefined && compareHistoricalCrossDateSearchResults(previous, result) > 0) {
      context.addIssue({
        code: "custom",
        path: ["results", index],
        message: `search workbook rows are not ordered by ${HISTORICAL_CROSS_DATE_SEARCH_ORDER}`,
      });
    }
  }
});

export type HistoricalOperatorXlsxSearchDocument = z.infer<typeof HistoricalOperatorXlsxSearchDocumentSchema>;

export const HistoricalOperatorXlsxActivitySelectionSchema = z.strictObject({
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

export const HistoricalOperatorXlsxActivityDocumentSchema = z.strictObject({
  selection: HistoricalOperatorXlsxActivitySelectionSchema,
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
export type HistoricalOperatorXlsxActivityDocument = z.infer<typeof HistoricalOperatorXlsxActivityDocumentSchema>;

export const HistoricalOperatorXlsxWorkbookDocumentSchema = z.union([
  HistoricalOperatorXlsxSearchDocumentSchema,
  HistoricalOperatorXlsxActivityDocumentSchema,
]);
export type HistoricalOperatorXlsxWorkbookDocument = z.infer<typeof HistoricalOperatorXlsxWorkbookDocumentSchema>;

export const HistoricalOperatorXlsxExportIdSchema = z.string().uuid().brand<"HistoricalOperatorXlsxExportId">();

const HistoricalOperatorXlsxSearchExportRequestSelectionSchema = z.strictObject({
    kind: z.literal("search"),
    query: HistoricalCrossDateSearchQuerySchema.omit({ cursor: true }),
    snapshot: z.strictObject({
      authorityGeneration: NonNegativeIntSchema,
      order: z.literal(HISTORICAL_CROSS_DATE_SEARCH_ORDER),
      token: HistoricalCrossDateSearchSnapshotTokenSchema,
    }),
});

const HistoricalOperatorXlsxActivityExportRequestSelectionSchema = z.strictObject({
  kind: z.literal("activity"),
  from: z.iso.date(),
  to: z.iso.date(),
}).refine(
  (selection) => selection.from <= selection.to,
  { path: ["from"], message: "an Activity XLSX selection starts on or before it ends" },
);

export const HistoricalOperatorXlsxExportRequestSchema = z.strictObject({
  selection: z.union([
    HistoricalOperatorXlsxSearchExportRequestSelectionSchema,
    HistoricalOperatorXlsxActivityExportRequestSelectionSchema,
  ]),
});
export type HistoricalOperatorXlsxExportRequest = z.infer<typeof HistoricalOperatorXlsxExportRequestSchema>;

export const HistoricalOperatorXlsxFileNameSchema = z.union([
  z.string().regex(/^hr-run-search-\d{4}-\d{2}-\d{2}-g\d+\.xlsx$/u),
  z.string().regex(/^hr-activity-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/u),
]);

const HistoricalOperatorXlsxSearchFileNameSchema = z.string()
  .regex(/^hr-run-search-\d{4}-\d{2}-\d{2}-g\d+\.xlsx$/u);
const HistoricalOperatorXlsxActivityFileNameSchema = z.string()
  .regex(/^hr-activity-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/u);

function historicalOperatorXlsxDownloadEvidenceSchema<FilenameSchema extends z.ZodType<string>>(
  filename: FilenameSchema,
) {
  return z.strictObject({
  filename,
  mediaType: z.literal(HISTORICAL_OPERATOR_XLSX_MEDIA_TYPE),
  contentDisposition: z.string().min(1),
  byteLength: z.number().int().positive(),
  sha256: FingerprintSchema,
  });
}

const HistoricalOperatorXlsxExportEvidenceBaseFields = {
  exportId: HistoricalOperatorXlsxExportIdSchema,
  createdAt: IsoInstantSchema,
  artifact: ArtifactRefSchema,
} as const;

const HistoricalOperatorXlsxExportEvidenceV1Fields = {
  ...HistoricalOperatorXlsxExportEvidenceBaseFields,
  workbookVersion: z.literal(1),
} as const;

const HistoricalOperatorXlsxExportEvidenceV2Fields = {
  ...HistoricalOperatorXlsxExportEvidenceBaseFields,
  workbookVersion: z.literal(2),
  requestedBy: ActorIdSchema,
} as const;

const HistoricalOperatorXlsxSearchExportEvidenceFields = {
  selection: HistoricalOperatorXlsxSearchSelectionSchema,
  workbook: z.strictObject({
    sheetNames: z.tuple([z.literal("Read Me"), z.literal("Runs")]),
    rowCount: NonNegativeIntSchema,
  }),
  download: historicalOperatorXlsxDownloadEvidenceSchema(HistoricalOperatorXlsxSearchFileNameSchema),
} as const;

function validateOperatorXlsxSearchEvidence(
  evidence: Readonly<{
    selection: z.infer<typeof HistoricalOperatorXlsxSearchSelectionSchema>;
    workbook: Readonly<{ rowCount: number }>;
    artifact: Readonly<{ mediaType: string; bytes: number; sha256: string }>;
    download: Readonly<{
      mediaType: string;
      byteLength: number;
      sha256: string;
      filename: string;
      contentDisposition: string;
    }>;
  }>,
  context: z.RefinementCtx,
): void {
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
}

const HistoricalOperatorXlsxSearchExportEvidenceV1Schema = z.strictObject({
  ...HistoricalOperatorXlsxExportEvidenceV1Fields,
  ...HistoricalOperatorXlsxSearchExportEvidenceFields,
}).superRefine(validateOperatorXlsxSearchEvidence);

const HistoricalOperatorXlsxSearchExportEvidenceV2Schema = z.strictObject({
  ...HistoricalOperatorXlsxExportEvidenceV2Fields,
  ...HistoricalOperatorXlsxSearchExportEvidenceFields,
}).superRefine(validateOperatorXlsxSearchEvidence);

const HistoricalOperatorXlsxActivityExportEvidenceFields = {
  selection: HistoricalOperatorXlsxActivitySelectionSchema,
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
  download: historicalOperatorXlsxDownloadEvidenceSchema(HistoricalOperatorXlsxActivityFileNameSchema),
} as const;

function validateOperatorXlsxActivityEvidence(
  evidence: Readonly<{
    selection: z.infer<typeof HistoricalOperatorXlsxActivitySelectionSchema>;
    workbook: Readonly<{ rowCount: number }>;
    artifact: Readonly<{ mediaType: string; bytes: number; sha256: string }>;
    download: Readonly<{
      mediaType: string;
      byteLength: number;
      sha256: string;
      filename: string;
      contentDisposition: string;
    }>;
  }>,
  context: z.RefinementCtx,
): void {
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
}

const HistoricalOperatorXlsxActivityExportEvidenceV1Schema = z.strictObject({
  ...HistoricalOperatorXlsxExportEvidenceV1Fields,
  ...HistoricalOperatorXlsxActivityExportEvidenceFields,
}).superRefine(validateOperatorXlsxActivityEvidence);

const HistoricalOperatorXlsxActivityExportEvidenceV2Schema = z.strictObject({
  ...HistoricalOperatorXlsxExportEvidenceV2Fields,
  ...HistoricalOperatorXlsxActivityExportEvidenceFields,
}).superRefine(validateOperatorXlsxActivityEvidence);

export const HistoricalOperatorXlsxExportEvidenceSchema = z.union([
  HistoricalOperatorXlsxSearchExportEvidenceV1Schema,
  HistoricalOperatorXlsxSearchExportEvidenceV2Schema,
  HistoricalOperatorXlsxActivityExportEvidenceV1Schema,
  HistoricalOperatorXlsxActivityExportEvidenceV2Schema,
]);
export type HistoricalOperatorXlsxExportEvidence = z.infer<typeof HistoricalOperatorXlsxExportEvidenceSchema>;

export function historicalOperatorXlsxSearchCaveats(document: HistoricalOperatorXlsxSearchDocument): readonly string[] {
  return Object.freeze([
    "This workbook is a snapshot of non-archived run authority for the exact cross-date search selection recorded with the export.",
    `The current measured corpus admits only Separations dry runs; this snapshot contains ${String(document.results.length)} row${document.results.length === 1 ? "" : "s"}.`,
    "Person, run, trace and retry identifiers are omitted. A durable workflow run number is the only row label included in the workbook.",
    "Search text is retained in the export evidence but omitted from workbook cells so an identifier-shaped query cannot become exported data.",
    "Rows retain the authority order: match strength, enqueue instant descending, then run id ascending. The final run-id tie-break is not displayed.",
    "Every instant is a typed spreadsheet date displayed in UTC; partition days remain Pacific calendar dates from the search authority.",
  ]);
}

export function historicalOperatorXlsxActivityCaveats(document: HistoricalOperatorXlsxActivityDocument): readonly string[] {
  const { report } = document;
  const openRunStatement = report.inFlightRuns === 1
    ? "1 run is still open in this range."
    : `${String(report.inFlightRuns)} runs are still open in this range.`;
  return Object.freeze([
    `This workbook covers runs that started between ${report.from} and ${report.to} inclusive. Both bounds are recorded in this file; no default or latest range is used.`,
    "Error rate counts only terminal runs. Open work is excluded from that denominator and retained in its own status counts.",
    `${openRunStatement} Open work contributes only to the workbook totals and buckets that explicitly name it.`,
    "Run totals come from the served non-archived run/queue projection. Archived runs are excluded by that authority before this workbook is composed.",
    "Finished-run warning counts come from evidence receipts. A missing derived receipt remains warnings unread instead of being reported as clean.",
    "The served Activity report carries sampled run identifiers for interactive drill-down. This XLSX exports only each sample's count; every sampled, longest-run and failure-run identifier is omitted without a suffix substitute.",
    "The Ledger sheet is a second authority: it counts what was filed in HR systems and is not derived from run totals. Ledger entries can outlive archived runs.",
    "Every day is a typed spreadsheet date. Duration values are typed milliseconds, and absent medians or longest durations retain their served reason instead of becoming zero.",
  ]);
}
