import type { z } from "zod";
import { defineStepEntries } from "../../../workflow-kit/workflow-definition.js";
import type { NodeConditionSpec } from "../../../models/workflow/node-condition.js";
import { SearchPersonOrg } from "../../../models/systems/ucpath/search-person-org.js";
import type { I9CheckInputValue } from "../../../models/workflows/i9-check/input.js";

export function searchPersonOrgTask<const Id extends string>(step: Readonly<{ key: string; label: string }>, id: Id, when: NodeConditionSpec) {
  return defineStepEntries(step).task(id, SearchPersonOrg, { replay: "checkpoint", when });
}
export function personOrgInput(input: I9CheckInputValue): z.output<typeof SearchPersonOrg.input> {
  return { kind: "by-name", name: input.person.name, keepNonHdh: true };
}
