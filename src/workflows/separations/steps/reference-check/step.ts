import { z } from "zod";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../../../../models/workflows/person-lookup/input.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import { defineCanonicalInput } from "../../../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../../../models/workflow/presentation.js";
import { REFERENCE_CHECK_STEP, defineStep, type StepProofSpec, type WorkflowAuthor } from "../../../../workflow-kit/workflow-definition.js";
import { defineReferenceCheck } from "../../../../workflow-kit/reference-check.js";

const ProofInputShape = { emplId: EidSchema, employeeName: z.string().min(1) } as const;
const SeparationsReferenceCheckInput = z.strictObject(ProofInputShape);
const SeparationsReferenceCheckCanonicalInput = defineCanonicalInput(SeparationsReferenceCheckInput, z.strictObject(ProofInputShape),
  [{ emplId: PERSON_LOOKUP_EXAMPLE_EID, employeeName: "Lee, Jordan" }]);
const SeparationsReferenceCheckResultSchema = z.strictObject({ emplId: EidSchema });

export const separationsReferenceCheckDefinition = defineStep({
  group: REFERENCE_CHECK_STEP,
  proof: {
    id: "separations-reference-check", order: 36, build: (): StepProofSpec<typeof SeparationsReferenceCheckInput, typeof SeparationsReferenceCheckResultSchema> => ({
      version: 1, code: "sr", label: REFERENCE_CHECK_STEP.label,
      summary: "Compares the supplied separation subject with the picked reference worksheets.",
      icon: "ShieldCheck", category: "separation", requiredWorkbookFields: [], referenceCheck: defineReferenceCheck({ key: "eid", input: { eid: "emplId", fullName: "employeeName" }, outputs: {} }),
      canonicalInput: SeparationsReferenceCheckCanonicalInput, inputSubject: "eid", surface: { shape: "single" }, enqueue: "reject-active",
      actions: STANDARD_WORKFLOW_ACTIONS, surfaces: {}, verdicts: [], details: [],
      identity: { matchKey: input => `separations-reference-check:${input.emplId}` },
      presentation: { title: input => `${input.employeeName} (${input.emplId})`, subtitle: () => "Reference spreadsheet check" },
      scenarios: ["separations-reference-check/reference-check"],
      input: SeparationsReferenceCheckInput,
      steps: (author: WorkflowAuthor<typeof SeparationsReferenceCheckInput>) => ({
        steps: [],
        result: author.result(SeparationsReferenceCheckResultSchema, [], ({ input }) => ({ emplId: input.emplId })),
      }),
    }),
  },
});
