import { z } from "zod";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { WorkflowIdSchema } from "../../rules/identity/ids.js";
import { childRunOutcomeSchema } from "../../models/workflow/graph.js";
import { OcrInputSchema, OCR_INPUT_EXAMPLE } from "../../models/workflows/ocr/input.js";
import { OcrPageWorkflowInputSchema } from "../../models/workflows/ocr-page/input.js";
import { OcrPageReadingSchema } from "../../models/workflows/ocr/page-accounting.js";
import { OcrReviewSeedSchema } from "../../models/workflows/ocr/review-seed.js";
import { OcrLookupRequestSchema, ocrLookupRequests, bindOcrLookupOutcomes } from "../../models/workflows/ocr/lookup.js";
import { ExtractPdfPages } from "../../models/processing/extraction/extract-pdf-pages.js";
import { PrepareOcrPages } from "../../models/workflows/ocr/prepare-pages.js";
import { BuildOcrReviewSeed } from "../../models/workflows/ocr/build-review-seed.js";
import { PersonLookupInput } from "../../models/workflows/person-lookup/input.js";
import { PersonLookupResultSchema } from "../person-lookup/workflow.js";

export const OcrResultSchema = z.strictObject({ review: OcrReviewSeedSchema,
  identities: z.array(OcrLookupRequestSchema.extend({ outcome: childRunOutcomeSchema(PersonLookupResultSchema) })) });

const childPolicy = Object.freeze({ onChildFailed: "allow-partial", cascadeCancel: "cascade",
  afterChildRetry: "resume-parent", visibility: "inline" } as const);

export const ocrWorkflow = defineWorkflow({
  id: "ocr", version: 1, code: "oc", label: "OCR", summary: "Reads every original page, groups records and retains identity lookup outcomes for review.",
  icon: "FileScan", category: "documents", input: OcrInputSchema,
  canonicalInput: defineCanonicalInput(OcrInputSchema, OcrInputSchema, [OCR_INPUT_EXAMPLE]),
  inputSubject: "document", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  capabilities: { review: false, editData: false }, verdicts: [], details: [], surfaces: {}, role: defineWorkflowRole({ kind: "composition" }),
  identity: { matchKey: input => `${input.document.sha256}:${input.formType}:${input.readingId}` },
  presentation: { title: input => input.formType, subtitle: () => "OCR document review" },
  scenarios: ["ocr/multi-page", "ocr/manual", "ocr/page-failure", "ocr/unresolved-identity"],
  steps: ({ task, delegate, result }) => {
    const rendered = task({ id: "render-pages", contract: ExtractPdfPages, replay: "checkpoint" }, [], ({ input }) => ({ document: input.document }));
    const source = task({ id: "prepare-pages", contract: PrepareOcrPages, replay: "checkpoint" }, [rendered],
      ({ input, outputs }) => ({ request: input, rendered: outputs["render-pages"] }));
    const pages = delegate({ id: "read-pages", label: "Read every original page",
      target: { id: WorkflowIdSchema.parse("ocr-page"), input: OcrPageWorkflowInputSchema, result: OcrPageReadingSchema },
      edgeId: "ocr-pages", cardinality: "many", await: "terminal", join: "all-settled", policy: childPolicy }, [source], {
      bind: ({ outputs }) => outputs["prepare-pages"].pages,
      deriveChildItemId: (_input, context) => context.canonicalItemId,
    });
    const review = task({ id: "build-review", contract: BuildOcrReviewSeed, replay: "checkpoint" }, [source, pages],
      ({ input, outputs }) => ({ sourceRunId: input.sourceRunId, roster: input.roster, formType: input.formType,
        manifest: outputs["prepare-pages"].manifest, readingId: input.readingId, outcomes: [...outputs["read-pages"]] }));
    const identities = delegate({ id: "lookup-identities", label: "Verify proposed identities",
      target: { id: WorkflowIdSchema.parse("person-lookup"), input: PersonLookupInput, result: PersonLookupResultSchema },
      edgeId: "ocr-identities", cardinality: "many", await: "terminal", join: "all-settled", policy: childPolicy }, [review], {
      bind: ({ outputs }) => ocrLookupRequests(outputs["build-review"]).map(request => request.input),
      deriveChildItemId: (_input, context) => context.canonicalItemId,
    });
    return { steps: [
      [{ key: "source-pages", label: "Prepare source pages", system: "local" }, [rendered, source]],
      [{ key: "page-readings", label: "Read document pages", system: "local" }, [pages]],
      [{ key: "review-records", label: "Group records for review", system: "local" }, [review]],
      [{ key: "identity-lookups", label: "Look up proposed identities", system: "ucpath" }, [identities]],
    ], result: result(OcrResultSchema, [review, identities], ({ outputs }) => ({ review: outputs["build-review"],
      identities: bindOcrLookupOutcomes(outputs["build-review"], outputs["lookup-identities"]) })) };
  },
});
