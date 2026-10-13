import { CommandExecutor, type CommandExecutionScope } from "../../../src/dashboard/app/commands/command-executor.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { verifyShellCommandEffect } from "../../../src/dashboard/app/commands/command-dispatch.js";
// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act } from "react";
import { type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import {
RUN_START_DOOR_ID,
currentCommandConfirmation,
restoreDashboardTakeoverFocus,
} from "../../../src/dashboard/app/dashboard-app-model.js";

class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);

let mounted: Root | undefined;

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
});

describe("closing a route-backed takeover restores its toolbar door", () => {

  it("uses the persistent main region when a deep link has no matching door", () => {
    const main = document.createElement("main");
    main.id = "fixture-main-region";
    main.tabIndex = -1;
    document.body.append(main);

    restoreDashboardTakeoverFocus(document, RUN_START_DOOR_ID, main.id);
    assert.equal(document.activeElement, main);
  });

  it("fails loud when neither the requested door nor the main fallback exists", () => {
    assert.throws(
      () => restoreDashboardTakeoverFocus(
        document,
        RUN_START_DOOR_ID,
        "missing-main-region",
      ),
      /neither dashboard-run-start-door nor missing-main-region is mounted/u,
    );
  });
});

for (const replaced of ["actor", "client", "day-aba", "authority", "unmount"] as const) {
  it(`refuses captured pending confirmation after ${replaced} replacement before any attempt or POST`, async () => {
    const posts: string[] = [];
    const clientOf = () => createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("unexpected confirmation read");
      posts.push(init.body);
      const request = CommandRequestSchema.parse(JSON.parse(init.body));
      return Response.json({ state: "rejected", commandId: request.commandId, code: "policy-refused", message: "private" });
    } });
    const client = clientOf();
    const original: CommandExecutionScope = { actorId: "local-operator", client, authority: {}, dayRequest: { day: "2026-08-03" } };
    let current: CommandExecutionScope | undefined = original;
    const executor = new CommandExecutor(() => current);
    const pending = { scope: original, commandId: "11111111-1111-4111-8111-111111111111" };
    const captured = async () => {
      if (!currentCommandConfirmation(current, pending, pending)) return;
      const scope = current; if (scope === undefined) throw new Error("unmounted confirmation scope");
      const request = CommandRequestSchema.parse({ family: "run", type: "cancel", commandId: pending.commandId, source: "queue", requestedAt: "2026-08-03T12:00:00.000Z",
        requestedBy: scope.actorId, target: { runId: "22222222-2222-4222-8222-222222222222", expectedVersion: 1 } });
      await executor.execute(request, { scope, readback: (child, reply) => verifyShellCommandEffect(client, "2026-08-03", child, reply) });
    };
    assert.equal(currentCommandConfirmation(original, pending, pending), true);
    assert.equal(currentCommandConfirmation(original, pending, { ...pending }), false, "another dialog identity cannot borrow a scope");
    if (replaced === "unmount") current = undefined;
    else if (replaced === "actor") current = { ...original, actorId: "replacement-operator" };
    else if (replaced === "client") current = { ...original, client: clientOf() };
    else if (replaced === "authority") current = { ...original, authority: {} };
    else { current = { ...original, dayRequest: { day: "2026-08-04" } }; current = { ...original, dayRequest: { day: "2026-08-03" } }; }
    assert.equal(currentCommandConfirmation(current, pending, pending), false);
    await captured(); assert.deepEqual(posts, []); assert.deepEqual(executor.retainedAttempts(), []);
  });
}
