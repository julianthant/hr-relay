import { UcpathProbeEmergencyContact } from "../../../../models/systems/ucpath/match-emergency-contact-plan.js";
import type { JsonValue } from "../../../../rules/validation/canonical-json.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";

import { emergencyContactVerdict,refuseContact,validatePlan } from "../contact-verdict.js";
export const probeEmergencyContactTask = defineTask(ucpathDriver, UcpathProbeEmergencyContact, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }], async run({ input, ctx }) {
    try { validatePlan(input); } catch (error) { return refuseContact(error, ctx.fail); }
    const contacts = await ctx.driver.readEmergencyContacts(input).catch(error => refuseContact(error, ctx.fail));
    const verdict = emergencyContactVerdict(input, contacts);
    await ctx.confirmed?.verify({ action: { id: "verify-contact-observation", targetId: "verify-contact-observation" }, purpose: "read-validation",
      observe: async () => verdict, matches: observed => canonicalJsonStringify(observed) === canonicalJsonStringify(verdict) });
    ctx.recordData(Object.entries<JsonValue>(verdict).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return verdict;
  },
});
