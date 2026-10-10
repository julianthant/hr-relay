
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { commandResultFeedEntry, toastAppliedCommandResult } from "../../../../../src/dashboard/surfaces/shared/actions/actions-model.js";
import { settleCommandResult } from "../../../../../src/dashboard/app/commands/command-result.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";

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

describe("command result feed settlement", () => {
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


describe("the applied-command toast", () => {
  // Create a recorder per test so an applied toast cannot leak into a later refusal case.
  const recorder = (): {
    toasted: { title: string; description: string }[];
    toast: (input: { tone: "success"; title: string; description: string }) => string;
  } => {
    const toasted: { title: string; description: string }[] = [];
    return {
      toasted,
      toast: (input): string => {
        toasted.push({ title: input.title, description: input.description });
        return "toast-id";
      },
    };
  };

  it("draws the applied receipt from the settlement and the surface's own context", () => {
    const { toasted, toast } = recorder();
    toastAppliedCommandResult(toast, {
      settlement: settleCommandResult(CommandResultSchema.parse({
        state: "applied",
        commandId: COMMAND_ID,
        affectedTargets: [{ family: "run", runId: RUN_ID }],
      })),
      actionLabel: "Retry",
      subject: "Jordan Reyes",
      clock: "3:07 PM",
      actorId: "local-operator",
    });
    assert.deepEqual(toasted, [{ title: "Retry", description: "Jordan Reyes · 3:07 PM" }]);
  });

  it("throws rather than falling silent when handed a refusal", () => {
    const { toasted, toast } = recorder();
    assert.throws(
      () => {
        toastAppliedCommandResult(toast, {
          settlement: settleCommandResult(CommandResultSchema.parse({
            state: "rejected", commandId: COMMAND_ID, code: "policy-refused", message: "policy blocks this retry",
          })),
          actionLabel: "Retry",
          subject: "Jordan Reyes",
          clock: "3:07 PM",
          actorId: "local-operator",
        });
      },
      /refused settlement of Retry on Jordan Reyes/u,
      "a quiet return would leave the operator with no toast at all and no reason for its absence",
    );
    assert.deepEqual(toasted, [], "and it must not have emitted a success toast on the way out");
  });
});
