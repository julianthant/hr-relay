import type { RunRecordService } from "./run-record-service.js";
import { runClaim, type RunRecord } from "../../../models/run/record.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { OcrPageWorkflowInputSchema } from "../../../models/workflows/ocr-page/input.js";
import { OcrInputSchema } from "../../../models/workflows/ocr/input.js";
import { OcrPageReadingSchema } from "../../../models/workflows/ocr/page-accounting.js";
import { PreparedOcrPagesSchema } from "../../../models/workflows/ocr/read-source-pages.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { authenticateDescendantHome } from "../../storage/sqlite/delegation-authority.js";
import { authenticateRootRun } from "../../storage/sqlite/delegation-root-authority.js";
import { AdmittedExtractionSchema } from "../../../models/ocr/extraction.js";
import { taskImplFingerprint } from "../../../workflow-kit/fingerprints.js";
import { ExtractFormPage } from "../../../models/processing/ocr/extract-form-page.js";
import { ReadManualOcrReading } from "../../../models/workflows/ocr-page/read-manual-reading.js";
import { ReadOcrPageReading } from "../../../models/workflows/ocr-page/read-page-reading.js";
import { ReadOcrResult } from "../../../models/workflows/ocr/read-result.js";
import { ReadOcrSourcePages } from "../../../models/workflows/ocr/read-source-pages.js";
import { OcrResultSchema } from "../../../models/workflows/ocr/result.js";
import { publishOcrReview, authenticateOcrOperator } from "./ocr-review-authority.js";
import { taskId } from "../../../rules/identity/ids.js";
import { TaskError } from "../../../workflow-kit/errors.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";

