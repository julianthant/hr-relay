import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readI9LookupResultTask } from "./tasks/read-result.js";

export const i9LookupStore = defineWorkflowStore("i9-lookup", { readResult: readI9LookupResultTask });
