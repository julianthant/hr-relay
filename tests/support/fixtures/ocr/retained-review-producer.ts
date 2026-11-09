import { z } from "zod";
import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { OcrInputSchema, OCR_INPUT_EXAMPLE } from "../../../../src/models/workflows/ocr/input.js";
import { OcrReviewSeedSchema } from "../../../../src/models/workflows/ocr/review-seed.js";
import { RosterRowFactsSchema } from "../../../../src/rules/matching/roster-match.js";
import { IsoInstantSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { OcrPersonLookupRequestSchema, ocrPersonLookupRequests, bindOcrLookupOutcomes } from "../../../../src/models/workflows/ocr/lookup.js";
import { childRunOutcomeSchema } from "../../../../src/models/workflow/graph.js";
import { PersonLookupInput } from "../../../../src/models/workflows/person-lookup/input.js";
import { PersonLookupResultSchema } from "../../../../src/models/workflows/person-lookup/result.js";
import { ReadOcrResult } from "../../../../src/models/workflows/ocr/read-result.js";
import { ReadOcrReviewSeed } from "../../../../src/models/workflows/ocr/read-review-seed.js";
import { ReadOcrSourcePages, ocrPageWorkInputs } from "../../../../src/models/workflows/ocr/read-source-pages.js";
import { buildOcrSourceManifest } from "../../../../src/models/workflows/ocr/source-manifest.js";
import { OcrPageWorkflowInputSchema } from "../../../../src/models/workflows/ocr-page/input.js";
import { OcrPageReadingSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { OcrApprovalReferenceSchema } from "../../../../src/models/workflows/ocr/result.js";
import { ExtractPdfPages } from "../../../../src/models/processing/extraction/extract-pdf-pages.js";
import { OcrReviewRevisionSchema, initialOcrReviewRecords } from "../../../../src/models/ocr/review.js";
import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { defineTaskContract } from "../../../../src/models/task/task-contract.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { defineWorkflow, compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { defineTask } from "../../../../src/workflow-kit/task.js";
import { defineWorkflowStore } from "../../../../src/workflow-kit/task-registry.js";
import { readOcrReviewSeedTask } from "../../../../src/workflows/ocr/tasks/read-review-seed.js";
import { readOcrSourcePagesTask } from "../../../../src/workflows/ocr/tasks/read-source-pages.js";
import { checkpointRecordKey } from "../../../../src/models/workflow/checkpoint.js";
import { timelineCheckpointReference } from "../../../../src/models/events/timeline.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { authenticateOcrOperator } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { createOcrCheckpointPublication } from "../../../../src/backend/runs/lifecycle/ocr-checkpoint-publication.js";
import type { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import type { RunRecord } from "../../../../src/models/run/record.js";
import { readDelegationEvidence } from "../../../../src/backend/storage/sqlite/delegation-authority.js";
import { delegationEvidenceOutput } from "../../../../src/models/run/result.js";

const retainedRoster = z.strictObject({ artifact: ArtifactRefSchema, readAt: IsoInstantSchema, rows: z.array(RosterRowFactsSchema) });
const retainedInput = OcrInputSchema.extend({ roster: retainedRoster.nullable() });
const retainedSeed = OcrReviewSeedSchema.safeExtend({ roster: retainedRoster.nullable() });
export const RetainedOcrResultSchema = z.strictObject({ review: retainedSeed,
  identities: z.array(OcrPersonLookupRequestSchema.extend({ outcome: childRunOutcomeSchema(PersonLookupResultSchema) })) });
const { __sealed: _resultSeal, ...resultSpec } = ReadOcrResult;
const { __sealed: _reviewSeal, ...reviewSpec } = ReadOcrReviewSeed;
const { __sealed: _sourceSeal, ...sourceSpec } = ReadOcrSourcePages;
const resultContract = defineTaskContract({ ...resultSpec, input: z.strictObject({ review: retainedSeed,
  outcomes: z.array(childRunOutcomeSchema(PersonLookupResultSchema)) }), output: RetainedOcrResultSchema,
  example: RetainedOcrResultSchema.parse(ReadOcrResult.example) });
const reviewContract = defineTaskContract({ ...reviewSpec,
  input: ReadOcrReviewSeed.input.extend({ roster: retainedRoster.nullable() }), output: retainedSeed,
  example: retainedSeed.parse(ReadOcrReviewSeed.example) });
const sourceContract = defineTaskContract({ ...sourceSpec,
  input: ReadOcrSourcePages.input.extend({ request: retainedInput }) });

export const retainedOcrStore = defineWorkflowStore("ocr", {
  readSourcePages: defineTask(sourceContract, { sessions: [], async run({ input, ctx }) {
    return readOcrSourcePagesTask.impl.run({ input: ReadOcrSourcePages.input.parse(input), ctx });
  } }),
  readReviewSeed: defineTask(reviewContract, { sessions: [], async run({ input, ctx }) {
    return retainedSeed.parse(await readOcrReviewSeedTask.impl.run({ input, ctx }));
  } }),
  readResult: defineTask(resultContract, { sessions: [], async run({ input, ctx }) {
    const output = RetainedOcrResultSchema.parse({ review: input.review, identities: bindOcrLookupOutcomes(input.review, input.outcomes) });
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  } }),
});
const policy = { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } as const;
const definition = defineWorkflow({
  id: "ocr", requiredWorkbookTypeIds: [], version: 1, code: "oc", label: "OCR", icon: "FileScan", category: "documents",
  summary: "Reads every original page, groups records and retains identity lookup outcomes for review.",
  input: retainedInput, canonicalInput: defineCanonicalInput(retainedInput,
    retainedInput.extend({ approval: retainedInput.shape.approval.removeDefault() }), [retainedInput.parse({ ...OCR_INPUT_EXAMPLE, roster: null })]),
  inputSubject: "document", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  capabilities: { review: true, editData: false }, verdicts: [], details: [], surfaces: {},
  role: defineWorkflowRole({ kind: "composition" }),
  identity: { matchKey: input => `${input.document.sha256}:${input.formType}:${input.readingId}` },
  presentation: { title: input => input.formType, subtitle: () => "OCR document review" },
  scenarios: ["ocr/multi-page", "ocr/manual", "ocr/page-failure", "ocr/unresolved-identity"],
  steps: ({ task, delegate, gate, result }) => {
    const rendered = task({ id: "render-pages", contract: ExtractPdfPages, replay: "checkpoint" }, [], ({ input }) => ({ document: input.document }));
    const source = task({ id: "read-source-pages", contract: sourceContract, replay: "checkpoint" }, [rendered],
      ({ input, outputs }) => ({ request: input, rendered: outputs["render-pages"] }));
    const pages = delegate({ id: "read-pages", label: "Read every original page",
      target: { id: WorkflowIdSchema.parse("ocr-page"), input: OcrPageWorkflowInputSchema, result: OcrPageReadingSchema },
      edgeId: "ocr-pages", cardinality: "many", await: "terminal", join: "all-settled", policy }, [rendered, source], {
      bind: ({ input, outputs }) => ocrPageWorkInputs(input, outputs["render-pages"]).pages, deriveChildItemId: (_input, context) => context.canonicalItemId,
    });
    const review = task({ id: "build-review", contract: reviewContract, replay: "checkpoint" }, [rendered, source, pages],
      ({ input, outputs }) => ({ ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }), roster: input.roster,
        formType: input.formType, manifest: buildOcrSourceManifest(input.document, outputs["render-pages"]), readingId: input.readingId, outcomes: [...outputs["read-pages"]] }));
    const identities = delegate({ id: "lookup-identities", label: "Verify proposed identities",
      target: { id: WorkflowIdSchema.parse("person-lookup"), input: PersonLookupInput, result: PersonLookupResultSchema },
      edgeId: "ocr-identities", cardinality: "many", await: "terminal", join: "all-settled", policy }, [review], {
      bind: ({ outputs }) => ocrPersonLookupRequests(outputs["build-review"]).map(request => request.input),
      deriveChildItemId: (_input, context) => context.canonicalItemId,
    });
    const completed = task({ id: "read-result", contract: resultContract, replay: "checkpoint" }, [review, identities],
      ({ outputs }) => ({ review: outputs["build-review"], outcomes: [...outputs["lookup-identities"]] }));
    const approval = gate({ id: "approve-records", label: "Approve selected records", resolvedBy: "operator", result: OcrApprovalReferenceSchema,
      when: { kind: "equals", of: { from: "input", path: "approval" }, value: "release" } }, [completed]);
    return { steps: [
      [{ key: "source-pages", label: "Prepare source pages", system: "local" }, [rendered, source]],
      [{ key: "page-readings", label: "Read document pages", system: "local" }, [pages]],
      [{ key: "review-records", label: "Group records for review", system: "local" }, [review]],
      [{ key: "identity-lookups", label: "Look up proposed identities", system: "ucpath" }, [identities, completed]],
      [{ key: "approval", label: "Approve selected records", system: "local" }, [approval]],
    ], result: result(RetainedOcrResultSchema.extend({ approvedSnapshot: OcrApprovalReferenceSchema.nullable() }), [completed, approval],
      ({ outputs }) => ({ ...outputs["read-result"], approvedSnapshot: outputs["approve-records"] ?? null })) };
  },
});
export const retainedOcrModule = compileWorkflow(definition);

export function retainedOcrCheckpointPublication(reader: Pick<RunRecordService, "read">, captured: RunRecord,
  resolve: Parameters<typeof createOcrCheckpointPublication>[2]) {
  const current = createOcrCheckpointPublication(reader, captured, resolve);
  return (repositories: Parameters<ReturnType<typeof createOcrCheckpointPublication>>[0], checkpoint: Parameters<ReturnType<typeof createOcrCheckpointPublication>>[1]) => {
    if (captured.envelope.workflow !== "ocr" || checkpoint.nodeId !== "read-result") return current(repositories, checkpoint);
    if (checkpoint.output.schemaHash !== deriveSchemaHash(RetainedOcrResultSchema, "output")) throw new Error("retained-producer-schema-mismatch");
    const seed = RetainedOcrResultSchema.parse(checkpoint.output.value);
    const same = (left: unknown, right: unknown) => canonicalJsonStringify(left) === canonicalJsonStringify(right);
    if (seed.review.sourceRunId !== undefined && seed.review.sourceRunId !== captured.envelope.runId) throw new Error("retained-producer-run-mismatch");
    const pages = readDelegationEvidence(repositories, captured.envelope.runId, "read-pages");
    const identities = readDelegationEvidence(repositories, captured.envelope.runId, "lookup-identities");
    if (!same(delegationEvidenceOutput(pages, OcrPageReadingSchema), seed.review.accounting.outcomes)
      || !same(delegationEvidenceOutput(identities, PersonLookupResultSchema), seed.identities.map(entry => entry.outcome))) {
      throw new Error("retained-producer-membership-mismatch");
    }
    for (const outcome of seed.review.accounting.outcomes) {
      if (outcome.state !== "done") continue;
      const stored = repositories.ocrExtractions.get(outcome.output.extractionId);
      if (stored === undefined || stored.binding !== "source-bound" || !same({ ...outcome.output, binding: "source-bound" }, stored)) {
        throw new Error("retained-producer-extraction-mismatch");
      }
    }
    repositories.ocrReviews.append(OcrReviewRevisionSchema.parse({ id: `${captured.envelope.runId}#1`, sourceRunId: captured.envelope.runId,
      revision: 1, seed, records: initialOcrReviewRecords(seed), actorId: authenticateOcrOperator(repositories, reader, captured),
      origin: { kind: "checkpoint", key: checkpointRecordKey(checkpoint), digest: sha256Hex(canonicalJsonStringify(checkpoint)),
        checkpoint: timelineCheckpointReference(checkpoint) }, createdAt: checkpoint.writtenAt }), 0);
  };
}
