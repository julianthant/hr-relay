import { defineWorkerSessionProvider } from "../../../base/session.js";

/** Authentication is executed against the worker factory's bounded handle. */
export const ucpathSession = defineWorkerSessionProvider("ucpath");
