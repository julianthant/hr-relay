import type { z } from "zod";
import { reuseTask } from "../../../workflow-kit/workflow-definition.js";
import { CrmReadHireData } from "../../../models/systems/crm/read-hire-data.js";
import type { OnboardingInputValue } from "../../../models/workflows/onboarding/input.js";

export function readCrmDataTask(step: Readonly<{ key: string; label: string }>) {
  return reuseTask(step, { id: "crm-source", contract: CrmReadHireData, replay: "always-rerun" }, crmDataInput);
}
function crmDataInput(input: OnboardingInputValue): z.input<typeof CrmReadHireData.input> {
  return { email: input.email };
}
