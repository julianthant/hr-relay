import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { ERROR_CATALOG } from "../../failures/error-catalog.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import { EidSchema, ElementIdSchema, FingerprintSchema, ObservationIdSchema, TaskIdSchema, taskId } from "../../../rules/identity/ids.js";
import { probeVerdictSchema } from "../../../rules/write-safety/write-safety-primitives.js";

export const ONBASE_DOCUMENT_TYPE = "X_HR_Emergency Contact";
export const ONBASE_DOCUMENT_NAME = "EMERGENCY CONTACT INFORMATION";
export const ONBASE_DISPLAYED_EID = ObservationIdSchema.parse("onbase.import.displayed-eid");
export const ONBASE_IMPORT_BUTTON = ElementIdSchema.parse("onbase.import.save");
const text = z.string().trim().min(1);
export const OnbaseInputSchema = z.strictObject({
  ucpathId: EidSchema,
  document: ArtifactRefSchema.extend({ mediaType: z.literal("application/pdf"), bytes: z.number().int().positive().max(50_000_000) }),
  sourcePage: z.number().int().positive(),
  fallback: z.strictObject({ lastName: text.optional(), firstName: text.optional(), middleName: text.optional(), suffix: text.optional(),
    departmentName: text.optional(), departmentCode: text.optional(), viceChancellor: text.optional(), viceChancellorCode: text.optional() }).optional(),
});
export type OnbaseInput = z.output<typeof OnbaseInputSchema>;
export const OnbaseTargetSchema = OnbaseInputSchema.extend({ pageSha256: FingerprintSchema });
export type OnbaseTarget = z.output<typeof OnbaseTargetSchema>;
export const OnbaseKeywordsSchema = z.strictObject({ ucpathId: EidSchema, lastName: text, firstName: text,
  documentName: z.literal(ONBASE_DOCUMENT_NAME), departmentName: text, departmentCode: text, viceChancellor: text, viceChancellorCode: text });
export const OnbasePreparedSchema = z.strictObject({ observedEid: EidSchema, pageSha256: FingerprintSchema, keywords: OnbaseKeywordsSchema });
export type OnbasePrepared = z.output<typeof OnbasePreparedSchema>;
export const OnbaseSavedDocumentSchema = z.strictObject({
  documentId: z.string().regex(/^[1-9]\d*$/u), ucpathId: EidSchema, documentType: z.literal(ONBASE_DOCUMENT_TYPE),
  documentName: z.literal(ONBASE_DOCUMENT_NAME), pageSha256: FingerprintSchema, source: z.literal("retrieval-pdf-read-back"),
});
export type OnbaseSavedDocument = z.output<typeof OnbaseSavedDocumentSchema>;
export const OnbaseImportVerdictSchema = probeVerdictSchema(OnbaseSavedDocumentSchema);
export type OnbaseImportVerdict = z.output<typeof OnbaseImportVerdictSchema>;
export const OnbaseImportOutputSchema = z.strictObject({ savedDocument: OnbaseSavedDocumentSchema });
export const onbaseImportKey = (target: OnbaseTarget): string => `onbase:${target.ucpathId}|emergency-contact|${target.document.sha256}|${target.sourcePage}|${target.pageSha256}`;
export const ONBASE_EXAMPLE_INPUT = OnbaseInputSchema.parse({ ucpathId: "10800000", sourcePage: 1,
  document: { id: "11111111-2222-4333-8444-555555555555", sha256: "1".repeat(64), bytes: 1000, mediaType: "application/pdf" } });
export const ONBASE_EXAMPLE_TARGET = OnbaseTargetSchema.parse({ ...ONBASE_EXAMPLE_INPUT, pageSha256: "2".repeat(64) });
export const ONBASE_EXAMPLE_PROOF = OnbaseSavedDocumentSchema.parse({ documentId: "900001", ucpathId: "10800000", documentType: ONBASE_DOCUMENT_TYPE,
  documentName: ONBASE_DOCUMENT_NAME, pageSha256: "2".repeat(64), source: "retrieval-pdf-read-back" });
const subject = { kind: "person", expected: { fromInput: ContractFieldPathSchema.parse("ucpathId"), identity: "eid" },
  observe: ONBASE_DISPLAYED_EID, match: "normalized-exact-eid", requiredAt: "after-prepare-before-fence" } as const;
