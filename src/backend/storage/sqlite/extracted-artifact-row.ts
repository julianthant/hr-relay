import { z } from "zod";
import { AdmittedExtractionSchema } from "../../../models/ocr/extraction.js";
const RowSchema = z.strictObject({ id:z.string(),kind:z.literal("extracted"),workflow:z.null(),source_sha256:z.string(),source_page:z.number().int().positive(),
  form_type:z.string(),page_kind:z.string(),page_fingerprint:z.string(),source_kind:z.string(),session_id:z.null(),manifest_id:z.null(),sink_id:z.null(),export_id:z.null(),
  version:z.literal(1),payload_json:z.string(),created_at:z.string() });
export function extractedArtifactFromRow(input: unknown) {
  const row = RowSchema.parse(input), record = AdmittedExtractionSchema.parse(JSON.parse(row.payload_json));
  if (row.id !== `${record.sourceSha256}#${String(record.sourcePage)}#${record.formType}` || row.source_sha256 !== record.sourceSha256
    || row.source_page !== record.sourcePage || row.form_type !== record.formType || row.page_kind !== record.pageKind
    || row.page_fingerprint !== record.pageFingerprint || row.source_kind !== record.source.kind || row.created_at !== record.readAt) {
    throw new Error("extracted-artifact-row-identity-mismatch");
  }
  return record;
}
