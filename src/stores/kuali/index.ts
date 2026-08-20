import { defineBrowserStore } from "../../base/store.js";
import { kualiDriver } from "./declaration.js";
import { kualiSession } from "./session-provider.js";
import { fillTimekeeperAnnotationTask } from "./tasks/fill-timekeeper-annotation.js";
import { matchSeparationFinalizationTask } from "./tasks/match-separation-finalization.js";
import { readSeparationDocumentTask } from "./tasks/read-separation-document.js";
import { readTimekeeperAnnotationTask } from "./tasks/read-timekeeper-annotation.js";
import { searchSeparationActionTask } from "./tasks/search-separation-action.js";
import { saveSeparationFinalizationTask } from "./tasks/save-separation-finalization.js";
import { saveTimekeeperAnnotationTask } from "./tasks/save-timekeeper-annotation.js";
import { stageSeparationFinalizationTask } from "./tasks/stage-separation-finalization.js";
import { verifySeparationFinalizationTask } from "./tasks/verify-separation-finalization.js";
import { verifyTimekeeperAnnotationTask } from "./tasks/verify-timekeeper-annotation.js";

export { kualiDriver };

export const kualiStore = defineBrowserStore("kuali", kualiDriver, kualiSession, {
  searchSeparationAction: searchSeparationActionTask,
  readTimekeeperAnnotation: readTimekeeperAnnotationTask,
  readSeparationDocument: readSeparationDocumentTask,
  verifyTimekeeperAnnotation: verifyTimekeeperAnnotationTask,
  fillTimekeeperAnnotation: fillTimekeeperAnnotationTask,
  saveTimekeeperAnnotation: saveTimekeeperAnnotationTask,
  matchSeparationFinalization: matchSeparationFinalizationTask,
  stageSeparationFinalization: stageSeparationFinalizationTask,
  saveSeparationFinalization: saveSeparationFinalizationTask,
  verifySeparationFinalization: verifySeparationFinalizationTask,
});
