import assert from "node:assert/strict";
import { it } from "vitest";
import { AssistantActionProposalSchema } from "../../../src/models/dashboard/assistant.js";
import { ASSISTANT_START_PROPOSAL } from "../../support/fixtures/dashboard/assistant-start.js";

it("refuses missing or inconsistent plan facts, extra fields and multiple runs", () => {
  const proposal = ASSISTANT_START_PROPOSAL;
  assert.equal(proposal.effect, "workflow-start");
  if (proposal.effect !== "workflow-start") throw new Error("workflow start fixture required");
  for (const patch of [
    { startPlan: undefined }, { workflowId: "separations" }, { dryRun: true }, { targetLabel: "Different input" },
    { expiresAt: "2099-01-02T00:00:00Z" },
    ...[
      { planned: [] }, { planned: [...proposal.startPlan.planned, ...proposal.startPlan.planned] },
      { refused: [{ entry: 1, code: "active-run-exists", message: "Already running" }] },
      { browserMode: undefined }, { captureBrowserScreenshots: false },
    ].map(patch => ({ startPlan: { ...proposal.startPlan, ...patch } })),
  ]) assert.equal(AssistantActionProposalSchema.safeParse({ ...proposal, ...patch }).success, false);
});
