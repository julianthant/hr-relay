import { defineTask } from "../../../../workflow-kit/task.js";
import { UcpathReadHireReceipt } from "../../../../models/systems/ucpath/hire-tasks.js";
import { ucpathDriver } from "../driver-declaration.js";
import { runHireOperation } from "../hire-task-error.js";
import { ucpathHireVerdict } from "../../../../rules/ucpath/hire-verdict.js";
export const readHireReceiptTask = defineTask(ucpathDriver, UcpathReadHireReceipt, {
  screenshots: "task", sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
  run: ({ input, ctx }) => runHireOperation(ctx, async () => {
    const verdict = ucpathHireVerdict(input.query, await ctx.driver.scanHireTransactions(input.query));
    if (verdict.state !== "present" || verdict.proof.transactionId !== input.transactionId) throw new Error("current-hire-receipt-unverified");
    await ctx.captureScreenshot();
    ctx.recordData(Object.entries(verdict.proof).map(([field, value]) => ({ direction: "read" as const, field, value })));
    return verdict.proof;
  }),
});