export class OcrPublicationRefusedError extends Error {
  readonly code = "OCR_PUBLICATION_REFUSED";
  constructor() { super("OCR_PUBLICATION_REFUSED"); this.name = "OcrPublicationRefusedError"; }
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function admitOcrRunResources(repositories: AuthorityRepositories, reader: Pick<RunRecordService, "read">, captured: RunRecord): void {
  if (!["ocr", "ocr-page"].includes(captured.envelope.workflow)) return;
  const existence = reader.read(captured.envelope.runId);
  if (existence.state !== "present" || existence.disposition !== "live"
    || !same(existence.run.envelope, captured.envelope) || !same(existence.run.input, captured.input)
    || existence.run.claimGeneration !== captured.claimGeneration || existence.run.cancelRequested === true) throw new OcrPublicationRefusedError();
  const run = existence.run, actor = authenticateOcrOperator(repositories, reader, run);
  const parent = run.envelope.workflow === "ocr" ? existence
    : run.envelope.parent === undefined ? undefined : reader.read(run.envelope.parent.runId);
  if (parent?.state !== "present" || parent.disposition !== "live" || parent.run.envelope.workflow !== "ocr") throw new OcrPublicationRefusedError();
  const request = OcrInputSchema.parse(parent.run.input.parsed.value);
  const upload = repositories.ocrReviews.source(request.document.id);
  if (upload === undefined || !same(upload.artifact, request.document) || upload.uploadedBy !== actor
    || request.sourceRunId !== undefined && request.sourceRunId !== parent.run.envelope.runId
    || request.reading.kind === "manual" && request.reading.actorId !== actor) throw new OcrPublicationRefusedError();
  if (run.envelope.workflow === "ocr-page") {
    const page = OcrPageWorkflowInputSchema.parse(run.input.parsed.value);
    const source = repositories.runCheckpoints.listByAttempt(parent.run.envelope.workflow, parent.run.envelope.itemId,
      "read-source-pages", parent.run.envelope.attempt).filter(row => row.runId === parent.run.envelope.runId).at(-1);
    if (source === undefined || source.contractFingerprint !== parent.run.envelope.contractFingerprint
      || source.output.schemaHash !== deriveSchemaHash(PreparedOcrPagesSchema, "output")
      || PreparedOcrPagesSchema.parse(source.output.value).pages.filter(entry => same(entry, page)).length !== 1
      || page.reading.kind !== request.reading.kind || page.reading.kind === "manual" && page.reading.actorId !== actor) throw new OcrPublicationRefusedError();
  }
}

export function createOcrCheckpointPublication(reader: Pick<RunRecordService, "read">, captured: RunRecord) {
  return (repositories: AuthorityRepositories, checkpoint: RunCheckpointRecord): void => {
    const review = captured.envelope.workflow === "ocr" && checkpoint.nodeId === "read-result";
    if (!review && (captured.envelope.workflow !== "ocr-page"
      || !["read-page-reading", "manual-reading"].includes(checkpoint.nodeId))) return;
    try {
      const read = (runId: string) => {
        const existence = reader.read(runId);
        if (existence.state !== "present" || existence.disposition !== "live") throw new OcrPublicationRefusedError();
        return existence.run;
      };
      const run = read(captured.envelope.runId), claim = runClaim(run), capturedClaim = runClaim(captured);
      admitOcrRunResources(repositories, reader, captured);
      const stored = repositories.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId,
        checkpoint.nodeId, checkpoint.attempt, checkpoint.claimGeneration);
      if (claim === undefined || capturedClaim === undefined || claim.workerId !== capturedClaim.workerId
        || claim.claimGeneration !== capturedClaim.claimGeneration
        || run.lifecycle.state !== "running" || run.cancelRequested === true
        || !same(run.envelope, captured.envelope) || !same(run.input, captured.input)
        || checkpoint.runId !== run.envelope.runId || checkpoint.workflowId !== run.envelope.workflow
        || checkpoint.itemId !== run.envelope.itemId || checkpoint.attempt !== run.envelope.attempt
        || Number(checkpoint.claimGeneration) !== Number(run.claimGeneration) || run.claimGeneration !== captured.claimGeneration
        || checkpoint.descriptorVersion !== run.envelope.descriptorVersion
        || checkpoint.contractFingerprint !== run.envelope.contractFingerprint || stored === undefined || !same(stored, checkpoint)
        || checkpoint.output.schemaHash !== deriveSchemaHash(review ? OcrResultSchema : OcrPageReadingSchema, "output")
        || checkpoint.implFingerprint !== taskImplFingerprint(review ? ReadOcrResult : checkpoint.nodeId === "manual-reading" ? ReadManualOcrReading : ReadOcrPageReading)) throw new OcrPublicationRefusedError();
      if (review) { publishOcrReview(repositories, reader, run, checkpoint); return; }
      const input = OcrPageWorkflowInputSchema.parse(run.input.parsed.value);
      const reading = OcrPageReadingSchema.parse(checkpoint.output.value);
      if (!same(input.page, reading.input) || run.envelope.parent === undefined) throw new OcrPublicationRefusedError();
      const parent = read(run.envelope.parent.runId);
      if (parent.envelope.workflow !== "ocr") throw new OcrPublicationRefusedError();
      const request = OcrInputSchema.parse(parent.input.parsed.value);
      const source = repositories.runCheckpoints.listByAttempt(parent.envelope.workflow, parent.envelope.itemId,
        "read-source-pages", parent.envelope.attempt).filter(row => row.runId === parent.envelope.runId).at(-1);
      if (source === undefined || source.contractFingerprint !== parent.envelope.contractFingerprint
        || source.output.schemaHash !== deriveSchemaHash(PreparedOcrPagesSchema, "output")
        || source.implFingerprint !== taskImplFingerprint(ReadOcrSourcePages)) throw new OcrPublicationRefusedError();
      const prepared = PreparedOcrPagesSchema.parse(source.output.value);
      if (!same(prepared.manifest.document, request.document)
        || prepared.pages.filter(page => same(page, input)).length !== 1) throw new OcrPublicationRefusedError();
      let root = parent;
      const ancestors = new Set<string>();
      while (root.envelope.parent !== undefined) {
        if (ancestors.size >= 16 || ancestors.has(root.envelope.runId)) throw new OcrPublicationRefusedError();
        ancestors.add(root.envelope.runId);
        root = read(root.envelope.parent.runId);
      }
      if (!authenticateDescendantHome(repositories, run, root.envelope.workflow)) throw new OcrPublicationRefusedError();
      const actor = authenticateRootRun(repositories, root).command.requestedBy;
      if (input.reading.kind === "manual") {
        if (checkpoint.nodeId !== "manual-reading" || request.reading.kind !== "manual"
          || request.reading.actorId !== actor || input.reading.actorId !== actor
          || reading.extraction.source.kind !== "operator" || reading.extraction.source.actorId !== actor
          || !same(input.reading.extraction, reading.extraction)) throw new OcrPublicationRefusedError();
      } else if (checkpoint.nodeId !== "read-page-reading" || request.reading.kind !== "subscription"
        || reading.extraction.source.kind !== "provider" || reading.extraction.source.providerId !== "chatgpt-subscription") {
        throw new OcrPublicationRefusedError();
      }
      if (input.reading.kind === "subscription") {
        const extracted = repositories.runCheckpoints.listByAttempt(run.envelope.workflow, run.envelope.itemId,
          "extract", run.envelope.attempt).filter(row => row.runId === run.envelope.runId).at(-1);
        if (extracted === undefined || extracted.contractFingerprint !== run.envelope.contractFingerprint
          || extracted.output.schemaHash !== deriveSchemaHash(AdmittedExtractionSchema, "output")
          || extracted.implFingerprint !== taskImplFingerprint(ExtractFormPage)
          || !same(AdmittedExtractionSchema.parse(extracted.output.value), reading.extraction)) throw new OcrPublicationRefusedError();
      }
      repositories.ocrExtractions.insert(reading);
    } catch (cause) {
      const code = review ? "OCR_REVIEW_REFUSED" : "OCR_PUBLICATION_REFUSED";
      const task = taskId(review ? "workflow:ocr/read-result" : checkpoint.nodeId === "manual-reading"
        ? "workflow:ocr-page/read-manual-reading" : "workflow:ocr-page/read-page-reading");
      throw new TaskError(task, code, ERROR_CATALOG[code].text, { cause });
    }
  };
}
