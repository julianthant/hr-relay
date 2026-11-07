import { defineCanonicalInput } from "../../../../src/models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../src/models/workflow/presentation.js";
import { OCR_INPUT_EXAMPLE, OcrCanonicalInputSchema, OcrInputSchema } from "../../../../src/models/workflows/ocr/input.js";
import { OcrWorkflowResultSchema } from "../../../../src/models/workflows/ocr/result.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";

function parent(id: string, targetId: string) {
  return defineWorkflow({
    id, version: 1, code: "fop", label: "PDF parent fixture", icon: "FileScan", category: "documents",
    input: OcrInputSchema,
    canonicalInput: defineCanonicalInput(OcrInputSchema, OcrCanonicalInputSchema, [OCR_INPUT_EXAMPLE]),
    inputSubject: "document", surface: { shape: "single" }, enqueue: "reject-active",
    actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, details: [], scenarios: ["fixture-ocr-parent/admission"],
    role: defineWorkflowRole({ kind: "composition" }),
    identity: { matchKey: input => input.document.sha256 }, presentation: { title: () => "PDF parent fixture" },
    steps: ({ delegate, result }) => {
      const child = delegate({ id: "read-document",
        target: { id: WorkflowIdSchema.parse(targetId), input: OcrInputSchema, result: OcrWorkflowResultSchema },
        edgeId: "pdf-ocr", cardinality: "one", await: "terminal", join: "one",
        policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" },
      }, [], { bind: ({ input }) => input, deriveChildItemId: (_input, identity) => identity.canonicalItemId });
      return { steps: [[{ key: "ocr", label: "Read PDF" }, [child]]],
        result: result(OcrWorkflowResultSchema, [child], ({ outputs }) => {
          if (outputs["read-document"].state !== "done") throw new Error("fixture-ocr-child-not-done");
          return outputs["read-document"].output;
        }) };
    },
  });
}

export const ocrParentWorkflow = parent("fixture-ocr-parent", "ocr");
export const unregisteredOcrParentWorkflow = parent("fixture-ocr-unregistered-parent", "fixture-unregistered-ocr");
