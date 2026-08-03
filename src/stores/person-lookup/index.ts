import { defineWorkflowStore } from "../../base/store.js";
import { readActiveStatusTask } from "./read-active-status.js";

export const personLookupStore = defineWorkflowStore("person-lookup", {
  readActiveStatus: readActiveStatusTask,
});
