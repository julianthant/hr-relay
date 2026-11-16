import { ContractFieldPathSchema } from "../../task/task-contract.js";
import { UCPATH_HIRE_SUBJECT } from "../../ui/ucpath-hire.js";

export const UCPATH_HIRE_SUBJECT_CONTRACT = { kind: "person", expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
  observe: UCPATH_HIRE_SUBJECT, match: "normalized-exact-name", requiredAt: "after-prepare-before-fence" } as const;
export const UCPATH_HIRE_READ_CONTRACT = { effect: "read", errorCodes: ["UCPATH_HIRE_REFUSED"],
  subject: { kind: "none", reason: "Independently scans and verifies every exact hire transaction before reporting saved-effect evidence" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "live" }, scenarios: ["onboarding/write-transactions"] } as const;
