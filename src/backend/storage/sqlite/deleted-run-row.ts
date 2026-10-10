import { z } from "zod";
import { DeletedRunRecordSchema } from "../../../models/run/deleted-run.js";
import { ArtifactRefSchema } from "../../../models/artifacts/artifacts.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

export const DeletionFileSchema = z.strictObject({
  ref: ArtifactRefSchema,
  disposition: z.enum(["remove", "retain"]),
  storedSha256: FingerprintSchema,
  storedBytes: z.number().int().nonnegative(),
});
export const DeletionFilesSchema = z.array(DeletionFileSchema).superRefine((files, context) => {
  if (new Set(files.map(file => file.ref.sha256)).size !== files.length) context.addIssue({ code: "custom", message: "deletion file digests must be unique" });
});
const RowSchema = z.strictObject({
  run_id: z.string(), workflow: z.string(), item_id: z.string(), attempt: z.number(), run_number: z.number().nullable(),
  trace_id: z.string(), command_id: z.string(), deleted_at: z.string(), cleanup_state: z.enum(["pending", "complete"]),
  receipt_json: z.string(), files_json: z.string(),
});
export function deletedRunFromRow(input: unknown) {
  const row = RowSchema.parse(input);
  const receipt = DeletedRunRecordSchema.parse(JSON.parse(row.receipt_json));
  const files = DeletionFilesSchema.parse(JSON.parse(row.files_json));
  const expected = {run_id:receipt.runId,workflow:receipt.workflow,item_id:receipt.itemId,attempt:receipt.attempt,
    run_number:receipt.runNumber,trace_id:receipt.traceId,command_id:receipt.commandId,deleted_at:receipt.deletedAt};
  for (const [key,value] of Object.entries(expected)) if (Reflect.get(row,key) !== value) throw new Error(`deleted-run-row-${key}-mismatch`);
  if (canonicalJsonStringify(receipt.removed.map(entry => entry.table)) !== canonicalJsonStringify([...new Set(receipt.removed.map(entry => entry.table))])) throw new Error("deleted-run-tally-duplicate");
  return {receipt,files,cleanupState:row.cleanup_state};
}
