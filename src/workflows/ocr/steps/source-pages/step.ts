import { ExtractPdfPages } from "../../../../models/processing/extraction/extract-pdf-pages.js";
import { OcrPageWorkflowInputSchema } from "../../../../models/workflows/ocr-page/input.js";
import { OcrInputSchema } from "../../../../models/workflows/ocr/input.js";
import { ocrPersonLookupRequests, ocrSignerLookupRequests } from "../../../../models/workflows/ocr/lookup.js";
import { I9LookupInputSchema, I9SignerOutputSchema } from "../../../../models/systems/i9/read-section2-signer.js";
import { OcrPageReadingSchema } from "../../../../models/workflows/ocr/page-accounting.js";
import { ReadOcrResult } from "../../../../models/workflows/ocr/read-result.js";
import { ReadOcrReviewSeed } from "../../../../models/workflows/ocr/read-review-seed.js";
import { ReadOcrSourcePages } from "../../../../models/workflows/ocr/read-source-pages.js";
import { OcrApprovalReferenceSchema, OcrWorkflowResultSchema } from "../../../../models/workflows/ocr/result.js";
import { PersonLookupInput } from "../../../../models/workflows/person-lookup/input.js";
import { PersonLookupResultSchema } from "../../../../models/workflows/person-lookup/result.js";
import { WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
const childPolicy = Object.freeze({
  onChildFailed: "allow-partial", cascadeCancel: "cascade",
  afterChildRetry: "resume-parent", visibility: "inline"
} as const);
export const OCR_SOURCE_PAGES_STEP = Object.freeze({ ...defineWorkflowStep({ key: "source-pages", label: "Prepare source pages" }), system: "local" as const });
export function buildSourcePages({ task, result }: WorkflowAuthor<typeof OcrInputSchema>) {
  const rendered = task({ id: "render-pages", contract: ExtractPdfPages, replay: "checkpoint" }, [], ({ input }) => ({ document: input.document }));
  const source = task({ id: "read-source-pages", contract: ReadOcrSourcePages, replay: "checkpoint" }, [rendered],
    ({ input, outputs }) => ({ request: input, rendered: outputs["render-pages"] }));
  return {
    rendered, source, steps: [[OCR_SOURCE_PAGES_STEP, [rendered, source]]] as const,
    result: result(ReadOcrSourcePages.output, [source], ({ outputs }) => ReadOcrSourcePages.output.parse(outputs["read-source-pages"]))
  };
}
export function buildOcr(author: WorkflowAuthor<typeof OcrInputSchema>) {
  const { task, delegate, gate, result } = author;
  const sourcePages = buildSourcePages(author);
  const { source } = sourcePages;
  const pages = delegate({
    id: "read-pages", label: "Read every original page",
    target: { id: WorkflowIdSchema.parse("ocr-page"), input: OcrPageWorkflowInputSchema, result: OcrPageReadingSchema },
    edgeId: "ocr-pages", cardinality: "many", await: "terminal", join: "all-settled",
    policy: { ...childPolicy, visibility: "hidden-unless-failed" }
  }, [source], {
    bind: ({ outputs }) => outputs["read-source-pages"].pages,
    deriveChildItemId: (_input, context) => context.canonicalItemId,
  });
  const review = task({ id: "build-review", contract: ReadOcrReviewSeed, replay: "checkpoint" }, [source, pages],
    ({ input, outputs }) => ({
      ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }), roster: input.roster, formType: input.formType,
      manifest: outputs["read-source-pages"].manifest, readingId: input.readingId, outcomes: [...outputs["read-pages"]]
    }));
  const identities = delegate({
    id: "lookup-identities", label: "Verify proposed identities",
    target: { id: WorkflowIdSchema.parse("person-lookup"), input: PersonLookupInput, result: PersonLookupResultSchema },
    edgeId: "ocr-identities", cardinality: "many", await: "terminal", join: "all-settled", policy: childPolicy
  }, [review], {
    bind: ({ outputs }) => ocrPersonLookupRequests(outputs["build-review"]).map(request => request.input),
    deriveChildItemId: (_input, context) => context.canonicalItemId,
  });
  const signers = delegate({
    id: "lookup-signers", label: "Look up official signers",
    target: { id: WorkflowIdSchema.parse("i9-lookup"), input: I9LookupInputSchema, result: I9SignerOutputSchema },
    edgeId: "ocr-signers", cardinality: "many", await: "terminal", join: "all-settled", policy: childPolicy
  }, [review, identities], {
    bind: ({ outputs }) => ocrSignerLookupRequests(outputs["build-review"]).map(request => request.input),
    deriveChildItemId: (_input, context) => context.canonicalItemId,
  });
  const completed = task({ id: "read-result", contract: ReadOcrResult, replay: "checkpoint" }, [review, identities, signers],
    ({ outputs }) => ({ review: outputs["build-review"], outcomes: [...outputs["lookup-identities"], ...outputs["lookup-signers"]] }));
  const approval = gate({ id: "approve-records", label: "Approve selected records", resolvedBy: "operator",
    result: OcrApprovalReferenceSchema, when: { kind: "equals", of: { from: "input", path: "approval" }, value: "release" } }, [completed]);
  return {
    steps: [
      ...sourcePages.steps,
      [{ key: "page-readings", label: "Read document pages", system: "local" }, [pages]],
      [{ key: "review-records", label: "Group records for review", system: "local" }, [review]],
      [{ key: "identity-lookups", label: "Look up proposed identities", system: "ucpath" }, [identities]],
      [{ key: "signer-lookups", label: "Look up official signers", system: "i9" }, [signers, completed]],
      [{ key: "approval", label: "Approve selected records", system: "local" }, [approval]],
    ] as const, result: result(OcrWorkflowResultSchema, [completed, approval], ({ outputs }) => ({
      ...outputs["read-result"], approvedSnapshot: outputs["approve-records"] ?? null,
    }))
  };
}
export const ocrSourcePagesDefinition = defineStep({
  group: OCR_SOURCE_PAGES_STEP, build: buildOcr,
  proof: {
    id: "ocr-source-pages", order: 19,
    build: (parent: WorkflowDefinition<typeof OcrInputSchema>) => ({
      ...inheritStepProof(parent),
      code: "os", label: "OCR source pages", summary: "Proves complete source-page rendering and manual source bindings.", steps: buildSourcePages,
    }),
  },
});
