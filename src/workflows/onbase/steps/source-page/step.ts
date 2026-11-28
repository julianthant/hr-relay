import { OnbaseInputSchema, OnbaseTargetSchema } from "../../../../models/systems/onbase/import-document.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { readOnbaseSourcePage } from "../../tasks/read-source-page.js";

// Typed page numbers cannot supply the verified PDF bytes that Import needs.
const sourcePageManual: StepManualDeclaration = {
  off: "values",
  form: { fields: [{ key: "sourcePage", label: "PDF page", kind: "integer", min: 1 }] },
  produces: {},
  skips: ["source-page"],
};

export const ONBASE_SOURCE_STEP = Object.freeze({ ...defineWorkflowStep({ key: "source-page", label: "Prepare this person's PDF page" }), system: "onbase" as const,
  review: {
    pages: [
      {
        id: "source-page",
        title: "Source PDF page",
        mode: "Read only",
        nodeIds: ["source-page"],
        lines: [
          { id: "read-source", kind: "read", text: "Read the selected original PDF page for this person.", nodeIds: ["source-page"] },
          { id: "source", kind: "check", text: "Extract and verify exactly the approved person’s original PDF page.", nodeIds: ["source-page"] },
        ],
        fields: [{ id: "page", label: "PDF page", inputField: "sourcePage", example: "1",
          source: { origin: "Approved PDF record", detail: "The first original PDF page belonging to this person.", chain: [] } }]
      }
    ],
    branchLabels: []
  } as const,
});
export function buildSource(author: WorkflowAuthor<typeof OnbaseInputSchema>, manual?: StepManualDeclaration) {
  const sourceTask = readOnbaseSourcePage(ONBASE_SOURCE_STEP);
  const source = author.task(sourceTask.identity, [], sourceTask.bind);
  const step = manual === undefined ? ONBASE_SOURCE_STEP : author.group(ONBASE_SOURCE_STEP, { manual });
  return { source, steps: [[step, [source]]] as const,
    result: author.result(OnbaseTargetSchema, [source], ({ outputs }) => outputs["source-page"]) };
}
export const onbaseSourcePageDefinition = defineStep({
  group: ONBASE_SOURCE_STEP,
  build: (author: WorkflowAuthor<typeof OnbaseInputSchema>) => buildSource(author, sourcePageManual),
  proof: { id: "onbase-source-page", order: 13,
    build: (parent: WorkflowDefinition<typeof OnbaseInputSchema>) => ({
      ...inheritStepProof(parent), code: "obs", label: "OnBase source page", summary: "Verifies source bytes and binds exactly one PDF page without importing it.",
      nodePurposes: [{ nodeId: "source-page", purpose: "Read and verify the content-addressed PDF, extract exactly the selected page and bind its bytes to this session." }],
      steps: (author: WorkflowAuthor<typeof OnbaseInputSchema>) => buildSource(author),
    }),
  },
});
