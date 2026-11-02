import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathStageEmergencyContact } from "../../../../models/systems/ucpath/contact-tasks.js";
import { UcpathContactRefusedError } from "../../../../models/systems/ucpath/emergency-contacts.js";
import { ucpathDriver } from "../driver-declaration.js";

export const stageEmergencyContactTask = defineTask(ucpathDriver, UcpathStageEmergencyContact, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const { before, ...contact } = input;
    const contacts = await ctx.driver.stageEmergencyContact(contact, before).catch((error: unknown) => {
      if (!(error instanceof UcpathContactRefusedError)) throw error;
      return ctx.fail(error.code, error.message, { cause: error });
    });
    ctx.recordData({ direction: "read", field: "contacts", value: contacts });
    return { contacts };
  },
});
