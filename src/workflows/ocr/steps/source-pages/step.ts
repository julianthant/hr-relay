import { z } from "zod";
import { ReadApprovedOcrSnapshot } from "../../../../models/processing/ocr/read-approved-snapshot.js";
import { ApprovedOcrRecordInputSchema } from "../../../../models/workflows/ocr/approved-record.js";
import type { OcrApprovedSnapshot } from "../../../../models/ocr/review.js";
import type { WorkflowRef } from "../../../../models/workflow/graph.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { EidSchema, type BrowserSystemId } from "../../../../rules/identity/ids.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { TaskError } from "../../../../workflow-kit/errors.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { ExtractPdfPages, PDF_PAGE_LIMIT } from "../../../../models/processing/extraction/extract-pdf-pages.js";
import { admitManualOcrPageValues, OcrPageWorkflowInputSchema, parseManualOcrDocumentValues } from "../../../../models/workflows/ocr-page/input.js";
import { OcrInputSchema } from "../../../../models/workflows/ocr/input.js";
import { ocrPersonLookupRequests, ocrSignerLookupRequests } from "../../../../models/workflows/ocr/lookup.js";
import { I9LookupInputSchema, I9SignerOutputSchema } from "../../../../models/systems/i9/read-section2-signer.js";
import { OcrPageReadingSchema, type OcrPageOutcome, type OcrPageReading } from "../../../../models/workflows/ocr/page-accounting.js";
import { ReadOcrResult } from "../../../../models/workflows/ocr/read-result.js";
import { ReadOcrReviewSeed } from "../../../../models/workflows/ocr/read-review-seed.js";
import { ReadOcrSourcePages, ocrPageWorkInputs } from "../../../../models/workflows/ocr/read-source-pages.js";
import { buildOcrSourceManifest } from "../../../../models/workflows/ocr/source-manifest.js";
import { hydrateOcrReviewSeed, type OcrReviewCheckpoint } from "../../../../models/workflows/ocr/review-seed.js";
import { OcrApprovalReferenceSchema, OcrReviewedResultSchema, OcrWorkflowResultSchema } from "../../../../models/workflows/ocr/result.js";
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
const DOCUMENT_VALUES = { off: "values", allowsChildFanOut: true } as const;

const SOURCE_COUNT: StepManualDeclaration = {
  ...DOCUMENT_VALUES,
  form: { fields: [{ key: "pageCount", label: "Original page count", kind: "integer", min: 1,
    help: "Relay renders the PDF to verify the count and bind the original pages." }] },
  produces: {}, keeps: ["render-pages", "read-source-pages"],
  refine: ({ pageCount }) => typeof pageCount === "number" && pageCount <= PDF_PAGE_LIMIT ? []
    : [{ field: "pageCount", message: `Enter a page count from 1 through ${PDF_PAGE_LIMIT}.` }],
  bindInput: (input, { pageCount }) => JsonValueSchema.parse(OcrInputSchema.parse({ ...OcrInputSchema.parse(input), assertedPageCount: pageCount })),
};

const MANUAL_PAGE_READINGS: StepManualDeclaration = {
  ...DOCUMENT_VALUES,
  form: { fields: [{ key: "readings", label: "Original page readings", kind: "text-list", format: "ocr-document-readings", withheld: true,
    help: "Enter one JSON reading per line with sourcePage, pageKind, readAt (ISO time) and record. Use an answers list of path and answer pairs, or null for a non-form page." }] },
  produces: {}, keeps: ["read-pages"],
  refine: ({ readings }, submission) => {
    if (submission === undefined) return [];
    const { formType, document } = OcrInputSchema.parse(submission);
    try {
      for (const { sourcePage, values } of parseManualOcrDocumentValues(z.array(z.string()).parse(readings))) {
        admitManualOcrPageValues(formType, sourcePage, document.sha256, "local-operator", values);
      }
      return [];
    } catch {
      return [{ field: "readings", message: "Enter a valid reading for the selected form on each original page." }];
    }
  },
  bindInput: (input, { readings }) => JsonValueSchema.parse(OcrInputSchema.parse({ ...OcrInputSchema.parse(input), extractWithOcr: true,
    reading: { kind: "manual", actorId: "local-operator", assertions: parseManualOcrDocumentValues(z.array(z.string()).parse(readings)) } })),
  withholdsBoundInput: input => OcrInputSchema.safeParse(input).data?.reading.kind === "manual",
};

const WITHHOLD_RELEASE: StepManualDeclaration = {
  ...DOCUMENT_VALUES,
  form: { fields: [{ key: "release", label: "Record release", kind: "enum", values: ["withhold"] }] },
  produces: {}, skips: ["approve-records"], skipsGatesAndTransactions: true,
};

function leaveUnread(label: string, skips: readonly string[]): StepManualDeclaration {
  return { ...DOCUMENT_VALUES, form: { fields: [{ key: "outcome", label, kind: "enum", values: ["leave unverified"] }] },
    produces: {}, skips };
}

