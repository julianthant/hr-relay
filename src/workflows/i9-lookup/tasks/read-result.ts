import { defineTask } from "../../../workflow-kit/task.js";
import { ReadI9LookupResult } from "../../../models/workflows/i9-lookup/read-result.js";

export const readI9LookupResultTask = defineTask(ReadI9LookupResult, {
  sessions: [],
  async run({ input, ctx }) {
    ctx.recordData(Object.entries(input.signer).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return input.signer;
  },
});
