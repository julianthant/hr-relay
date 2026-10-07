import { declareDriverFor } from "../../../workflow-kit/task-registry.js";
import type { CrmOnboardingDriver } from "../../../models/ui/crm-onboarding.js";

/** Task-safe declaration identity; raw browser ownership remains under `driver/`. */
export const crmDriver = declareDriverFor<CrmOnboardingDriver>()("crm", "semantic-ready");
