import { emergencyContactMemberWorkflow } from "../../../../src/workflows/emergency-contact-member/workflow.js";
import { ReadApprovedOcrRecord } from "../../../../src/models/processing/ocr/read-approved-record.js";
import { MapApprovedEmergencyContact } from "../../../../src/models/workflows/emergency-contact-member/read-approved-contact.js";
import { PlanApprovedEmergencyContact } from "../../../../src/models/workflows/emergency-contact-member/read-contact-plan.js";
import { UcpathReadEmergencyContacts } from "../../../../src/models/systems/ucpath/read-emergency-contacts.js";
import { UcpathStageEmergencyContact } from "../../../../src/models/systems/ucpath/stage-emergency-contact.js";
import { UcpathSaveEmergencyContact } from "../../../../src/models/systems/ucpath/save-emergency-contact.js";
import { EmergencyContactMemberResultSchema } from "../../../../src/models/workflows/emergency-contact/result.js";
import { compileWorkflow, defineWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";

/** Same contracts and native member identity; only the production pending-Save refusal is omitted. */
export const contactSaveMember = compileWorkflow(defineWorkflow({
  ...emergencyContactMemberWorkflow,
  steps: author => {
    const approved = author.task({ id: "approved-record", label: "Authenticate OCR release", contract: ReadApprovedOcrRecord, replay: "always-rerun" }, [], ({ input }) => input);
    const mapped = author.task({ id: "map-contact", label: "Map contact", contract: MapApprovedEmergencyContact, replay: "always-rerun" }, [approved], ({ input, outputs }) => ({ ...input, record: outputs["approved-record"].record }));
    const read = author.task({ id: "read-contacts", label: "Read contacts", contract: UcpathReadEmergencyContacts, replay: "always-rerun" }, [mapped], ({ outputs }) => ({ emplId: outputs["map-contact"].emplId, expectedName: outputs["map-contact"].expectedName }));
    const plan = author.task({ id: "contact-plan", label: "Declare plan", contract: PlanApprovedEmergencyContact, replay: "always-rerun" }, [read, mapped], ({ outputs }) => ({ contact: outputs["map-contact"], contacts: outputs["read-contacts"].contacts }));
    const save = author.transaction({ id: "contact-preview", label: "Save approved plan", prepare: UcpathStageEmergencyContact, commit: UcpathSaveEmergencyContact,
      dryRun: "stop-after-prepare", probePolicy: "always", probeToFenceMaxMs: 45_000 }, [plan], {
      prepareBind: ({ outputs }) => outputs["contact-plan"].target, commitBind: ({ outputs }) => outputs["contact-plan"].target,
    });
    return { steps: [[{ key: "contact-plan", label: "Plan" }, [approved, mapped, read, plan]], [{ key: "contact-preview", label: "Save" }, [save]]],
      result: author.result(EmergencyContactMemberResultSchema, [save], ({ outputs }) => ({ disposition: outputs["contact-preview"].disposition, proof: outputs["contact-preview"].output.proof })) };
  },
}));
