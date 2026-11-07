import { defineWorkerSessionProvider } from "../../../workflow-kit/session.js";

export const onbaseSession = defineWorkerSessionProvider("onbase", { exclusive: true });
