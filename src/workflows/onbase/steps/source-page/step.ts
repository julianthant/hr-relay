import { OnbaseInputSchema, OnbaseTargetSchema } from "../../../../models/systems/onbase/import-document.js";
import { defineStep, inheritStepProof, type WorkflowAuthor, type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { readOnbaseSourcePage } from "../../tasks/read-source-page.js";

export const ONBASE_SOURCE_STEP = Object.freeze({ ...defineWorkflowStep({ key: "source-page", label: "Prepare this person's PDF page" }), system: "onbase" as const });
export function buildSource(author: WorkflowAuthor<typeof OnbaseInputSchema>) {
  const sourceTask = readOnbaseSourcePage(ONBASE_SOURCE_STEP);
  const source = author.task(sourceTask.identity, [], sourceTask.bind);
  return { source, steps: [[ONBASE_SOURCE_STEP, [source]]] as const,
    result: author.result(OnbaseTargetSchema, [source], ({ outputs }) => outputs["source-page"]) };
}
export const onbaseSourcePageDefinition = defineStep({
  group: ONBASE_SOURCE_STEP, build: buildSource,
  proof: { id: "onbase-source-page", order: 13,
    build: (parent: WorkflowDefinition<typeof OnbaseInputSchema>) => ({
      ...inheritStepProof(parent), code: "obs", label: "OnBase source page", summary: "Verifies source bytes and binds exactly one PDF page without importing it.",
      nodePurposes: [{ nodeId: "source-page", purpose: "Read and verify the content-addressed PDF, extract exactly the selected page and bind its bytes to this session." }],
      steps: (author: WorkflowAuthor<typeof OnbaseInputSchema>) => buildSource(author),
    }),
  },
});
