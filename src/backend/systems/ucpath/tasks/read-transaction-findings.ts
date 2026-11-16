import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathReadTransactionFindings } from "../../../../models/systems/ucpath/read-transaction-findings.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";
import { firstDisagreeingName } from "../termination-verdict.js";

export const readTransactionFindingsTask = defineTask(ucpathDriver, UcpathReadTransactionFindings, {
  sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const scan = await ctx.driver.readTransactionFindings({ emplId: input.emplId });
    if (scan.state === "unreadable") {
      return ctx.fail("unexpected-page-state", `UCPath could not establish transaction findings: ${scan.reason}`, { subject: input.emplId });
    }
    if (scan.emplId !== input.emplId) {
      return ctx.fail("subject-mismatch", "UCPath transaction findings belong to another employee", { subject: input.emplId });
    }
    const disagreeing = firstDisagreeingName(scan, input.expectedName);
    if (disagreeing !== undefined) {
      return ctx.fail("subject-mismatch",
        `UCPath returned a transaction for ${directIdentifierDisplay(disagreeing)} while the run named ${directIdentifierDisplay(input.expectedName)}`,
        { subject: input.emplId });
    }
    ctx.recordData([
      { direction: "read", field: "state", value: scan.state },
      { direction: "read", field: "emplId", value: scan.emplId },
      { direction: "read", field: "rows", value: scan.rows },
      { direction: "read", field: "scannedRowCount", value: scan.scannedRowCount },
      { direction: "read", field: "completeness", value: scan.completeness },
      { direction: "read", field: "observedAt", value: scan.observedAt },
      { direction: "read", field: "source", value: scan.source },
    ]);
    return scan;
  },
});
