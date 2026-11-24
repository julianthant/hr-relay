import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { commandRowRevision, createRowWait, ROW_REVISION_WAIT_MS } from "../../../src/dashboard/state/run-wiring-adapter.js";
import { DashboardCommandRequestSchema } from "../../../src/rules/commands/commands.js";

const RUN = "00000001-1111-4111-8111-111111111111";
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("a landed command waits for its row", () => {
  it("reopens nothing when the row is already past the revision it acted on (stream first)", () => {
    const reopen = vi.fn(); const wait = createRowWait(reopen);
    wait.wait(3, 4); vi.advanceTimersByTime(ROW_REVISION_WAIT_MS * 2);
    assert.equal(reopen.mock.calls.length, 0);
  });
  it("reopens nothing when the row arrives after the reply (reply first)", () => {
    const reopen = vi.fn(); const wait = createRowWait(reopen);
    wait.wait(3, 3); wait.observe(3); vi.advanceTimersByTime(ROW_REVISION_WAIT_MS - 1); wait.observe(4); vi.advanceTimersByTime(ROW_REVISION_WAIT_MS);
    assert.equal(reopen.mock.calls.length, 0);
  });
  it("reopens the day once when the row never arrives, and never assumes success", () => {
    const reopen = vi.fn(); const wait = createRowWait(reopen);
    wait.wait(3, 3); vi.advanceTimersByTime(ROW_REVISION_WAIT_MS - 1);
    assert.equal(reopen.mock.calls.length, 0); vi.advanceTimersByTime(1); vi.advanceTimersByTime(ROW_REVISION_WAIT_MS);
    assert.equal(reopen.mock.calls.length, 1);
  });
  it("stops waiting when told to", () => {
    const reopen = vi.fn(); const wait = createRowWait(reopen);
    wait.wait(3, 3); wait.stop(); vi.advanceTimersByTime(ROW_REVISION_WAIT_MS * 2);
    assert.equal(reopen.mock.calls.length, 0);
  });
  it("names the revision only for a command on this run that carries one", () => {
    const base = { commandId: "00000002-1111-4111-8111-111111111111", requestedBy: "local-operator", requestedAt: "2026-11-24T10:00:00.000Z", source: "dashboard" };
    const rename = (runId: string) => DashboardCommandRequestSchema.parse({ ...base, family: "run", type: "rename", target: { runId, expectedVersion: 3 }, payload: { displayName: "x" } });
    assert.equal(commandRowRevision(rename(RUN), RUN), 3);
    assert.equal(commandRowRevision(rename("00000003-1111-4111-8111-111111111111"), RUN), undefined);
  });
});
