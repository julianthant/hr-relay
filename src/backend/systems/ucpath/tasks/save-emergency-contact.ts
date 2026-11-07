import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { UcpathContactSaveError } from "../../../../models/ui/ucpath-emergency-contact.js";
import { UcpathSaveEmergencyContact } from "../../../../models/systems/ucpath/save-emergency-contact.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { emergencyContactVerdict, refuseContact, validatePlan } from "../contact-verdict.js";

export const saveEmergencyContactTask = defineTask(ucpathDriver, UcpathSaveEmergencyContact, {
  sessions: [{ system: "ucpath", access: "transaction", session: "reuse-worker" }], async run({ input, ctx }) {
    try { validatePlan(input); } catch (error) { return refuseContact(error, ctx.fail); }
    const contacts = await ctx.driver.saveEmergencyContact(input, ctx.mutation).catch(error => {
      if (error instanceof UcpathContactSaveError) return ctx.fail(error.code, error.code === "CONTACT_SAVE_UNAVAILABLE" ? ERROR_CATALOG.CONTACT_SAVE_UNAVAILABLE.text : ERROR_CATALOG.SAVED_EFFECT_MISMATCH.text);
      return refuseContact(error, ctx.fail);
    });
    const verdict = emergencyContactVerdict(input, contacts);
    if (verdict.state !== "present") return ctx.fail("saved-effect-mismatch", "The complete persisted contact set does not match the approved plan.");
    ctx.recordData({ direction: "read", field: "proof", value: verdict.proof });
    return { proof: verdict.proof };
  },
});
