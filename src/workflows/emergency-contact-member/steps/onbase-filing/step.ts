import { OnbaseInputSchema } from "../../../../models/systems/onbase/import-document.js";
import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { approvedEmergencyContact } from "../../../../rules/ucpath/emergency-contact.js";
import { defineStep,inheritStepProof,type WorkflowAuthor,type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { OnbaseResultSchema } from "../../../onbase/steps/import-document/step.js";
import { buildContactPlan } from "../contact-plan/step.js";
import { buildContactPreview } from "../contact-preview/step.js";

export const ONBASE_FILING_STEP = Object.freeze({ ...defineWorkflowStep({ key: "onbase-filing", label: "Import to OnBase" }), system: "onbase" as const,
  review: { pages: [], branchLabels: [] } as const,
});
// Declared after the Save and independent of it: the Save's failure or park stops the run first, and a dry run still previews the filing.
// It maps the Employee ID from input with map-contact's rule: the approved-record and mapped-contact reads allow 0 ms of age at admission.
export function buildOnbaseFiling(author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>) {
  const filing = author.delegate({ id: "onbase-filing", label: "Import this person's page to OnBase",
    target: { id: WorkflowIdSchema.parse("onbase"), input: OnbaseInputSchema, result: OnbaseResultSchema },
    edgeId: "onbase-filing", cardinality: "one", await: "terminal", join: "one",
    policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "manual-parent-resume", visibility: "hidden-unless-failed" },
  }, [], { bind: ({ input }) => ({ ucpathId: approvedEmergencyContact(input.record).emplId, document: input.document, sourcePage: input.sourcePage }),
    deriveChildItemId: (_input, context) => context.canonicalItemId });
  return { filing, steps: [[ONBASE_FILING_STEP, [filing]]] as const };
}
export const onbaseFilingDefinition = defineStep({ group: ONBASE_FILING_STEP, build: buildOnbaseFiling,
  proof: { id: "emergency-contact-member-onbase-filing", order: 34,
    build: (parent: WorkflowDefinition<typeof EmergencyContactMemberInputSchema>) => ({ ...inheritStepProof(parent), code: "eco",
      label: "Emergency Contact OnBase filing", summary: "Files the member's source page to OnBase through one child after the Save settles.",
      steps: (author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>) => {
        const plan = buildContactPlan(author), preview = buildContactPreview(author, plan), filing = buildOnbaseFiling(author);
        return { steps: [...plan.steps, ...preview.steps, ...filing.steps], result: preview.result };
      },
    }),
  },
});
