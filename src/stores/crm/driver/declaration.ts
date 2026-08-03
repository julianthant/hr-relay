import { declareDriverFor } from "../../../base/store.js";
import type { CrmOnboardingDriver } from "../../../domain/ui/crm-onboarding.js";

export const crmDriver = declareDriverFor<CrmOnboardingDriver>()("crm", "semantic-ready");
