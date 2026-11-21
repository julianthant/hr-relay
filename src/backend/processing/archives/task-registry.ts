import { readCrmWorksheetArchivesTask } from "./tasks/read-worksheet-archives.js";

/** Native archive implementations of workflow mini-store contracts; backend composition adds each to its workflow's store. */
export const archiveWorkflowTasks = Object.freeze({ readWorksheetArchives: readCrmWorksheetArchivesTask });
