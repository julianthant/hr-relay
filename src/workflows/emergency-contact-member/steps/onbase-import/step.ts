import { OnbaseInputSchema } from "../../../../models/systems/onbase/import-document.js";
import { EmergencyContactMemberInputSchema } from "../../../../models/workflows/emergency-contact-member/input.js";
import { EmergencyContactMemberResultSchema } from "../../../../models/workflows/emergency-contact/result.js";
import { WorkflowIdSchema } from "../../../../rules/identity/ids.js";
import { defineStep,inheritStepProof,type WorkflowAuthor,type WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { OnbaseResultSchema } from "../../../onbase/steps/import-document/step.js";
import { buildContactPlan } from "../contact-plan/step.js";
import { buildContactPreview } from "../contact-preview/step.js";

export const ONBASE_IMPORT_STEP = Object.freeze({ key: "onbase-import", label: "Import to OnBase", system: "onbase" as const,
  review: { pages: [], branchLabels: [] } as const,
});
export function buildOnbaseImport(author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>, plan: ReturnType<typeof buildContactPlan>,
  preview: ReturnType<typeof buildContactPreview>) {
  // References only map-contact: depending on the transaction would make the delegate unavailable in a dry run; declared order still runs it after the Save settles.
  const onbase = author.delegate({ id: "onbase-import", label: "Import to OnBase",
    target: { id: WorkflowIdSchema.parse("onbase"), input: OnbaseInputSchema, result: OnbaseResultSchema },
    edgeId: "member-onbase", cardinality: "one", await: "terminal", join: "one",
    policy: { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "hidden-unless-failed" },
  }, [plan.mapped], { bind: ({ input, outputs }) => ({ ucpathId: outputs["map-contact"].emplId, document: input.document, sourcePage: input.sourcePage }),
    deriveChildItemId: (_input, context) => context.canonicalItemId });
  return { steps: [[ONBASE_IMPORT_STEP, [onbase]]] as const, result: author.result(EmergencyContactMemberResultSchema, [preview.preview, onbase], ({ outputs }) => {
    const imported = outputs["onbase-import"];
    if (imported.state !== "done") throw new Error("emergency-contact-member-onbase-not-done");
    return { disposition: outputs["contact-preview"].disposition, proof: outputs["contact-preview"].output.proof, onbase: imported.output };
  }) };
}
export const onbaseImportDefinition = defineStep({ group: ONBASE_IMPORT_STEP, build: buildOnbaseImport,
  proof: { id: "emergency-contact-member-onbase-import", order: 30,
    build: (parent: WorkflowDefinition<typeof EmergencyContactMemberInputSchema>) => ({ ...inheritStepProof(parent), code: "eco",
      label: "Emergency Contact OnBase import", summary: "Imports the member's approved PDF page to OnBase after its contact Save settles.",
      steps: (author: WorkflowAuthor<typeof EmergencyContactMemberInputSchema>) => {
        const plan = buildContactPlan(author), preview = buildContactPreview(author, plan), onbase = buildOnbaseImport(author, plan, preview);
        return { steps: [...plan.steps, ...preview.steps, ...onbase.steps], result: onbase.result };
      },
    }),
  },
});
