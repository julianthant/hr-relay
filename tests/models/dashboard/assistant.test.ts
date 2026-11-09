import assert from "node:assert/strict";
import { it } from "vitest";
import { AssistantActionDecisionSchema, AssistantActionProposalSchema, AssistantCallUsageSchema, AssistantTurnUsageSchema, aggregateAssistantUsage, type AssistantCallUsage, AssistantDataTargetSchema, AssistantInlineSchema, AssistantReplyPartSchema, AssistantAcceptedTurnSchema, AssistantSessionViewSchema } from "../../../src/models/dashboard/assistant.js";
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

it("admits only trustworthy safe token counts and explicit partial turn usage", () => {
  const measured = { state: "measured", inputTokens: 12, outputTokens: 3, totalTokens: 15 };
  assert.deepEqual(AssistantCallUsageSchema.parse(measured), measured);
  assert.equal(AssistantCallUsageSchema.safeParse({ state: "measured", inputTokens: 0, outputTokens: 0, totalTokens: 0 }).success, true);
  for (const patch of [{ inputTokens: -1 }, { outputTokens: 0.5 }, { totalTokens: 16 }, { inputTokens: Number.MAX_SAFE_INTEGER + 1 },
    { totalTokens: Infinity }, { raw: "PRIVATE_USAGE_CANARY" }, { inputTokens: "12" }])
    assert.equal(AssistantCallUsageSchema.safeParse({ ...measured, ...patch }).success, false);
  for (const reason of ["missing", "invalid"]) assert.equal(AssistantCallUsageSchema.safeParse({ state: "unavailable", reason }).success, true);
  assert.equal(AssistantCallUsageSchema.safeParse({ state: "unavailable", reason: "missing", totalTokens: 0 }).success, false);
  assert.equal(AssistantTurnUsageSchema.safeParse({ ...measured, callCount: 2 }).success, true);
  assert.equal(AssistantTurnUsageSchema.safeParse({ ...measured, callCount: 0 }).success, false);
  const partial = { state: "unavailable", callCount: 2, measuredCallCount: 1, reason: "missing", partialInputTokens: 12, partialOutputTokens: 3, partialTotalTokens: 15 };
  assert.deepEqual(AssistantTurnUsageSchema.parse(partial), partial);
  for (const patch of [{ measuredCallCount: 3 }, { measuredCallCount: 2 }, { callCount: 0 }, { partialTotalTokens: 16 }, { partialInputTokens: Number.MAX_SAFE_INTEGER + 1 }, { inputTokens: 12 }, { reason: "overflow" }])
    assert.equal(AssistantTurnUsageSchema.safeParse({ ...partial, ...patch }).success, false);
});

const measured: AssistantCallUsage = { state: "measured", inputTokens: 12, outputTokens: 3, totalTokens: 15 };
const unavailable = (reason: "missing" | "invalid"): Extract<AssistantCallUsage, { state: "unavailable" }> => ({ state: "unavailable", reason });

