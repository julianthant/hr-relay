import { defineWorkflowStore } from "../../base/store.js";
import { readActiveStatusTask } from "./tasks/read-active-status.js";

export const personLookupStore = defineWorkflowStore("person-lookup", {
  readActiveStatus: readActiveStatusTask,
});
