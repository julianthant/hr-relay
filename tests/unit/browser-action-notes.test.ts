import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { recordBrowserAction, withBrowserActionNotes, type BrowserAction } from "../../src/infra/browser/action-notes.js";

describe("browser action notes", () => {
  it("holds successful gestures in memory until the operation settles", async () => {
    const clock = manualClock(new Date("2026-09-23T12:00:00.000Z"));
    let release: (() => void) | undefined;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let drained: readonly BrowserAction[] = [];
    const operation = withBrowserActionNotes(clock, async () => {
      recordBrowserAction("typed", "kuali.action-list.search-input");
      await barrier;
      recordBrowserAction("clicked", "kuali.action-list.search-go-button");
      return "settled";
    }, (actions) => { drained = actions; });

    assert.deepEqual(drained, [], "the action sink must not run while a transaction is between fence and click");
    release?.();
    assert.equal(await operation, "settled");
    assert.deepEqual(drained.map(({ kind, targetId }) => ({ kind, targetId })), [
      { kind: "typed", targetId: "kuali.action-list.search-input" },
      { kind: "clicked", targetId: "kuali.action-list.search-go-button" },
    ]);
    recordBrowserAction("clicked", "kuali.action-list.search-go-button");
    assert.equal(drained.length, 2, "a settled scope cannot collect later work");
  });

  it("retains every gesture in a busy operation", async () => {
    const clock = manualClock(new Date("2026-09-23T12:00:00.000Z"));
    let recorded = 0;
    await withBrowserActionNotes(clock, async () => {
      for (let index = 0; index < 258; index += 1) recordBrowserAction("clicked", "ucpath.person-org.result");
    }, (actions) => {
      recorded = actions.length;
    });
    assert.equal(recorded, 258);
  });
});
