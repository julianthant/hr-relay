import { defineServiceStore } from "../../../workflow-kit/task-registry.js";
import { readWorkbookResultTask } from "./tasks/read-result.js";

export const workbooksStore = defineServiceStore("workbooks", { readResult: readWorkbookResultTask });
