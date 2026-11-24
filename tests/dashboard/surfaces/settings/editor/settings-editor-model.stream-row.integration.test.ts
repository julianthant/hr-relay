// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { mountSettingsHarness, settingsAction, syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";
import { SETTINGS_ROW_WAIT_MS } from "../../../../../src/dashboard/surfaces/settings/editor/settings-editor-model.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function setup(readDocument?: () => unknown) {
  const authority = await syntheticSettingsAuthority(); cleanups.push(authority.close);
  const mounted = await mountSettingsHarness(authority, "general", readDocument); cleanups.push(mounted.close); return { ...mounted, authority };
}
type Harness = Awaited<ReturnType<typeof setup>>;
const FAILURE = { tone: "danger", title: "Settings weren't saved. The previous value is back.", key: "settings-save" } as const;
const settingsReads = (h: Harness): number => h.requests.filter(request => request === "GET /api/v1/settings/editable").length;
const labelValue = (h: Harness): unknown => {
  const editor = h.controller().editor;
  if (editor.state !== "loaded") return undefined;
  return editor.document.sections.flatMap(section => section.leaves).find(leaf => leaf.path === "actor.label")?.effectiveValue;
};
const settled = async (check: () => void): Promise<void> => {
  await vi.waitFor(async () => { await settingsAction(() => undefined); check(); }, { timeout: 5000, interval: 50 });
};
/** Holds each row the save would deliver until the test releases it, so the reply arrives first. */
const holdRows = (h: Harness): (() => void) => {
  const deliver = h.ports.deliver;
  let held = 0;
  h.ports.deliver = () => { held += 1; };
  return () => { for (; held > 0; held -= 1) deliver(); };
};
const save = async (h: Harness, value: string): Promise<void> => {
  await settingsAction(() => h.controller().update("actor.label", value, true));
  await settingsAction(() => undefined);
};

describe("an ordinary save's readback joins its reply to the stream's settings row", () => {
  it("confirms from a row that arrived before the reply, without reading Settings again", async () => {
    const h = await setup(); const reads = settingsReads(h);
    await save(h, "Row first");
    await settled(() => assert.equal(h.controller().dirtyCount, 0));
    assert.equal(labelValue(h), "Row first");
    assert.equal(settingsReads(h), reads, "the row answers the readback");
    assert.deepEqual(h.problems, []); assert.equal(h.commands.length, 1);
    assert.equal(h.controller().locked, false);
  });

  it("waits after the reply for the row at its revision", async () => {
    const h = await setup(); const reads = settingsReads(h);
    const release = holdRows(h);
    await save(h, "Reply first");
    await settled(() => assert.equal(h.commands.length, 1));
    await settingsAction(() => undefined);
    assert.equal(h.controller().dirtyCount, 1, "the save waits for its row");
    release();
    await settled(() => assert.equal(h.controller().dirtyCount, 0));
    assert.equal(labelValue(h), "Reply first");
    assert.equal(settingsReads(h), reads);
    assert.deepEqual(h.problems, []);
  });

  it("ends superseded when the row carries a later writer's revision", async () => {
    const h = await setup(); const reads = settingsReads(h);
    const release = holdRows(h);
    await save(h, "Overtaken draft");
    await settled(() => assert.equal(h.commands.length, 1));
    assert.equal(h.authority.apply({ "actor.label": { set: "Later writer" } }).state, "applied");
    release();
    await settled(() => assert.deepEqual(h.problems, [FAILURE]));
    assert.equal(labelValue(h), "Later writer");
    assert.equal(settingsReads(h), reads);
    assert.equal(h.commands.length, 1, "a superseded save is never resent");
  });

  it("falls back to reading Settings when the row arrives unavailable, then unlocks on the next good row", async () => {
    const h = await setup(); const reads = settingsReads(h);
    const read = h.ports.read;
    const release = holdRows(h);
    await save(h, "Unavailable row");
    await settled(() => assert.equal(h.commands.length, 1));
    h.ports.read = () => { throw new Error("synthetic-sensitive-server-message"); };
    release();
    h.ports.read = read;
    await settled(() => assert.equal(h.controller().dirtyCount, 0));
    assert.ok(settingsReads(h) > reads, "an unresolved readback reads Settings");
    assert.equal(labelValue(h), "Unavailable row");
    assert.deepEqual(h.problems, []); assert.equal(h.commands.length, 1);
    assert.equal(h.controller().locked, true, "an unavailable row keeps the editor display-only");
    await settingsAction(() => h.ports.deliver());
    assert.equal(h.controller().locked, false);
    assert.doesNotMatch(h.host.textContent ?? "", /synthetic-sensitive-server-message/u);
  });

  it(`stops waiting for the row after ${String(SETTINGS_ROW_WAIT_MS)} ms and reads Settings`, async () => {
    const h = await setup(); const reads = settingsReads(h);
    holdRows(h);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await save(h, "Never streamed");
    await vi.advanceTimersByTimeAsync(SETTINGS_ROW_WAIT_MS - 1);
    assert.equal(h.commands.length, 1);
    assert.equal(settingsReads(h), reads, "the wait is still open");
    assert.equal(h.controller().dirtyCount, 1);
    await vi.advanceTimersByTimeAsync(1);
    // vi.waitFor advances the fake clock through the HTTP readback's waits.
    await settled(() => assert.equal(h.controller().dirtyCount, 0));
    assert.ok(settingsReads(h) > reads);
    assert.equal(labelValue(h), "Never streamed");
    assert.deepEqual(h.problems, []); assert.equal(h.commands.length, 1);
  });
});

describe("the stream's settings row outside a save", () => {
  it("shows another session's commit", async () => {
    const h = await setup(); const reads = settingsReads(h);
    assert.equal(h.authority.apply({ "actor.label": { set: "Other session" } }).state, "applied");
    await settingsAction(() => h.ports.deliver());
    assert.equal(labelValue(h), "Other session");
    assert.equal(settingsReads(h), reads);
    assert.equal(h.controller().locked, false);
  });

  it("recovers a failed first read from a row", async () => {
    let failing = true;
    const h = await setup(() => { if (failing) throw new Error("synthetic-sensitive-server-message"); return undefined; });
    await settled(() => assert.equal(h.controller().editor.state, "failed"));
    failing = false;
    await settingsAction(() => h.ports.deliver());
    assert.equal(h.controller().editor.state, "loaded");
    assert.equal(h.controller().locked, false);
  });

  it("locks a held document while its row is unavailable and unlocks on recovery", async () => {
    const h = await setup();
    const read = h.ports.read;
    h.ports.read = () => { throw new Error("synthetic-sensitive-server-message"); };
    await settingsAction(() => h.ports.deliver());
    assert.equal(h.controller().editor.state, "loaded", "the held document stays");
    assert.equal(h.controller().locked, true);
    h.ports.read = read;
    await settingsAction(() => h.ports.deliver());
    assert.equal(h.controller().locked, false);
  });
});
