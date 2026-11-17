import { referenceCheckStop } from "../../../models/processing/workbooks/reference-check-stop.js";
import { OnboardingReadReferenceStop } from "../../../models/workflows/onboarding/read-reference-stop.js";
import { defineTask } from "../../../workflow-kit/task.js";

export const REFERENCE_STOP_NODE = "reference-stop";

export const readOnboardingReferenceStopTask = defineTask(OnboardingReadReferenceStop, {
  sessions: [],
  async run({ input, ctx }) {
    const stop = referenceCheckStop(input);
    ctx.recordData([{ direction: "read", field: "ask", value: stop.ask }]);
    return stop;
  },
});
