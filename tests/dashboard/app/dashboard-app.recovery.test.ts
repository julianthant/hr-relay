// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { DashboardApp } from "../../../src/dashboard/app/dashboard-app.js";
import { CommandExecutor, type CommandOutcome, type RetainedCommandAttempt } from "../../../src/dashboard/app/commands/command-executor.js";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../src/models/failures/error-catalog.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { FIXTURE_BOOTSTRAP } from "../../support/fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "../../support/helpers/dashboard/mock-world/fixture-queue.js";
import { MOCK_WORKFLOW_COMPOSITION } from "../../support/helpers/dashboard/mock-world/workflow-composition.js";
import { createFixtureBff } from "../../support/helpers/dashboard/fixture-bff.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Reflect.set(globalThis, "ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState(null, "", "/"); });

for (const state of ["pending", "uncertain", "confirmed", "refused", "conflict"] as const) {
  for (const currentActor of [true, false]) {
    it(`${state} recovery is ${currentActor ? "in" : "outside"} the current actor`, async () => {
      const { app } = createFixtureBff();
      const transport = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => app.request(url, init) });
      const dispatch = vi.fn((input: unknown) => transport.executeCommand(input));
      const client = { ...transport, executeCommand: dispatch };
      const actorId = currentActor ? FIXTURE_BOOTSTRAP.actor.id : "other-operator";
      const request = CommandRequestSchema.parse({ family: "run", type: "cancel", commandId: "00000000-0000-4000-8000-000000000777",
        requestedAt: FIXTURE_BOOTSTRAP.serverClock.now, requestedBy: actorId, source: "dashboard",
        target: { runId: FIXTURE_DAY_WIRE.queueSurfaces[0].runId, expectedVersion: 1 } });
      const feedback = formatErrorCatalogFailure(createErrorCatalogFailure("COMMAND_OUTCOME_UNCERTAIN", {}));
      const outcome: CommandOutcome | undefined = state === "pending" ? undefined : state === "confirmed"
        ? { kind: "confirmed", commandId: request.commandId, readback: {} }
        : { kind: state, commandId: request.commandId, feedback };
      const attempt: RetainedCommandAttempt = { request, body: JSON.stringify(request),
        scope: { actorId, client, authority: {}, dayRequest: {} }, state: state === "pending" ? "pending" : "settled",
        ...(outcome === undefined ? {} : { outcome }) };
      vi.spyOn(CommandExecutor.prototype, "retainedAttempts").mockReturnValue([attempt]);
      window.history.replaceState(null, "", `/?day=${FIXTURE_DAY_WIRE.day}`);
      const host = document.createElement("div"); document.body.append(host);
      const root = createRoot(host);
      try {
        await act(async () => root.render(createElement(DashboardClientProvider, { client,
          children: createElement(DashboardApp, { workflowComposition: MOCK_WORKFLOW_COMPOSITION }) })));
        assert.equal(host.textContent?.includes("cancel: outcome unknown"), currentActor && (state === "pending" || state === "uncertain"));
        assert.equal(dispatch.mock.calls.length, 0, "showing recovery never dispatches a command");
      } finally {
        await act(async () => root.unmount()); host.remove();
      }
    });
  }
}