const UNGROUPED_RECORDS = leaveUnread("Record grouping", ["build-review"]);
const UNVERIFIED_IDENTITIES = leaveUnread("Identity verification", ["lookup-identities"]);
const UNVERIFIED_SIGNERS = leaveUnread("Signer verification", ["lookup-signers", "read-result"]);
function reviewSeed(input: z.output<typeof OcrInputSchema>,
  outputs: Readonly<{ "build-review": OcrReviewCheckpoint; "read-pages": readonly OcrPageOutcome[] }>) {
  const readings = new Map<string, OcrPageReading>(outputs["read-pages"].flatMap(page => page.state === "done" ? [[page.output.extractionId, page.output] as const] : []));
  return hydrateOcrReviewSeed(outputs["build-review"], extractionId => readings.get(extractionId), input.roster);
}
export const OCR_SOURCE_PAGES_STEP = Object.freeze({ ...defineWorkflowStep({ key: "source-pages", label: "Prepare source pages" }), system: "local" as const,
  description: "Render every original PDF page and bind each page's form type and reading method to the source manifest.",
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
        fields: [
          { id: "pdf", label: "PDF", inputField: "fileName", example: "Fictional emergency-contact.pdf",
            source: { origin: "PDF upload", detail: "The original PDF supplied by the parent run.", chain: [] } },
          { id: "pages", label: "Pages", taskFields: [{ nodeId: "read-source-pages", kind: "output", fieldPath: "manifest.pageCount" }],
            source: { origin: "Original PDF", detail: "The number of original pages verified before any reading starts.", chain: [] } },
        ]
      }
    ],
    branchLabels: []
  } as const,
});
export function buildSourcePages({ group, task, result }: WorkflowAuthor<typeof OcrInputSchema>) {
  const rendered = task({ id: "render-pages", contract: ExtractPdfPages, replay: "checkpoint" }, [], ({ input }) => ({ document: input.document }));
  const source = task({ id: "read-source-pages", contract: ReadOcrSourcePages, replay: "checkpoint" }, [rendered],
    ({ input, outputs }) => ({ request: input, rendered: outputs["render-pages"] }));
  return {
    rendered, source, steps: [[group(OCR_SOURCE_PAGES_STEP, { manual: SOURCE_COUNT }), [rendered, source]]] as const,
    result: result(ReadOcrSourcePages.output, [source], ({ outputs }) => ReadOcrSourcePages.output.parse(outputs["read-source-pages"]))
  };
}
export function buildOcr(author: WorkflowAuthor<typeof OcrInputSchema>) {
  const { task, delegate, gate, group, result } = author;
  const sourcePages = buildSourcePages(author);
  const { rendered, source } = sourcePages;
  const pages = delegate({
    id: "read-pages", label: "Read every original page",
    target: { id: WorkflowIdSchema.parse("ocr-page"), input: OcrPageWorkflowInputSchema, result: OcrPageReadingSchema },
    edgeId: "ocr-pages", cardinality: "many", await: "terminal", join: "all-settled",
    policy: { ...childPolicy, visibility: "hidden-unless-failed" }
  }, [rendered, source], {
    bind: ({ input, outputs }) => {
      const work = ocrPageWorkInputs(input, outputs["render-pages"]);
      if (work.manifest.fingerprint !== outputs["read-source-pages"].manifest.fingerprint) throw new Error("OCR source pages changed after they were bound.");
      return work.pages;
    },
    deriveChildItemId: (_input, context) => context.canonicalItemId,
  });
  const review = task({ id: "build-review", contract: ReadOcrReviewSeed, replay: "always-rerun" }, [rendered, source, pages],
    ({ input, outputs }) => ({
      ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }), roster: input.roster, formType: input.formType,
      ...(input.extractWithOcr === undefined ? {} : { extractWithOcr: input.extractWithOcr }),
      manifest: buildOcrSourceManifest(input.document, outputs["render-pages"]), readingId: input.readingId, outcomes: [...outputs["read-pages"]]
    }));
  const identities = delegate({
    id: "lookup-identities", label: "Verify proposed identities",
    target: { id: WorkflowIdSchema.parse("person-lookup"), input: PersonLookupInput, result: PersonLookupResultSchema },
    edgeId: "ocr-identities", cardinality: "many", await: "terminal", join: "all-settled", policy: childPolicy
  }, [review, pages], {
    bind: ({ input, outputs }) => ocrPersonLookupRequests(reviewSeed(input, outputs)).map(request => request.input),
    sourceRecordIds: ({ input, outputs }) => ocrPersonLookupRequests(reviewSeed(input, outputs)).map(request => request.recordIds),
    deriveChildItemId: (_input, context) => context.canonicalItemId,
  });
  const signers = delegate({
    id: "lookup-signers", label: "Look up official signers",
    target: { id: WorkflowIdSchema.parse("i9-lookup"), input: I9LookupInputSchema, result: I9SignerOutputSchema },
    edgeId: "ocr-signers", cardinality: "many", await: "terminal", join: "all-settled", policy: childPolicy
  }, [review, pages], {
    bind: ({ input, outputs }) => ocrSignerLookupRequests(reviewSeed(input, outputs)).map(request => request.input),
    sourceRecordIds: ({ input, outputs }) => ocrSignerLookupRequests(reviewSeed(input, outputs)).map(request => request.recordIds),
    deriveChildItemId: (_input, context) => context.canonicalItemId,
  });
  const completed = task({ id: "read-result", contract: ReadOcrResult, replay: "always-rerun" }, [review, pages, identities, signers],
    ({ input, outputs }) => ({ review: reviewSeed(input, outputs), outcomes: [...outputs["lookup-identities"], ...outputs["lookup-signers"]] }));
  const approval = gate({ id: "approve-records", label: "Approve selected records", resolvedBy: "operator",
    result: OcrApprovalReferenceSchema, when: { kind: "equals", of: { from: "input", path: "approval" }, value: "release" } }, [completed]);
  return {
    steps: [
      ...sourcePages.steps,
      [group({ key: "page-readings", label: "Read document pages", system: "local",
        description: "Read each original page through the delegated OCR Page workflow and retain every completed or failed reading for review.",
        review: { pages: [], branchLabels: [], starts: [{ nodeId: "read-pages", each: "Each original page" }],
          outcomes: [{ nodeId: "read-pages", value: "child-failed", then: "Keeps each failed page in the document review. Correct or retry that page before approving its records; other page readings are retained." }],
        } as const,
      }, { manual: MANUAL_PAGE_READINGS }), [pages]],
      [group({ key: "review-records", label: "Group records for review", system: "local",
        description: "Account for every source page and group its readings into proposed records for operator review.",
        review: {
          pages: [
            {
              id: "ocr-records",
              title: "OCR records",
              mode: "Read only",
              nodeIds: ["build-review"],
              lines: [{ id: "group", kind: "check", text: "Account for every original page and group its readings into records for review.", nodeIds: ["build-review"] }],
              fields: [
                { id: "person", label: "Proposed person", example: "Example, Alex", taskFields: [{ nodeId: "build-review", kind: "output", fieldPath: "records.subjectName" }],
                  source: { origin: "Original PDF reading", detail: "The name proposed by the page reading; identity still needs verification and your approval.", chain: [] } },
                { id: "page", label: "Original page", example: "1", taskFields: [{ nodeId: "build-review", kind: "output", fieldPath: "records.sourcePage" }],
                  source: { origin: "Original PDF", detail: "The original page from which this proposed record was read.", chain: [] } },
              ]
            }
          ],
          branchLabels: []
        } as const,
      }, { manual: UNGROUPED_RECORDS }), [review]],
      [group({ key: "identity-lookups", label: "Look up proposed identities", system: "ucpath",
        description: "Check each proposed person through Person Lookup in UCPath and CRM, retaining the delegated outcomes for review.",
        review: { pages: [], branchLabels: [], starts: [{ nodeId: "lookup-identities", each: "Each proposed person" }] } as const,
      }, { manual: UNVERIFIED_IDENTITIES }), [identities]],
      [group({ key: "signer-lookups", label: "Look up official signers", system: "i9",
        description: "Look up proposed official signers in I-9 Complete and retain all person and signer lookup outcomes with the source-bound review.",
        review: { pages: [], branchLabels: [], starts: [{ nodeId: "lookup-signers", each: "Each proposed official signer" }] } as const,
      }, { manual: UNVERIFIED_SIGNERS }), [signers, completed]],
      [group({ key: "approval", label: "Approve selected records", system: "local",
        description: "Require the operator's selection when approval is requested, preserving the bound source evidence before releasing records.",
        review: { pages: [], branchLabels: [],
          outcomes: [{ nodeId: "approve-records", value: "waits", then: "Waits for you to review, correct, select and approve the records in Logs when release is requested. Only the approved selection is released to the parent." }],
        } as const,
      }, { manual: WITHHOLD_RELEASE }), [approval]],
    ] as const, result: result(OcrWorkflowResultSchema, [completed, approval, review], ({ outputs }): z.input<typeof OcrWorkflowResultSchema> => {
      const readResult = outputs["read-result"], seed = outputs["build-review"];
      if (readResult === undefined) return { review: { state: "omitted", step: seed === undefined ? "review-records" : "signer-lookups" },
        identities: [], approvedSnapshot: null };
      if (seed === undefined || sha256Hex(canonicalJsonStringify(seed)) !== readResult.review.digest) {
        throw new Error("OCR result does not match its review checkpoint.");
      }
      return { review: seed, identities: readResult.identities, approvedSnapshot: outputs["approve-records"] ?? null };
    })
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
    memberInput(input: z.output<Input>, approved: z.output<typeof ApprovedOcrRecordInputSchema>, ocr: z.output<typeof OcrReviewedResultSchema>,
      records: readonly OcrApprovedSnapshot["records"][number][]): z.input<MemberInput>;
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
    const reviewed = OcrReviewedResultSchema.parse(reference.output);
    const records = outputs["approved-records"].snapshot.records.filter(options.filter);
    options.validate(records);
    return records.map(record =>
      options.memberInput(input, ApprovedOcrRecordInputSchema.parse({ approval: reference.output.approvedSnapshot, record }), reviewed, records));
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
