import { defineWorkerSessionProvider } from "../../../workflow-kit/session.js";

/** Authentication is executed against the worker factory's bounded handle. */
export const ucpathSession = defineWorkerSessionProvider("ucpath");
