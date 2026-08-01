import { defineUnwiredSessionProvider } from "../../base/session.js";

export const onbaseSession = defineUnwiredSessionProvider("onbase", { exclusive: true });
