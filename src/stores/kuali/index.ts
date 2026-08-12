import { defineBrowserStore } from "../../base/store.js";
import { kualiDriver } from "./declaration.js";
import { kualiSession } from "./session-provider.js";
import { fillTimekeeperAnnotationTask } from "./tasks/fill-timekeeper-annotation.js";
import { readSeparationDocumentTask } from "./tasks/read-separation-document.js";
import { readTimekeeperAnnotationTask } from "./tasks/read-timekeeper-annotation.js";
import { saveTimekeeperAnnotationTask } from "./tasks/save-timekeeper-annotation.js";
import { verifyTimekeeperAnnotationTask } from "./tasks/verify-timekeeper-annotation.js";

export { kualiDriver };

export const kualiStore = defineBrowserStore("kuali", kualiDriver, kualiSession, {
  readTimekeeperAnnotation: readTimekeeperAnnotationTask,
  readSeparationDocument: readSeparationDocumentTask,
  verifyTimekeeperAnnotation: verifyTimekeeperAnnotationTask,
  fillTimekeeperAnnotation: fillTimekeeperAnnotationTask,
  saveTimekeeperAnnotation: saveTimekeeperAnnotationTask,
});
