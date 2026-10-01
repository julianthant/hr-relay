import { defineWorkerSessionProvider } from "../../../base/session.js";

/** Composition-safe provider value; the raw-owner compatibility module is not in task import graphs. */
export const newKronosSession = defineWorkerSessionProvider("new-kronos");
