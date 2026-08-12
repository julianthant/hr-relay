import { defineBrowserStore } from "../../base/store.js";
import { newKronosDriver } from "./declaration.js";
import { newKronosSession } from "./session-provider.js";
import { readSeparationTimecardTask } from "./tasks/read-separation-timecard.js";
import { searchEmployeeTask } from "./tasks/search-employee.js";

export { newKronosDriver };

export const newKronosStore = defineBrowserStore("new-kronos", newKronosDriver, newKronosSession, {
  searchEmployee: searchEmployeeTask,
  readSeparationTimecard: readSeparationTimecardTask,
});
