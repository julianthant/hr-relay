import { readOnboardingResultsTask } from "./tasks/read-onboarding-results.js";
import { verifyOnboardingRecordTask } from "./tasks/verify-onboarding-record.js";
import { searchOnboardingRecordsTask } from "./tasks/search-onboarding-records.js";
import { defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { crmDriver } from "./driver-declaration.js";
import { crmSession } from "./session-provider.js";
import { readOnboardingDatesTask } from "./tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "./tasks/read-onboarding-record.js";


export const crmStore = defineBrowserStore("crm", crmDriver, crmSession, {
  readOnboardingResults: readOnboardingResultsTask,
  searchOnboardingRecords: searchOnboardingRecordsTask,
  verifyOnboardingRecord: verifyOnboardingRecordTask,
  readOnboardingRecord: readOnboardingRecordTask,
  readOnboardingDates: readOnboardingDatesTask,
});
