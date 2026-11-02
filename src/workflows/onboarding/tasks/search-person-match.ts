import type { z } from "zod";
import { reuseTask } from "../../../workflow-kit/workflow-definition.js";
import { SearchPersonMatch } from "../../../models/systems/ucpath/search-person-match.js";
import type { HireEmployee } from "../../../models/workflows/onboarding/read-hire-plan.js";

export function searchPersonMatchTask(step: Readonly<{ key: string; label: string }>) {
  return reuseTask(step, { id: "ucpath-source", contract: SearchPersonMatch, replay: "always-rerun" }, personMatchInput);
}
function personMatchInput(employee: HireEmployee): z.input<typeof SearchPersonMatch.input> {
  return { firstName: employee.firstName, lastName: employee.lastName,
    dob: `${employee.dob.slice(5, 7)}/${employee.dob.slice(8, 10)}/${employee.dob.slice(0, 4)}`,
    ...(employee.ssn === null ? {} : { ssn: employee.ssn }) };
}
