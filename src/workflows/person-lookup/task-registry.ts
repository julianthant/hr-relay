import { readResolvedIdentityTask } from "./tasks/read-resolved-identity.js";
import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readActiveStatusTask } from "./tasks/read-active-status.js";

export const personLookupStore = defineWorkflowStore("person-lookup", {
  readResolvedIdentity: readResolvedIdentityTask,
  readActiveStatus: readActiveStatusTask,
});
