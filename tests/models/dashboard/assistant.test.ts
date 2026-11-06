import assert from "node:assert/strict";
import { it } from "vitest";
import { AssistantActionDecisionSchema, AssistantActionProposalSchema } from "../../../src/models/dashboard/assistant.js";
import { ASSISTANT_START_PROPOSAL } from "../../support/fixtures/dashboard/assistant-start.js";

it("refuses missing or inconsistent plan facts, extra fields and rows outside the source bound", () => {
  const proposal = ASSISTANT_START_PROPOSAL;
  assert.equal(proposal.effect, "workflow-start");
  if (proposal.effect !== "workflow-start") throw new Error("workflow start fixture required");
  const row = proposal.startPlan.planned[0]; assert.ok(row);
  for (const patch of [
    { startPlan: undefined }, { workflowId: "separations" }, { dryRun: true }, { source: "selected-run" },
    { expiresAt: "2099-01-02T00:00:00Z" }, { person: { name: "Extra" } },
    ...[
      { planned: [] }, { planned: [row, row] }, { planned: [{ ...row, display: { kind: "person" } }] }, { planned: [{ title: row.title }] },
      { refused: [{ entry: 1, code: "active-run-exists", message: "Already running" }] },
      { browserMode: undefined }, { captureBrowserScreenshots: false },
    ].map(patch => ({ startPlan: { ...proposal.startPlan, ...patch } })),
  ]) assert.equal(AssistantActionProposalSchema.safeParse({ ...proposal, ...patch }).success, false, JSON.stringify(patch));
  const entries = { ...proposal, source: "entries" };
  assert.equal(AssistantActionProposalSchema.safeParse({ ...entries, startPlan: { ...proposal.startPlan, planned: Array.from({ length: 20 }, () => row) } }).success, true);
  assert.equal(AssistantActionProposalSchema.safeParse({ ...entries, startPlan: { ...proposal.startPlan, planned: Array.from({ length: 21 }, () => row) } }).success, false);
  assert.equal(AssistantActionProposalSchema.safeParse({ ...entries, startPlan: { ...proposal.startPlan,
    planned: [row, { title: "4502", display: { kind: "document", documentNumber: "4502" } }] } }).success, true);
});

it("binds a run action to one run row and a decision's digest to Confirm only", () => {
  const action = { chatId: "00000000-0000-4000-8000-000000000001", actionId: "00000000-0000-4000-8000-000000000002", revision: 1, expiresAt: "2099-01-01T00:00:00Z",
    label: "Pause Person Lookup", targetLabel: "EID 10101010", effect: "run-action", action: "pause", workflowId: "person-lookup",
    run: { runId: "00000000-0000-4000-8000-000000000004", expectedVersion: 3 }, row: { title: "EID 10101010", display: { kind: "request" } } };
  assert.equal(AssistantActionProposalSchema.safeParse(action).success, true);
  for (const patch of [{ action: "delete" }, { run: { runId: "x", expectedVersion: 3 } }, { row: undefined }]) assert.equal(AssistantActionProposalSchema.safeParse({ ...action, ...patch }).success, false);
  const identity = { chatId: action.chatId, actionId: action.actionId, revision: 1 };
  assert.equal(AssistantActionDecisionSchema.safeParse({ ...identity, decision: "confirm", reviewedDigest: "a".repeat(64) }).success, true);
  assert.equal(AssistantActionDecisionSchema.safeParse({ ...identity, decision: "confirm" }).success, false);
  assert.equal(AssistantActionDecisionSchema.safeParse({ ...identity, decision: "cancel", reviewedDigest: "a".repeat(64) }).success, false);
  assert.equal(AssistantActionDecisionSchema.safeParse({ ...identity, decision: "cancel" }).success, true);
  assert.equal(AssistantActionDecisionSchema.safeParse({ ...identity, decision: "confirm", reviewedDigest: "A".repeat(64) }).success, false);
});
