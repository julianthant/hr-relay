import { defineWorkerSessionProvider } from "../../../base/session.js";

export const onbaseSession = defineWorkerSessionProvider("onbase", { exclusive: true });
