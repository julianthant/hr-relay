/** The persistent feed accepts only settlements the D253 fold classified as refusals. */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { commandResultFeedEntry } from "../../../src/dashboard/surfaces/actions-model.js";
import { settleCommandResult } from "../../../src/dashboard/app/command-result.js";
import { CommandResultSchema } from "../../../src/domain/commands.js";

const COMMAND_ID = "1a000000-0000-4000-8000-000000000001";
const RUN_ID = "1a000000-0000-4000-8000-000000000002";

const context = {
  targetRunId: RUN_ID,
  expectedVersion: 3,
  commandId: COMMAND_ID,
  subject: "Jordan Reyes",
  workflowLabel: "Person lookup",
  actionLabel: "Retry",
  clock: "3:07 PM",
  actorId: "local-operator",
} as const;

describe("command result feed settlement (D253)", () => {
  it("refuses to create persistent failure context for an applied command", () => {
    const settlement = settleCommandResult(CommandResultSchema.parse({
      state: "applied",
      commandId: COMMAND_ID,
      affectedTargets: [{ family: "run", runId: RUN_ID }],
    }));
    assert.equal(commandResultFeedEntry({ settlement, ...context }), undefined);
  });

  it("preserves both refusal arms and their distinct server facts", () => {
    const conflict = commandResultFeedEntry({
      settlement: settleCommandResult(CommandResultSchema.parse({
        state: "conflict", commandId: COMMAND_ID, currentVersion: 4, message: "the row moved",
      })),
      ...context,
    });
    const rejected = commandResultFeedEntry({
      settlement: settleCommandResult(CommandResultSchema.parse({
        state: "rejected", commandId: COMMAND_ID, code: "policy-refused", message: "policy blocks this retry",
      })),
      ...context,
    });

    assert.equal(conflict?.settlement.kind, "refused");
    assert.equal(conflict?.settlement.reason, "conflict");
    assert.equal(rejected?.settlement.reason, "rejected");
    assert.equal(rejected?.settlement.message, "policy blocks this retry");
  });
});
