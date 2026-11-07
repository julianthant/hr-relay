import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { executeClaimedRun } from "../../../../src/backend/runtime/execution/run-executor.js";
import { recordBrowserAction } from "../../../../src/backend/systems/browser-shared/action-notes.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createFinalizationTerminalTestWorld } from "../../../support/helpers/backend/finalization-terminal-world.js";
import { FINALIZATION_ITEM_ID, FINALIZATION_NODE, FINALIZATION_RUN_ID, FINALIZATION_WORKFLOW_ID } from "../../../support/helpers/kuali-finalization-fixtures.js";

const { signal, harness, executorDependencies, parkApproveAndReclaim, cleanup } = createFinalizationTerminalTestWorld();
afterEach(async () => { vi.restoreAllMocks(); await cleanup(); });

describe("required transaction Screenshot action persistence", () => {
  for (const boundary of ["before-submit", "after-submit"] as const) it(`refuses ${boundary} action persistence failure before settlement`, async () => {
    const value = await harness();
    const claimed = await parkApproveAndReclaim(value);
    const original = value.sessions.withTransactionDriver.bind(value.sessions);
    const withDriver: typeof value.sessions.withTransactionDriver = (need, instance, signal, operation, owner) => original(need, instance, signal,
      (driver, ownership, capture) => operation(driver, ownership, async point => {
        await capture(point);
        if (point === boundary) assert.equal(recordBrowserAction("screenshot", "kuali.task-capture", "fixture-bundle:fixture-artifact"), true);
      }), owner);
    vi.spyOn(value.sessions, "withTransactionDriver").mockImplementation(withDriver);
    const notes = createNoteTimelineWriter({ repository: value.database.authority.timelineEvents, clock: value.clock });
    const outcome = await value.bound(() => executeClaimedRun({ ...executorDependencies(value), taskNotes: {
      ...notes,
      emitRunAction(input, run) {
        if (input.action.kind === "screenshot") throw new Error("synthetic Screenshot action persistence failure");
        return notes.emitRunAction(input, run);
      },
    } }, { ...claimed, signal }));
    assert.equal(outcome.state, boundary === "before-submit" ? "failed" : "parked-write");
    const intents = value.database.authority.writeIntents.listByRun(FINALIZATION_RUN_ID);
    assert.equal(intents.length, boundary === "before-submit" ? 0 : 1);
    if (boundary === "after-submit") {
      assert.equal(intents[0]?.status, "parked");
      assert.ok(value.world.events.some(event => event.startsWith("read-back-finalization:")));
    }
    assert.equal(value.world.events.filter(event => event.startsWith("commit:")).length, boundary === "before-submit" ? 0 : 1);
    assert.equal(value.database.authority.runCheckpoints.latest(FINALIZATION_WORKFLOW_ID, FINALIZATION_ITEM_ID, FINALIZATION_NODE), undefined);
    assert.equal(value.database.authority.timelineEvents.page({ runId: FINALIZATION_RUN_ID, limit: 100 }).some(event => event.payload.kind === "operation-confirmed"), false);
  });
});
