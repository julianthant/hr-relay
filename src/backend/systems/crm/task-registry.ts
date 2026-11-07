import { readOnboardingResultsTask } from "./tasks/read-onboarding-results.js";
import { readHireDataTask } from "./tasks/read-hire-data.js";
import { verifyOnboardingRecordTask } from "./tasks/verify-onboarding-record.js";
import { searchOnboardingRecordsTask } from "./tasks/search-onboarding-records.js";
import { defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { crmDriver } from "./driver-declaration.js";
import { crmSession } from "./session-provider.js";
import { readOnboardingDatesTask } from "./tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "./tasks/read-onboarding-record.js";
import { searchDocumentRecordsTask } from "./tasks/search-document-records.js";
import { readIdocsTask } from "./tasks/read-idocs.js";


export const crmStore = defineBrowserStore("crm", crmDriver, crmSession, {
  searchDocumentRecords: searchDocumentRecordsTask,
  readIdocs: readIdocsTask,
  readHireData: readHireDataTask,
  readOnboardingResults: readOnboardingResultsTask,
  searchOnboardingRecords: searchOnboardingRecordsTask,
  verifyOnboardingRecord: verifyOnboardingRecordTask,
  readOnboardingRecord: readOnboardingRecordTask,
  readOnboardingDates: readOnboardingDatesTask,
});
