import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { decisionAnswerer } from "../../../../src/backend/runs/decisions/decision-answer.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";

const AT = "2026-11-07T12:00:00.000Z";
const COMMAND_ID = "33333333-3333-4333-8333-333333333333";
const commandOf = (requestedBy: string, source: string) => CommandRequestSchema.parse({ commandId: COMMAND_ID, requestedAt: AT, requestedBy, source,
  family: "run", type: "cancel", target: { runId: "44444444-4444-4444-8444-444444444444", expectedVersion: 1 } });
const answerOf = (command: ReturnType<typeof commandOf> | undefined) =>
  decisionAnswerer({ get: () => command }, () => "Fixture Operator")(COMMAND_ID, { id: "confirm", label: "Confirm row" }, AT);

describe("decisionAnswerer", () => {
  it("names the local operator for a dashboard command", () => {
    assert.deepEqual(answerOf(commandOf("local-operator", "run-detail")),
      { optionId: "confirm", label: "Confirm row", at: AT, actor: { kind: "person", name: "Fixture Operator" } });
  });

  it("answers on the operator's behalf for an assistant source", () => {
    assert.deepEqual(answerOf(commandOf("local-operator", "assistant")).actor, { kind: "assistant", onBehalfOf: { name: "Fixture Operator" } });
  });

  it("refuses another actor and a missing command", () => {
    assert.throws(() => answerOf(commandOf("other-operator", "run-detail")), /DECISION_ANSWER_ACTOR_UNKNOWN/);
    assert.throws(() => answerOf(undefined), /DECISION_ANSWER_COMMAND_MISSING/);
  });
});