const errors = ["ONBASE_IMPORT_UNPROVED"] as const;

export const OnbaseReadSourcePage = defineTaskContract({
  id: taskId("onbase/read-source-page"), title: "Read this person's PDF page", effect: "read", input: OnbaseInputSchema, output: OnbaseTargetSchema,
  errorCodes: errors, subject: { kind: "none", reason: "Reads one explicitly selected local PDF page without inferring a person." },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" }, artifacts: "content-addressed",
  scenarios: ["onbase/one-page", "onbase/invalid-pdf"], example: ONBASE_EXAMPLE_TARGET,
});
export const OnbasePrepareImport = defineTaskContract({
  id: taskId("onbase/stage-import"), title: "Prepare Emergency Contact import", effect: "prepare", input: OnbaseTargetSchema, output: OnbasePreparedSchema,
  errorCodes: errors, subject, checkpoint: "in-memory-only", scenarios: ["onbase/prepare", "onbase/keyset-miss", "onbase/identity-mismatch"],
  example: { observedEid: "10800000", pageSha256: "2".repeat(64), keywords: { ucpathId: "10800000", lastName: "Example", firstName: "Person",
    documentName: ONBASE_DOCUMENT_NAME, departmentName: "Example Department", departmentCode: "000001", viceChancellor: "Example Division", viceChancellorCode: "EX" } },
});
export const OnbaseMatchImport = defineTaskContract({
  id: taskId("onbase/match-import"), title: "Find the exact saved PDF", effect: "read", input: OnbaseTargetSchema, output: OnbaseImportVerdictSchema,
  errorCodes: errors, subject: { kind: "none", reason: "Exact document type and employee keyword filters are verified before accepting any retrieved PDF." },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" }, scenarios: ["onbase/saved-effect", "onbase/unknown"],
  example: { state: "present", proof: ONBASE_EXAMPLE_PROOF },
});
export const OnbaseVerifyImport = defineTaskContract({
  id: taskId("onbase/verify-import"), title: "Verify the imported PDF exists", effect: "read", input: OnbaseTargetSchema, output: OnbaseImportVerdictSchema,
  errorCodes: errors, subject: OnbaseMatchImport.subject, freshness: OnbaseMatchImport.freshness, provenance: OnbaseMatchImport.provenance,
  scenarios: ["onbase/saved-effect", "onbase/unknown"], example: OnbaseMatchImport.example,
});
export const OnbaseCommitImport = defineTaskContract({
  id: taskId("onbase/upload-import"), title: "Import Emergency Contact once", effect: "commit", input: OnbaseTargetSchema, output: OnbaseImportOutputSchema,
  errorCodes: errors, subject, scenarios: ["onbase/committed", "onbase/unknown"],
  writeSafety: {
    completion: { kind: "upload-verify", verify: { taskId: TaskIdSchema.parse("onbase/verify-import"), effect: "read" }, proofSchema: OnbaseSavedDocumentSchema,
      proofFromOutput: (output: z.output<typeof OnbaseImportOutputSchema>) => output.savedDocument,
      proofFromPresentProbe: ({ proof }: { proof: OnbaseSavedDocument }) => proof, outputFromProof: (proof: OnbaseSavedDocument) => ({ savedDocument: proof }) },
    idempotency: { key: onbaseImportKey, probe: { taskId: TaskIdSchema.parse("onbase/match-import"), effect: "read" },
      recoveryAbsence: { kind: "operator-only", reason: "OnBase indexing propagation has no verified negative-settlement interval; UNKNOWN cannot authorize another Import." } },
  }, example: { savedDocument: ONBASE_EXAMPLE_PROOF },
});
export class OnbaseImportError extends Error {
  readonly code = "ONBASE_IMPORT_UNPROVED";
  constructor(readonly reason: string, options?: ErrorOptions) { super(ERROR_CATALOG.ONBASE_IMPORT_UNPROVED.text, options); this.name = "OnbaseImportError"; }
}

export function validateOnbaseImportVerdict(target: OnbaseTarget, input: OnbaseImportVerdict): OnbaseImportVerdict {
  const verdict = OnbaseImportVerdictSchema.parse(input);
  if (verdict.state === "present" && (verdict.proof.ucpathId !== target.ucpathId || verdict.proof.pageSha256 !== target.pageSha256))
    throw new OnbaseImportError("saved-document-target-mismatch");
  return verdict;
}
