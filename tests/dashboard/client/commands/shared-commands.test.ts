import assert from "node:assert/strict";
import { it } from "vitest";
import { checkedCommandResult } from "../../../../src/dashboard/client/commands/shared-commands.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { NOW, UUID_1, UUID_2 } from "../../../support/fixtures/phase1c-contract-fixtures.js";

it("binds explicit no-change readback to its actual zero-match collection only", () => {
  const request = CommandRequestSchema.parse({ commandId: UUID_1, requestedAt: NOW, requestedBy: "local-operator", source: "notification-bell",
    family: "notification", type: "notification-read-all", target: { actorId: "local-operator", members: [], matchingCount: 0 } });
  const result = { state: "applied", commandId: UUID_1, affectedTargets: [], noChange: "no-matching-notifications" };
  assert.deepEqual(checkedCommandResult(request, result), result);
  assert.deepEqual(checkedCommandResult(request, { ...result, state: "already-applied" }), { ...result, state: "already-applied" });
  for (const candidate of [
    { ...request, type: "notification-read", target: { actorId: "local-operator", notificationId: UUID_2, expectedVersion: 1 } },
    { ...request, target: { actorId: "local-operator", members: [{ notificationId: UUID_2, expectedVersion: 1 }], matchingCount: 1 } },
    { ...request, family: "workflow-batch", type: "set-batch-grouping", target: { batchId: UUID_2, expectedVersion: 1 }, payload: { groupInQueue: false } },
  ]) assert.throws(() => checkedCommandResult(CommandRequestSchema.parse(candidate), result));
  assert.throws(() => checkedCommandResult(request, { state: "applied", commandId: UUID_1, affectedTargets: [] }));
  assert.throws(() => checkedCommandResult(request, { ...result, affectedTargets: [{ family: "notification", notificationId: UUID_2 }] }));
});
