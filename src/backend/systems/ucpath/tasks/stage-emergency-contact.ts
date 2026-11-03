import { UcpathStageEmergencyContact } from "../../../../models/systems/ucpath/stage-emergency-contact.js";
import { preparedContactPlanMatches } from "../../../../rules/ucpath/emergency-contact.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";

import { refuseContact } from "../contact-verdict.js";
export const stageEmergencyContactTask = defineTask(ucpathDriver, UcpathStageEmergencyContact, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }], async run({ input, ctx }) {
    const contacts = await ctx.driver.stageEmergencyContact(input, input.plan).catch(error => refuseContact(error, ctx.fail));
    if (!preparedContactPlanMatches(input.plan, contacts)) return ctx.fail("staged-effect-mismatch", "The full prepared contact set does not match the approved plan.");
    await ctx.confirmed?.verify({ action: { id: "verify-contact-observation", targetId: "verify-contact-observation" }, purpose: "read-validation",
      observe: async () => contacts, matches: observed => canonicalJsonStringify(observed) === canonicalJsonStringify(contacts) });
    ctx.recordData({ direction: "write", field: "contacts", value: contacts });
    return { contacts, stagedPageState: contacts.pageStateId };
  },
});
