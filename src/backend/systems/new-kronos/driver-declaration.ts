import { declareDriverFor } from "../../../workflow-kit/task-registry.js";
import type { NewKronosTimecardDriver } from "../../../models/ui/new-kronos-timecard.js";

/** Task-safe declaration identity; raw browser ownership remains under `driver/`. */
export const newKronosDriver = declareDriverFor<NewKronosTimecardDriver>()(
  "new-kronos",
  "semantic-ready",
);
