import { defineServiceStore } from "../../../workflow-kit/task-registry.js";
import { readWorkbookResultTask } from "./tasks/read-result.js";
import { readWorkbookReferenceTask } from "./tasks/read-reference.js";
import { verifyWorkbookPersonTask } from "./tasks/verify-person.js";

export const workbooksStore = defineServiceStore("workbooks", { readResult: readWorkbookResultTask, readReference: readWorkbookReferenceTask, verifyPerson: verifyWorkbookPersonTask });
