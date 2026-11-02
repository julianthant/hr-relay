import { defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { onbaseDriver } from "./driver-declaration.js";
import { onbaseSession } from "./session.js";
import { readSourcePageTask } from "./tasks/read-source-page.js";
import { commitImportTask, matchImportTask, prepareImportTask, verifyImportTask } from "./tasks/import-document.js";

export const onbaseStore = defineBrowserStore("onbase", onbaseDriver, onbaseSession, {
  readSourcePage: readSourcePageTask, prepareImport: prepareImportTask, commitImport: commitImportTask,
  matchImport: matchImportTask, verifyImport: verifyImportTask,
});
