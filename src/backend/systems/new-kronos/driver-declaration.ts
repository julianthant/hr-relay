import { declareDriverFor } from "../../../base/store.js";
import type { NewKronosTimecardDriver } from "../../../domain/ui/new-kronos-timecard.js";

/** Task-safe declaration identity; raw browser ownership remains under `driver/`. */
export const newKronosDriver = declareDriverFor<NewKronosTimecardDriver>()(
  "new-kronos",
  "semantic-ready",
);
