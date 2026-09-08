import { defineTask } from "../../../base/task.js";
import { UcpathReadPendingTerminationSet } from "../../../domain/contracts/ucpath/read-pending-termination-set.js";
import { directIdentifierDigestReference } from "../../../domain/redaction.js";
import { ucpathDriver } from "../driver-declaration.js";
import {
  firstDisagreeingName,
  ucpathPendingTransactionSet,
} from "../termination-verdict.js";

export const readPendingTerminationSetTask = defineTask(
  ucpathDriver,
  UcpathReadPendingTerminationSet,
  {
    sessions: [{ system: "ucpath", access: "read", session: "reuse-worker" }],
    async run({ input, ctx }) {
      const scan = await ctx.driver.scanTerminationTransactions({ emplId: input.emplId });
      if (scan.state === "unreadable") {
        return ctx.fail(
          "unexpected-page-state",
          `UCPath could not establish the pending transaction set for ${directIdentifierDigestReference(input.emplId)}: ${scan.reason}`,
          { subject: input.emplId },
        );
      }
      const disagreeing = firstDisagreeingName(scan, input.expectedName);
      if (disagreeing !== undefined) {
        return ctx.fail(
          "subject-mismatch",
          `UCPath returned a transaction for ${directIdentifierDigestReference(disagreeing)} while the run named ${directIdentifierDigestReference(input.expectedName)}`,
          { subject: input.emplId },
        );
      }
      const set = ucpathPendingTransactionSet(scan);
      ctx.recordData([
        { direction: "read", field: "kind", value: set.kind },
        { direction: "read", field: "emplId", value: set.emplId },
        { direction: "read", field: "eligible", value: set.eligible },
        { direction: "read", field: "protected", value: set.protected },
        { direction: "read", field: "observedAt", value: set.observedAt },
        { direction: "read", field: "source", value: set.source },
      ]);
      return set;
    },
  },
);
