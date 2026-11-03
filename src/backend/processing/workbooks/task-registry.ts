import { defineServiceStore } from "../../../workflow-kit/task-registry.js";
import { readWorkbookResultTask } from "./tasks/read-result.js";
import { readWorkbookReferenceTask } from "./tasks/read-reference.js";

export const workbooksStore = defineServiceStore("workbooks", { readResult: readWorkbookResultTask, readReference: readWorkbookReferenceTask });
