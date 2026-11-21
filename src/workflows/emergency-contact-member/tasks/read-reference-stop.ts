import { referenceCheckStop } from "../../../models/processing/workbooks/reference-check-stop.js";
import { EmergencyContactMemberReadReferenceStop } from "../../../models/workflows/emergency-contact-member/read-reference-stop.js";
import { defineTask } from "../../../workflow-kit/task.js";

export const readEmergencyContactMemberReferenceStopTask = defineTask(EmergencyContactMemberReadReferenceStop, {
  sessions: [],
  async run({ input, ctx }) {
    const stop = referenceCheckStop(input);
    ctx.recordData([{ direction: "read", field: "ask", value: stop.ask }]);
    return stop;
  },
});
