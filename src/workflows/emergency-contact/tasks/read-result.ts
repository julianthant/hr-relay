import { defineTask } from "../../../workflow-kit/task.js";
import { ReadEmergencyContactResult } from "../../../models/workflows/emergency-contact/result.js";
export const readEmergencyContactResultTask = defineTask(ReadEmergencyContactResult, {
  sessions: [], async run({ input, ctx }) {
    ctx.recordData([{ direction: "read", field: "approval", value: input.approval }, { direction: "read", field: "members", value: input.members }]);
    return input;
  },
});
