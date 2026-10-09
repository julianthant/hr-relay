import { defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { kualiDriver } from "./driver-declaration.js";
import { kualiSession } from "./session-provider.js";
import { matchSeparationFinalizationTask } from "./tasks/match-separation-finalization.js";
import { readSeparationDocumentTask } from "./tasks/read-separation-document.js";
import { searchSeparationActionTask } from "./tasks/search-separation-action.js";
import { saveSeparationFinalizationTask } from "./tasks/save-separation-finalization.js";
import { stageSeparationFinalizationTask } from "./tasks/stage-separation-finalization.js";
import { verifySeparationFinalizationTask } from "./tasks/verify-separation-finalization.js";

export { kualiDriver };

export const kualiStore = defineBrowserStore("kuali", kualiDriver, kualiSession, {
  searchSeparationAction: searchSeparationActionTask,
  readSeparationDocument: readSeparationDocumentTask,
  matchSeparationFinalization: matchSeparationFinalizationTask,
  stageSeparationFinalization: stageSeparationFinalizationTask,
  saveSeparationFinalization: saveSeparationFinalizationTask,
  verifySeparationFinalization: verifySeparationFinalizationTask,
});
