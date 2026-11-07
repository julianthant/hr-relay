import { defineTask } from "../../../../workflow-kit/task.js";
import { KualiSearchSeparationAction } from "../../../../models/systems/kuali/search-separation-action.js";
import { classifyKualiActionResolution } from "../../../../models/ui/kuali-action-list.js";
import { kualiDriver } from "../driver-declaration.js";


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
