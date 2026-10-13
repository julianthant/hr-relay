import { defineTask } from "../../../workflow-kit/task.js";
import { ReadResolvedIdentity } from "../../../models/workflows/person-lookup/read-resolved-identity.js";

import { resolvePersonLookupIdentity } from "../../../rules/matching/person-lookup.js";
export const readResolvedIdentityTask = defineTask(ReadResolvedIdentity, {
  sessions: [],
  async run({ input, ctx }) {
    const output = resolvePersonLookupIdentity(input);
    ctx.log.info("Identity cross-check", { method: output.method, candidateEids: output.candidateEids.join(", ") });
    ctx.recordData(Object.entries(output).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return output;
  },
});
