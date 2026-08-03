import { defineBrowserStore } from "../../base/store.js";
import { crmDriver } from "./declaration.js";
import { crmSession } from "./session-provider.js";
import { readOnboardingDatesTask } from "./tasks/read-onboarding-dates.js";
import { readOnboardingRecordTask } from "./tasks/read-onboarding-record.js";

export { crmDriver };

export const crmStore = defineBrowserStore("crm", crmDriver, crmSession, {
  readOnboardingRecord: readOnboardingRecordTask,
  readOnboardingDates: readOnboardingDatesTask,
});
