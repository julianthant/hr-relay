import { OnbaseInputSchema } from "../../../../models/systems/onbase/import-document.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { approvedEmergencyContact } from "../../../../rules/ucpath/emergency-contact.js";
import { defineStep,inheritStepProof,type WorkflowAuthor,type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { OnbaseResultSchema } from "../../../onbase/steps/import-document/step.js";
import { CONTACT_PLAN_INCLUDED, buildContactPlan } from "../contact-plan/step.js";
import { buildContactPreview } from "../contact-preview/step.js";

export const ONBASE_FILING_MANUAL: StepManualDeclaration = {
  off: "manual", ownStartOnly: true, form: { fields: [] }, produces: {}, skips: ["onbase-filing"],
};

export const ONBASE_FILING_STEP = Object.freeze({ ...defineWorkflowStep({ key: "onbase-filing", label: "Import to OnBase" }), system: "onbase" as const,
  manual: ONBASE_FILING_MANUAL,
  review: { when: [{ onbaseFiling: ["file"] }], pages: [{ id: "person-page", title: "This person's PDF page", mode: "Read only", nodeIds: ["onbase-filing"],
    lines: [{ id: "file-person-page", kind: "action", text: "After the contact Save settles, file this person's first source page unless an earlier record already filed it. A dry run previews the import.", nodeIds: ["onbase-filing"] }], fields: [],
  }], branchLabels: [],
    optionsFrom: [{ workflowId: "emergency-contact", fields: ["onbaseFiling"] }],
    starts: [{ nodeId: "onbase-filing", each: "This person's first source page, unless already filed" }],
    outcomes: [{ nodeId: "onbase-filing", value: "child-failed", then: "Holds this person's run for review in Logs. Retry replaces the filing alone and finishes without another Save; an uncertain import is not retried.", stops: true }],
  } as const,
});
// Runs only when the run's pick is "file": a "skip" member binds no child and finishes on its Save.
// Declared after the Save and independent of it: the Save's failure or park stops the run first, and a dry run still previews the filing.
// A failed filing holds the member open on its committed Save: Retry replaces the filing alone and the member then finishes without another Save.
// It maps the Employee ID from input with map-contact's rule: the approved-record and mapped-contact reads allow 0 ms of age at admission.
export function buildOnbaseFiling(author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>, { contactPlanSwitch = false } = {}) {
  const filing = author.delegate({ id: "onbase-filing", label: "Import this person's page to OnBase",
    target: { id: WorkflowIdSchema.parse("onbase"), input: OnbaseInputSchema, result: OnbaseResultSchema },
    edgeId: "onbase-filing", cardinality: "many", await: "terminal", join: "all",
    policy: { onChildFailed: "block-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "hidden-unless-failed" },
  }, [], { bind: ({ input }) => input.onbaseFiling !== "file" || input.sourcePage === null ? [] : [{ ucpathId: approvedEmergencyContact(input.record).emplId, document: input.document, sourcePage: input.sourcePage }],
    deriveChildItemId: (_input, context) => context.canonicalItemId });
  const group = contactPlanSwitch ? author.group(ONBASE_FILING_STEP, {
    review: { ...ONBASE_FILING_STEP.review, when: [{ ...CONTACT_PLAN_INCLUDED, onbaseFiling: ["file"] }] },
  }) : ONBASE_FILING_STEP;
  return { filing, steps: [[group, [filing]]] as const };
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
