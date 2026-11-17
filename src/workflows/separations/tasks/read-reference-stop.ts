import { referenceCheckStop } from "../../../models/processing/workbooks/reference-check-stop.js";
import { SeparationsReadReferenceStop } from "../../../models/workflows/separations/read-reference-stop.js";
import { defineTask } from "../../../workflow-kit/task.js";

export const REFERENCE_STOP_NODE = "reference-stop";

export const readSeparationsReferenceStopTask = defineTask(SeparationsReadReferenceStop, {
  sessions: [],
  async run({ input, ctx }) {
    const stop = referenceCheckStop(input);
    ctx.recordData([{ direction: "read", field: "ask", value: stop.ask }]);
    return stop;
  },
});
