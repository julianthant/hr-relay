import type { z } from "zod";
import { ReadApprovedOcrSnapshot } from "../../../../models/processing/ocr/read-approved-snapshot.js";
import { ApprovedOcrRecordInputSchema } from "../../../../models/workflows/ocr/approved-record.js";
import type { OcrApprovedSnapshot } from "../../../../models/ocr/review.js";
import type { WorkflowRef } from "../../../../models/workflow/graph.js";
import { EidSchema, type BrowserSystemId } from "../../../../rules/identity/ids.js";
import { TaskError } from "../../../../workflow-kit/errors.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
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
export const OCR_SOURCE_PAGES_STEP = Object.freeze({ ...defineWorkflowStep({ key: "source-pages", label: "Prepare source pages" }), system: "local" as const,
  review: {
    pages: [
      {
        id: "source-pdf",
        title: "Source PDF",
        mode: "Read only",
        nodeIds: ["render-pages", "read-source-pages"],
        lines: [
          { id: "render", kind: "action", text: "Render every original PDF page.", nodeIds: ["render-pages"] },
          { id: "source", kind: "check", text: "Check each original page’s form type and reading method.", nodeIds: ["read-source-pages"] }
        ],
        fields: []
      }
    ],
    branchLabels: []
  } as const,
});
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
  const review = task({ id: "build-review", contract: ReadOcrReviewSeed, replay: "always-rerun" }, [source, pages],
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
    sourceRecordIds: ({ outputs }) => ocrPersonLookupRequests(outputs["build-review"]).map(request => request.recordIds),
    deriveChildItemId: (_input, context) => context.canonicalItemId,
  });
  const signers = delegate({
    id: "lookup-signers", label: "Look up official signers",
    target: { id: WorkflowIdSchema.parse("i9-lookup"), input: I9LookupInputSchema, result: I9SignerOutputSchema },
    edgeId: "ocr-signers", cardinality: "many", await: "terminal", join: "all-settled", policy: childPolicy
  }, [review], {
    bind: ({ outputs }) => ocrSignerLookupRequests(outputs["build-review"]).map(request => request.input),
    sourceRecordIds: ({ outputs }) => ocrSignerLookupRequests(outputs["build-review"]).map(request => request.recordIds),
    deriveChildItemId: (_input, context) => context.canonicalItemId,
  });
  const completed = task({ id: "read-result", contract: ReadOcrResult, replay: "always-rerun" }, [review, identities, signers],
    ({ outputs }) => ({ review: outputs["build-review"], outcomes: [...outputs["lookup-identities"], ...outputs["lookup-signers"]] }));
  const approval = gate({ id: "approve-records", label: "Approve selected records", resolvedBy: "operator",
    result: OcrApprovalReferenceSchema, when: { kind: "equals", of: { from: "input", path: "approval" }, value: "release" } }, [completed]);
  return {
    steps: [
      ...sourcePages.steps,
      [{ key: "page-readings", label: "Read document pages", system: "local",
        review: { pages: [], branchLabels: [] } as const,
      }, [pages]],
      [{ key: "review-records", label: "Group records for review", system: "local",
        review: {
          pages: [
            {
              id: "ocr-records",
              title: "OCR records",
              mode: "Read only",
              nodeIds: ["build-review"],
              lines: [{ id: "group", kind: "check", text: "Account for every original page and group its readings into records for review.", nodeIds: ["build-review"] }],
              fields: []
            }
          ],
          branchLabels: []
        } as const,
      }, [review]],
      [{ key: "identity-lookups", label: "Look up proposed identities", system: "ucpath",
        review: { pages: [], branchLabels: [] } as const,
      }, [identities]],
      [{ key: "signer-lookups", label: "Look up official signers", system: "i9",
        review: { pages: [], branchLabels: [] } as const,
      }, [signers, completed]],
      [{ key: "approval", label: "Approve selected records", system: "local",
        review: { pages: [], branchLabels: [] } as const,
      }, [approval]],
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

export function buildApprovedOcrRecords<Input extends z.ZodType, MemberInput extends z.ZodType, MemberResult extends z.ZodType>(
  { delegate, task }: WorkflowAuthor<Input>, options: Readonly<{
    ocrInput(input: z.output<Input>): z.input<typeof OcrInputSchema>;
    target: WorkflowRef<MemberInput, MemberResult>;
    memberSystem: BrowserSystemId;
    memberLabel: string;
    filter(record: OcrApprovedSnapshot["records"][number]): boolean;
    validate(records: readonly OcrApprovedSnapshot["records"][number][]): void;
    memberInput(input: z.output<Input>, approved: z.output<typeof ApprovedOcrRecordInputSchema>): z.input<MemberInput>;
  }>,
) {
  const ocr = delegate({ id: "read-document", label: "Read and approve PDF",
    target: { id: WorkflowIdSchema.parse("ocr"), input: OcrInputSchema, result: OcrWorkflowResultSchema },
    edgeId: "document-ocr", cardinality: "one", await: "terminal", join: "one",
    policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "manual-parent-resume", visibility: "hidden-unless-failed" },
  }, [], { bind: ({ input }) => ({ ...options.ocrInput(input), approval: "release" as const }), deriveChildItemId: (_input, context) => context.canonicalItemId });
  const approved = task({ id: "approved-records", label: "Read approved records", contract: ReadApprovedOcrSnapshot, replay: "always-rerun" }, [ocr], ({ outputs }) => {
    const child = outputs["read-document"];
    if (child.state !== "done" || child.output.approvedSnapshot === null) throw new TaskError(ReadApprovedOcrSnapshot.id, "OCR_REVIEW_REFUSED", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    return child.output.approvedSnapshot;
  });
  const members = delegate({ id: "members", label: options.memberLabel, target: options.target,
    edgeId: "approved-records", cardinality: "many", await: "terminal", join: "all-settled",
    policy: { onChildFailed: "allow-partial", cascadeCancel: "cascade", afterChildRetry: "manual-parent-resume", visibility: "inline" },
  }, [ocr, approved], { bind: ({ input, outputs }) => {
    const reference = outputs["read-document"];
    if (reference.state !== "done" || reference.output.approvedSnapshot === null) throw new TaskError(ReadApprovedOcrSnapshot.id, "OCR_REVIEW_REFUSED", ERROR_CATALOG.OCR_REVIEW_REFUSED.text);
    const records = outputs["approved-records"].snapshot.records.filter(options.filter);
    options.validate(records);
    return records.map(record =>
      options.memberInput(input, ApprovedOcrRecordInputSchema.parse({ approval: reference.output.approvedSnapshot, record })));
  }, sourceRecordIds: ({ outputs }) => outputs["approved-records"].snapshot.records.filter(options.filter).map(record => [record.recordId]),
  deriveChildItemId: (_input, context) => context.canonicalItemId });
  return { ocr, approved, members, steps: [
    [{ key: "read-document", label: "Read and approve PDF", system: "local" }, [ocr, approved]],
    [{ key: "members", label: options.memberLabel, system: options.memberSystem }, [members]],
  ] as const };
}

export function approvedRecordHasEid(record: OcrApprovedSnapshot["records"][number]): boolean {
  return EidSchema.safeParse(record.assertedEid).success;
}
