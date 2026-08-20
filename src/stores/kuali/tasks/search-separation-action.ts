import { defineTask } from "../../../base/task.js";
import { KualiSearchSeparationAction } from "../../../domain/contracts/kuali/search-separation-action.js";
import { classifyKualiActionResolution } from "../../../domain/ui/kuali-action-list.js";
import { kualiDriver } from "../declaration.js";

/**
 * D261's head node: the run names a DOCUMENT and this task discovers its
 * ACTION, so a human never has to paste a 24-hex workflow-step id.
 *
 * The split is D201's: the driver states what the Action List showed and
 * classifies nothing, and `classifyKualiActionResolution` — a pure, unit-tested
 * fold — decides what it means. Every negative is a NAMED durable failure code,
 * because each of them means something different to whoever reads the run:
 * "nobody is holding an action on this document" is an operator fact, "two
 * actions for one number" is a Kuali state somebody must look at, and "the link
 * carries no address" is a page this repository no longer understands.
 */
export const searchSeparationActionTask = defineTask(kualiDriver, KualiSearchSeparationAction, {
  sessions: [{ system: "kuali", access: "read", session: "reuse-worker" }],
  async run({ input, ctx }) {
    const observation = await ctx.driver.readActionListForDocument({
      documentNumber: input.documentNumber,
    });
    if (observation.requestedDocumentNumber !== input.documentNumber) {
      return ctx.fail(
        "unexpected-page-state",
        `Kuali driver answered about document ${observation.requestedDocumentNumber} while the run asked for `
        + `${input.documentNumber}`,
        { subject: input.documentNumber },
      );
    }
    const verdict = classifyKualiActionResolution(observation);
    switch (verdict.state) {
      case "not-in-action-list":
        return ctx.fail("document-not-in-action-list", verdict.reason, { subject: input.documentNumber });
      case "ambiguous":
        return ctx.fail("ambiguous-action-list-match", verdict.reason, { subject: input.documentNumber });
      case "unreadable-link":
        return ctx.fail("unreadable-action-link", verdict.reason, { subject: input.documentNumber });
      case "resolved": {
        ctx.recordData([
          { direction: "read", field: "documentNumber", value: verdict.resolution.documentNumber },
          { direction: "read", field: "actionId", value: verdict.resolution.actionId },
          { direction: "read", field: "actionHref", value: verdict.resolution.actionHref },
          { direction: "read", field: "matchedLinkCount", value: verdict.resolution.matchedLinkCount },
          { direction: "read", field: "pageStateId", value: verdict.resolution.pageStateId },
          { direction: "read", field: "observedAt", value: verdict.resolution.observedAt },
        ]);
        return verdict.resolution;
      }
    }
  },
});
