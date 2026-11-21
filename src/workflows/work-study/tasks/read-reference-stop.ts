import { referenceCheckStop } from "../../../models/processing/workbooks/reference-check-stop.js";
import { WorkStudyReadReferenceStop } from "../../../models/workflows/work-study/read-reference-stop.js";
import { defineTask } from "../../../workflow-kit/task.js";

export const readWorkStudyReferenceStopTask = defineTask(WorkStudyReadReferenceStop, {
  sessions: [],
  async run({ input, ctx }) {
    const stop = referenceCheckStop(input);
    ctx.recordData([{ direction: "read", field: "ask", value: stop.ask }]);
    return stop;
  },
});
