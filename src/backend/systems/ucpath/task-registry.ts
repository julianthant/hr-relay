import { defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { ucpathDriver } from "./driver-declaration.js";
import { ucpathSession } from "./session-provider.js";
import { deletePendingTerminationsTask } from "./tasks/delete-pending-terminations.js";
import { createTerminationTask } from "./tasks/create-termination.js";
import { stagePendingTerminationSweepTask } from "./tasks/stage-pending-termination-sweep.js";
import { stageTerminationTask } from "./tasks/stage-termination.js";
import { matchPendingTerminationsTask } from "./tasks/match-pending-terminations.js";
import { matchExistingTerminationTask } from "./tasks/match-existing-termination.js";
import { readJobSummaryTask } from "./tasks/read-job-summary.js";
import { searchPersonOrgTask } from "./tasks/search-person-org.js";
import { verifyPendingTerminationsClearedTask } from "./tasks/verify-pending-terminations-cleared.js";
import { verifyTerminationTask } from "./tasks/verify-termination.js";
import { readPendingTerminationSetTask } from "./tasks/read-pending-termination-set.js";
import { verifyTerminationFilingPresentTask } from "./tasks/verify-termination-filing-present.js";


export const ucpathStore = defineBrowserStore(
  "ucpath",
  ucpathDriver,
  ucpathSession,
  {
    searchPersonOrg: searchPersonOrgTask,
    readJobSummary: readJobSummaryTask,
    probeTermination: matchExistingTerminationTask,
    prepareTermination: stageTerminationTask,
    createTermination: createTerminationTask,
    verifyTermination: verifyTerminationTask,
    verifyTerminationFilingPresent: verifyTerminationFilingPresentTask,
    readPendingTerminationSet: readPendingTerminationSetTask,
    probePendingTerminations: matchPendingTerminationsTask,
    preparePendingTerminationSweep: stagePendingTerminationSweepTask,
    clearPendingTerminations: deletePendingTerminationsTask,
    verifyPendingTerminationsCleared: verifyPendingTerminationsClearedTask,
  },
);
