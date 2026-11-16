import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { mapApprovedEmergencyContactTask } from "./tasks/read-approved-contact.js";
import { planApprovedEmergencyContactTask } from "./tasks/read-contact-plan.js";
export const emergencyContactMemberStore = defineWorkflowStore("emergency-contact-member", {
  mapContact: mapApprovedEmergencyContactTask, planContact: planApprovedEmergencyContactTask,
});
