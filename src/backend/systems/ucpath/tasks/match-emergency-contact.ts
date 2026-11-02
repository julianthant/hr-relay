import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathMatchEmergencyContact } from "../../../../models/systems/ucpath/contact-tasks.js";
import { UcpathContactRefusedError } from "../../../../models/systems/ucpath/emergency-contacts.js";
import { contactEffect, compareSavedContactAddition } from "../driver/contact-operation.js";
import { ucpathDriver } from "../driver-declaration.js";

export const matchEmergencyContactTask = defineTask(ucpathDriver, UcpathMatchEmergencyContact, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    try {
      const { before, ...contact } = input;
      const effect = contactEffect(contact);
      const contacts = await ctx.driver.readEmergencyContacts(contact);
      const state = compareSavedContactAddition(before, contacts, effect);
      ctx.recordData([
        { direction: "read", field: "state", value: state },
        { direction: "read", field: "contacts", value: contacts },
      ]);
      return { state, contacts };
    } catch (error) {
      if (!(error instanceof UcpathContactRefusedError)) throw error;
      return ctx.fail(error.code, error.message, { cause: error });
    }
  },
});
