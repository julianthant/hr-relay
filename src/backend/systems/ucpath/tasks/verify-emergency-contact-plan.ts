import { UcpathVerifyEmergencyContact } from "../../../../models/systems/ucpath/verify-emergency-contact-plan.js";
import type { JsonValue } from "../../../../rules/validation/canonical-json.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";

import { emergencyContactVerdict,refuseContact,validatePlan } from "../contact-verdict.js";
export const verifyEmergencyContactTask = defineTask(ucpathDriver, UcpathVerifyEmergencyContact, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }], async run({ input, ctx }) {
    try { validatePlan(input); } catch (error) { return refuseContact(error, ctx.fail); }
    const contacts = await ctx.driver.readEmergencyContacts(input).catch(error => refuseContact(error, ctx.fail));
    const verdict = emergencyContactVerdict(input, contacts);
    ctx.recordData(Object.entries<JsonValue>(verdict).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return verdict;
  },
});
