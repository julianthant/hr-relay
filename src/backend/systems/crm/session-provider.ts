import { defineWorkerSessionProvider } from "../../../workflow-kit/session.js";

/** Composition-safe provider value; the raw-owner compatibility module is not in task import graphs. */
export const crmSession = defineWorkerSessionProvider("crm");
