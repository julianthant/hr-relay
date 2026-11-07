import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readEmergencyContactResultTask } from "./tasks/read-result.js";
export const emergencyContactStore = defineWorkflowStore("emergency-contact", { readResult: readEmergencyContactResultTask });
