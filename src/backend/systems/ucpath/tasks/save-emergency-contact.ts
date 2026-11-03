import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { UcpathSaveEmergencyContact } from "../../../../models/systems/ucpath/save-emergency-contact.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";

export const saveEmergencyContactTask = defineTask(ucpathDriver, UcpathSaveEmergencyContact, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }], async run({ ctx }) {
    return ctx.fail("CONTACT_SAVE_UNAVAILABLE", ERROR_CATALOG.CONTACT_SAVE_UNAVAILABLE.text);
  },
});
