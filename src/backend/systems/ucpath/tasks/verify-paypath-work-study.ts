import { UcpathVerifyPayPathWorkStudy } from "../../../../models/systems/ucpath/verify-paypath-work-study.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { workStudySavedVerdict } from "../../../../rules/work-study/transaction-verdict.js";
import { readWorkStudyVerdict } from "../work-study-findings.js";

// Only this independent read-back after Save and Submit can prove completion; every verdict other than present parks.
export const verifyPayPathWorkStudyTask = defineTask(ucpathDriver, UcpathVerifyPayPathWorkStudy, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const verdict = await readWorkStudyVerdict(ctx.driver, input, workStudySavedVerdict, ctx.fail);
    ctx.recordData([{ direction: "read", field: "state", value: verdict.state }]);
    return verdict;
  },
});
