import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathReadEmergencyContacts } from "../../../../models/systems/ucpath/contact-tasks.js";
import { UcpathContactRefusedError } from "../../../../models/systems/ucpath/emergency-contacts.js";
import { ucpathDriver } from "../driver-declaration.js";

export const readEmergencyContactsTask = defineTask(ucpathDriver, UcpathReadEmergencyContacts, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const contacts = await ctx.driver.readEmergencyContacts(input).catch((error: unknown) => {
      if (!(error instanceof UcpathContactRefusedError)) throw error;
      return ctx.fail(error.code, error.message, { cause: error });
    });
    ctx.recordData({ direction: "read", field: "contacts", value: contacts });
    return { contacts };
  },
});
