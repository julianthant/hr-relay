import { defineWorkflowStore } from "../../workflow-kit/task-registry.js";
import { readI9CheckPeopleTask } from "./tasks/read-people.js";
import { readI9CheckReferenceConflictsTask, readI9CheckRequestsTask } from "./tasks/read-requests.js";
import { readI9CheckRowsTask } from "./tasks/read-rows.js";
import { readI9CheckPublicationTask } from "./tasks/read-publication.js";

export const i9CheckStartStore = defineWorkflowStore("i9-check-start", {
  readPeople: readI9CheckPeopleTask, readRequests: readI9CheckRequestsTask,
  readReferenceConflicts: readI9CheckReferenceConflictsTask,
  readRows: readI9CheckRowsTask, readPublication: readI9CheckPublicationTask,
});
