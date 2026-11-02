import type { z } from "zod";
import { defineStepEntries } from "../../../workflow-kit/workflow-definition.js";
import { CrmReadHireData } from "../../../models/systems/crm/read-hire-data.js";
import type { OnboardingInputValue } from "../../../models/workflows/onboarding/input.js";

export function readCrmDataTask(step: Readonly<{ key: string; label: string }>) {
  return defineStepEntries(step).task("crm-source", CrmReadHireData, { replay: "always-rerun" });
}
export function crmDataInput(input: OnboardingInputValue): z.input<typeof CrmReadHireData.input> {
  return { email: input.email };
}
