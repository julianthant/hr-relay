import { UcpathContactSetSchema } from "../../../../models/systems/ucpath/emergency-contacts.js";
import { UcpathReadEmergencyContacts } from "../../../../models/systems/ucpath/read-emergency-contacts.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";

import { refuseContact } from "../contact-verdict.js";
export const readEmergencyContactsTask = defineTask(ucpathDriver, UcpathReadEmergencyContacts, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }], async run({ input, ctx }) {
    const contacts = await ctx.driver.readEmergencyContacts(input).catch(error => refuseContact(error, ctx.fail));
    if (contacts.observation !== "persisted") return ctx.fail("contact-plan-refused", "A staged contact page cannot prove saved contacts.");
    UcpathContactSetSchema.parse(contacts);
    await ctx.confirmed?.verify({ action: { id: "verify-contact-observation", targetId: "verify-contact-observation" }, purpose: "read-validation",
      observe: async () => contacts, matches: observed => canonicalJsonStringify(observed) === canonicalJsonStringify(contacts) });
    ctx.recordData({ direction: "read", field: "contacts", value: contacts });
    return { contacts };
  },
});
