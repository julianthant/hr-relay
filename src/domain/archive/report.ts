import { ArchiveVersionChangeSchema } from "./change-record.js";
import { z } from "zod";
import { FingerprintSchema, IsoInstantSchema, RunIdSchema } from "../ids.js";
import { canonicalJsonStringify } from "../canonical-json.js";
import { sha256Hex } from "../sha256.js";

const CellSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
export const ArchiveReportSectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("values"), title: z.string().min(1), values: z.array(z.strictObject({ label: z.string().min(1), value: CellSchema })) }),
  z.strictObject({ kind: z.literal("table"), title: z.string().min(1), columns: z.array(z.string().min(1)).min(1), rows: z.array(z.array(CellSchema)) })
    .refine((section) => section.rows.every((row) => row.length === section.columns.length), "archive-table-width-mismatch"),
  z.strictObject({ kind: z.literal("text"), title: z.string().min(1), text: z.string() }),
  z.strictObject({ kind: z.literal("unavailable"), title: z.string().min(1), reason: z.string().min(1) }),
]);
export const ArchiveFileReferenceSchema = z.strictObject({
  digest: FingerprintSchema, byteLength: z.number().int().nonnegative(), mediaType: z.string().min(1),
  name: z.string().min(1), artifactIds:z.array(z.string().uuid()).optional(),
});
/** Generic display content has no dependency on a current workflow or source parser. */
export const ArchiveReportContentSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: RunIdSchema, transferId: z.string().uuid(),
  workflow: z.string().min(1), itemId: z.string().min(1), attempt: z.number().int().positive(),
  runNumber: z.number().int().positive().nullable(), title: z.string().min(1), descriptorVersion: z.string().min(1),
  outcome: z.enum(["done", "failed", "cancelled", "discarded", "interrupted", "superseded"]),
  completedAt: IsoInstantSchema, capturedAt: IsoInstantSchema,
  sourceDigest: FingerprintSchema,
  versionChange: ArchiveVersionChangeSchema.optional(),
  sources: z.array(z.strictObject({ kind: z.string().min(1), digest: FingerprintSchema, json: z.string().min(1) })),
  sections: z.array(ArchiveReportSectionSchema), files: z.array(ArchiveFileReferenceSchema),
}).superRefine((report, context) => {
  for (const source of report.sources) {
    if (sha256Hex(source.json) !== source.digest) context.addIssue({ code: "custom", message: "archive-source-digest-mismatch" });
    try { JSON.parse(source.json); } catch { context.addIssue({ code: "custom", message: "archive-source-json-invalid" }); }
  }
  if (new Set(report.sources.map((source) => source.kind)).size !== report.sources.length) context.addIssue({ code: "custom", message: "archive-source-kind-duplicate" });
  if (new Set(report.files.map((file) => file.digest)).size !== report.files.length) context.addIssue({ code: "custom", message: "archive-file-duplicate" });
});
export const ArchiveReportSchema = z.strictObject({ content: ArchiveReportContentSchema, digest: FingerprintSchema })
  .refine((report) => sha256Hex(canonicalJsonStringify(report.content)) === report.digest, "archive-report-digest-mismatch");
export type ArchiveReport = z.infer<typeof ArchiveReportSchema>;
export function sealArchiveReport(input: z.input<typeof ArchiveReportContentSchema>): ArchiveReport {
  const content = ArchiveReportContentSchema.parse(input);
  return ArchiveReportSchema.parse({ content, digest: sha256Hex(canonicalJsonStringify(content)) });
}

export const ArchiveQuerySchema=z.strictObject({workflow:z.string().min(1),limit:z.number().int().min(1).max(500),
  title:z.string().optional(),capturedFrom:z.string().datetime().optional(),capturedTo:z.string().datetime().optional(),
  from:z.string().datetime().optional(),to:z.string().datetime().optional(),descriptorVersion:z.string().optional(),outcome:z.string().optional(),
  after:z.strictObject({completedAt:z.string().datetime(),runId:RunIdSchema}).optional()});
export type ArchiveQuery=z.infer<typeof ArchiveQuerySchema>;