it("sums every completed call, including tool continuations and repeated tool requests", () => {
  assert.deepEqual(aggregateAssistantUsage([measured, measured, measured]),
    { state: "measured", callCount: 3, inputTokens: 36, outputTokens: 9, totalTokens: 45 });
  assert.deepEqual(aggregateAssistantUsage([{ state: "measured", inputTokens: 0, outputTokens: 0, totalTokens: 0 }]),
    { state: "measured", callCount: 1, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
});

for (const failed of [undefined, unavailable("missing"), unavailable("invalid")]) it(`keeps ${failed?.reason ?? "failed/cancelled/stale/unclosed"} calls explicitly partial`, () => {
  assert.deepEqual(aggregateAssistantUsage([measured, failed, measured]), {
    state: "unavailable", callCount: 3, measuredCallCount: 2, reason: failed?.reason ?? "missing",
    partialInputTokens: 24, partialOutputTokens: 6, partialTotalTokens: 30,
  });
});

it("distinguishes exact zero attempted calls from one missing call and gives invalid evidence precedence", () => {
  assert.deepEqual(aggregateAssistantUsage([]), { state: "measured", callCount: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  assert.deepEqual(aggregateAssistantUsage([undefined]), { state: "unavailable", callCount: 1, measuredCallCount: 0, reason: "missing",
    partialInputTokens: 0, partialOutputTokens: 0, partialTotalTokens: 0 });
  assert.deepEqual(aggregateAssistantUsage([undefined, unavailable("missing"), unavailable("invalid")]), {
    state: "unavailable", callCount: 3, measuredCallCount: 0, reason: "invalid", partialInputTokens: 0, partialOutputTokens: 0, partialTotalTokens: 0,
  });
});

it("excludes an unsafe sum's whole call from exact partial totals rather than clamping or wrapping it", () => {
  const huge: AssistantCallUsage = { state: "measured", inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 0, totalTokens: Number.MAX_SAFE_INTEGER };
  assert.deepEqual(aggregateAssistantUsage([huge, measured]), {
    state: "unavailable", callCount: 2, measuredCallCount: 1, reason: "invalid",
    partialInputTokens: Number.MAX_SAFE_INTEGER, partialOutputTokens: 0, partialTotalTokens: Number.MAX_SAFE_INTEGER,
  });
  assert.deepEqual(aggregateAssistantUsage([measured, huge, measured]), {
    state: "unavailable", callCount: 3, measuredCallCount: 2, reason: "invalid", partialInputTokens: 24, partialOutputTokens: 6, partialTotalTokens: 30,
  });
});


it("admits only stable data targets, complete workbook coordinates and inert stored session parts", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const workbook = { kind: "workbook", libraryId: "book", revision: 2, location: { kind: "master" } };
  assert.equal(AssistantDataTargetSchema.safeParse(workbook).success, true);
  for (const target of [{ kind: "url", url: "https://example.invalid" }, { kind: "command", command: "cancel" },
    { kind: "person", identityRef: "[[P1.g1]]" }, { ...workbook, location: { kind: "cell", rowId: "r", fieldId: "name" } },
    { ...workbook, location: { kind: "sheet", sheetId: "s", rowId: "r" } }, { ...workbook, url: "https://example.invalid" }])
    assert.equal(AssistantDataTargetSchema.safeParse(target).success, false);
  const session = { kind: "session", runId: id, label: "Lookup", meta: "queued" };
  assert.equal(AssistantReplyPartSchema.safeParse(session).success, true);
  assert.equal(AssistantReplyPartSchema.safeParse({ ...session, stop: { command: "cancel" } }).success, false);
  assert.equal(AssistantInlineSchema.safeParse({ kind: "value", value: "new", command: "apply" }).success, false);
  assert.equal(AssistantInlineSchema.safeParse({ kind: "failure", code: "ASSISTANT_READ_STALE", text: "Forged" }).success, false);
  const turn = { profileId: id, epoch: 1, conversationId: id, messageId: id, ordinal: 1, acceptedRevision: 2, acceptedAt: "2026-11-08T12:00:00.000Z", proposalAnswer: null };
  assert.equal(AssistantAcceptedTurnSchema.safeParse(turn).success, true);
  assert.equal(AssistantAcceptedTurnSchema.safeParse({ ...turn, createdAt: turn.acceptedAt }).success, false);
  assert.equal(AssistantSessionViewSchema.safeParse({ runId: id, rowRevision: 1, label: "Lookup", meta: "done", state: "done", stop: null }).success, true);
  assert.equal(AssistantSessionViewSchema.safeParse({ runId: id, rowRevision: 1, label: "Lookup", meta: "done", state: "done", stop: { runId: id,
    descriptor: { kind: "command", key: "cancel", command: "cancel", label: "Cancel", expectedVersion: 1, intent: "destructive", placement: ["footer"] } } }).success, false);
});
