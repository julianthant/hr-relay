import { readEmergencyContactsTask } from "./tasks/read-emergency-contacts.js";
import { stageEmergencyContactTask } from "./tasks/stage-emergency-contact.js";
import { probeEmergencyContactTask } from "./tasks/match-emergency-contact-plan.js";
import { verifyEmergencyContactTask } from "./tasks/verify-emergency-contact-plan.js";
import { saveEmergencyContactTask } from "./tasks/save-emergency-contact.js";
import { readHireReceiptTask } from "./tasks/read-hire-receipt.js";
import { readHireFindingsTask } from "./tasks/read-hire-findings.js";
import { matchHireTask } from "./tasks/match-hire.js";
import { verifyHireTask } from "./tasks/verify-hire.js";
import { stageHireTask } from "./tasks/stage-hire.js";
import { createHireTask } from "./tasks/create-hire.js";
import { searchPersonMatchTask } from "./tasks/search-person-match.js";
import { readPayPathPositionTask } from "./tasks/read-paypath-position.js";
import { stagePayPathWorkStudyTask } from "./tasks/stage-paypath-work-study.js";
import { submitPayPathWorkStudyTask } from "./tasks/submit-paypath-work-study.js";
import { matchPayPathWorkStudyTask } from "./tasks/match-paypath-work-study.js";
import { verifyPayPathWorkStudyTask } from "./tasks/verify-paypath-work-study.js";
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
import { readTransactionFindingsTask } from "./tasks/read-transaction-findings.js";
import { verifyTerminationFilingPresentTask } from "./tasks/verify-termination-filing-present.js";


export const ucpathStore = defineBrowserStore(
  "ucpath",
  ucpathDriver,
  ucpathSession,
  {
    readEmergencyContacts: readEmergencyContactsTask, stageEmergencyContact: stageEmergencyContactTask,
    probeEmergencyContact: probeEmergencyContactTask, verifyEmergencyContact: verifyEmergencyContactTask, saveEmergencyContact: saveEmergencyContactTask,
    readHireReceipt: readHireReceiptTask, readHireFindings: readHireFindingsTask, matchHire: matchHireTask, verifyHire: verifyHireTask,
    stageHire: stageHireTask, createHire: createHireTask,
    searchPersonMatch: searchPersonMatchTask,
    readPayPathPosition: readPayPathPositionTask,
    stagePayPathWorkStudy: stagePayPathWorkStudyTask, submitPayPathWorkStudy: submitPayPathWorkStudyTask,
    probePayPathWorkStudy: matchPayPathWorkStudyTask, verifyPayPathWorkStudy: verifyPayPathWorkStudyTask,
    searchPersonOrg: searchPersonOrgTask,
    readJobSummary: readJobSummaryTask,
    probeTermination: matchExistingTerminationTask,
    prepareTermination: stageTerminationTask,
    createTermination: createTerminationTask,
    verifyTermination: verifyTerminationTask,
    verifyTerminationFilingPresent: verifyTerminationFilingPresentTask,
    readPendingTerminationSet: readPendingTerminationSetTask,
    readTransactionFindings: readTransactionFindingsTask,
    probePendingTerminations: matchPendingTerminationsTask,
    preparePendingTerminationSweep: stagePendingTerminationSweepTask,
    clearPendingTerminations: deletePendingTerminationsTask,
    verifyPendingTerminationsCleared: verifyPendingTerminationsClearedTask,
  },
);
