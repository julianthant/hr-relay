import { defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { onbaseDriver } from "./driver-declaration.js";
import { onbaseSession } from "./session.js";
import { readSourcePageTask } from "./tasks/read-source-page.js";
import { commitImportTask } from "./tasks/upload-import.js";
import { matchImportTask } from "./tasks/match-import.js";
import { prepareImportTask } from "./tasks/stage-import.js";
import { verifyImportTask } from "./tasks/verify-import.js";

export const onbaseStore = defineBrowserStore("onbase", onbaseDriver, onbaseSession, {
  readSourcePage: readSourcePageTask, prepareImport: prepareImportTask, commitImport: commitImportTask,
  matchImport: matchImportTask, verifyImport: verifyImportTask,
});
