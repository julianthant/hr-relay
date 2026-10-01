import { declareDriverFor } from "../../../base/store.js";
import type { CrmOnboardingDriver } from "../../../domain/ui/crm-onboarding.js";

/** Task-safe declaration identity; raw browser ownership remains under `driver/`. */
export const crmDriver = declareDriverFor<CrmOnboardingDriver>()("crm", "semantic-ready");
