import { UcpathMatchPayPathWorkStudy } from "../../../../models/systems/ucpath/match-paypath-work-study.js";
import { defineTask } from "../../../../workflow-kit/task.js";
import { ucpathDriver } from "../driver-declaration.js";
import { workStudyPrewriteVerdict } from "../../../../rules/work-study/transaction-verdict.js";
import { readWorkStudyVerdict } from "../work-study-findings.js";

export const matchPayPathWorkStudyTask = defineTask(ucpathDriver, UcpathMatchPayPathWorkStudy, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const verdict = await readWorkStudyVerdict(ctx.driver, input, workStudyPrewriteVerdict, ctx.fail);
    ctx.recordData([{ direction: "read", field: "state", value: verdict.state }]);
    return verdict;
  },
});
