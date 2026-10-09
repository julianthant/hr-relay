import { defineTask } from "../../../../workflow-kit/task.js";
import {
  ReadJobSummaryOutputSchema,
  UcpathReadJobSummary,
} from "../../../../models/systems/ucpath/read-job-summary.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";

/**
 * D194's job-summary read, executed.
 *
 * Ported knowledge: legacy `1bffbd65`,
 * `src/systems/ucpath/job-summary.ts:249-298` (the multi-row status scan, which
 * is where S21's all-terminated refusal and S23's concurrent-jobs refusal live)
 * and `:427-573` / `:656-776` (the Work Location + Job Information extractions).
 * What ports is the KNOWLEDGE — which facts a job row carries and which of them
 * decide a separation — not the code: legacy reads them off
 * `WF_JOB_SUMMARY.GBL`'s two lazily-rendered tabs, and this reads the same
 * facts off the Person Org detail page's one grid (see
 * `src/domain/ui/ucpath-job-summary.ts` for why).
 *
 * **What deliberately does NOT port: the judgment.** Legacy THROWS inside the
 * page module when every row is Terminated, and throws again when two rows are
 * not — so "already separated" and "two concurrent jobs" exist only as thrown
 * strings, are computed only when the search happened to render a grid (S22),
 * and can never reach an operator as data. Here the task reports what the grid
 * showed and `workflow:separations/classify-job-summary` folds it. A read that
 * refuses on the shape of its own answer cannot serve a gate whose whole job is
 * to SHOW the operator that answer.
 */
export const readJobSummaryTask = defineTask(ucpathDriver, UcpathReadJobSummary, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  retry: { attempts: 2, backoffMs: 2_000, retryOn: "transient" },
  async run({ input, ctx }) {
    const read = await ctx.driver.readJobSummary({ emplId: input.emplId });

    if (read.state === "employee-not-found") {
      // S18/S19: a genuine UCPath answer, not a timeout. The CALLER decides
      // whether a not-found EID falls back to a name search (a short/incomplete
      // EID) or fails loud (a complete 8-digit one) — that decision needs the
      // input record, which this task does not have.
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
