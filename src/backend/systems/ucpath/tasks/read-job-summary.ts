import { defineTask } from "../../../../workflow-kit/task.js";
import {
  ReadJobSummaryOutputSchema,
  UcpathReadJobSummary,
} from "../../../../models/systems/ucpath/read-job-summary.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";


export const readJobSummaryTask = defineTask(ucpathDriver, UcpathReadJobSummary, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
  async run({ input, ctx }) {
    const read = await ctx.driver.readJobSummary({ emplId: input.emplId });

    if (read.state === "employee-not-found") {

      return ctx.fail(
        "employee-not-found",
        `UCPath Person Org has no record for EID ${directIdentifierDisplay(read.emplId)} `
        + `(the page rendered ${JSON.stringify(read.observedMarker)}). This is UCPath's own answer, not `
        + "a timeout: a search that times out throws instead.",
      );
    }
    if (read.state === "subject-mismatch") {
      return ctx.fail(
        "subject-mismatch",
        `UCPath opened the Person Org detail for EID ${directIdentifierDisplay(read.observedEid)} while the run asked for `
        + `${directIdentifierDisplay(read.expectedEid)}; refusing to read one person's employment grid as another's.`,
      );
    }

    const output = ReadJobSummaryOutputSchema.parse(read.summary);
    if (output.emplId !== input.emplId) {
      return ctx.fail(
        "unexpected-page-state",
        `the UCPath driver returned a job summary for ${directIdentifierDisplay(output.emplId)} while the task ran for `
        + `${directIdentifierDisplay(input.emplId)}`,
      );
    }
    ctx.recordData([
      { direction: "read", field: "pageStateId", value: output.pageStateId },
      { direction: "read", field: "emplId", value: output.emplId },
      { direction: "read", field: "displayedName", value: output.displayedName },
      { direction: "read", field: "jobRows", value: output.jobRows },
      { direction: "read", field: "rowCount", value: output.rowCount },
      { direction: "read", field: "renderContext", value: output.renderContext },
      { direction: "read", field: "observedAt", value: output.observedAt },
    ]);
    return output;
  },
});
