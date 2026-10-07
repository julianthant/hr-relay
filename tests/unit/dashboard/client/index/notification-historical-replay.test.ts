import assert from "node:assert/strict";
import { it } from "vitest";
import { createSharedCommands } from "../../../../../src/dashboard/client/shared-commands.js";
import type { DashboardTransport } from "../../../../../src/dashboard/client/transport.js";
import { CommandRequestSchema } from "../../../../../src/rules/commands/commands.js";

it("sends an exact historical Snooze replay envelope without rewriting its deadline or provenance", async () => {
  const request = {
    commandId: "11111111-1111-4111-8111-111111111111", requestedAt: "2026-08-03T17:00:00.000Z",
    requestedBy: "local-operator", source: "notification-bell", family: "notification", type: "notification-snooze",
    target: { notificationId: "22222222-2222-4222-8222-222222222222", actorId: "local-operator", expectedVersion: 4 },
    payload: { until: "2026-08-03T17:30:00.000Z" },
  };
  assert.equal(CommandRequestSchema.safeParse(request).success, false);
  let posted: unknown;
  const transport = { requestJson: async (_path: string, init?: RequestInit) => {
    if (typeof init?.body !== "string") assert.fail("command body must be serialized JSON");
    posted = JSON.parse(init.body);
    return { state: "already-applied", commandId: request.commandId,
      affectedTargets: [{ family: "notification", notificationId: request.target.notificationId }] };
  } } as DashboardTransport;
  const result = await createSharedCommands(transport).executeCommand(request);
  assert.equal(result.state, "already-applied");
  assert.deepEqual(posted, request);
});
