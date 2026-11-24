// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { mountSettingsHarness, settingsAction, syntheticSettingsAuthority } from "../../../../support/helpers/dashboard/settings-harness.js";
import { SETTINGS_ROW_WAIT_MS } from "../../../../../src/dashboard/client/subscriptions/row-store.js";

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
/** Holds each row the save would deliver until the test releases them, so the reply arrives first; releasing delivers at once again. */
const holdRows = (h: Harness): (() => void) => {
  const deliver = h.ports.deliver;
  let held = 0;
  h.ports.deliver = () => { held += 1; };
  return () => { h.ports.deliver = deliver; for (; held > 0; held -= 1) deliver(); };
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

  it("ends unresolved when the row arrives unavailable, keeps the held display, and unlocks on the next good row", async () => {
    const h = await setup(); const reads = settingsReads(h); const before = labelValue(h);
    const read = h.ports.read;
    const release = holdRows(h);
    await save(h, "Unavailable row");
    await settled(() => assert.equal(h.commands.length, 1));
    h.ports.read = () => { throw new Error("synthetic-sensitive-server-message"); };
    release();
    h.ports.read = read;
    await settled(() => assert.deepEqual(h.problems, [FAILURE]));
    assert.equal(settingsReads(h), reads, "an unresolved save reads no Settings");
    assert.equal(labelValue(h), before, "the held document stays");
    assert.equal(h.controller().dirtyCount, 0); assert.equal(h.commands.length, 1); assert.deepEqual(h.notices, []);
    assert.equal(h.controller().locked, true, "an unavailable row keeps the editor display-only");
    await settingsAction(() => h.ports.deliver());
    assert.equal(labelValue(h), "Unavailable row", "the next good row shows what landed");
    assert.equal(h.controller().locked, false);
    assert.doesNotMatch(h.host.textContent ?? "", /synthetic-sensitive-server-message/u);
  });

  it(`ends unresolved after ${String(SETTINGS_ROW_WAIT_MS)} ms without a row, reading no Settings, and frees the next edit`, async () => {
    const h = await setup(); const reads = settingsReads(h); const before = labelValue(h);
    holdRows(h);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await save(h, "Never streamed");
    await vi.advanceTimersByTimeAsync(SETTINGS_ROW_WAIT_MS - 1);
    assert.equal(h.commands.length, 1);
    assert.deepEqual(h.problems, [], "the wait is still open");
    assert.equal(h.controller().dirtyCount, 1);
    await vi.advanceTimersByTimeAsync(1);
    await settled(() => assert.deepEqual(h.problems, [FAILURE]));
    assert.equal(settingsReads(h), reads);
    assert.equal(labelValue(h), before, "the last held row shows");
    assert.equal(h.controller().dirtyCount, 0); assert.equal(h.commands.length, 1);
    vi.useRealTimers();
    // The held row is behind the store, so the next edit waits for a fresh row first.
    await settingsAction(() => h.ports.deliver());
    await save(h, "Next draft");
    await settled(() => assert.equal(h.commands.length, 2));
  });

  it("waits through a stream reset for the snapshot's row", async () => {
    const h = await setup(); const reads = settingsReads(h);
    const release = holdRows(h);
    await save(h, "Across a reset");
    await settled(() => assert.equal(h.commands.length, 1));
    await settingsAction(() => h.rows.reset());
    await settingsAction(() => undefined);
    assert.equal(h.controller().dirtyCount, 1, "a reset does not end the wait");
    assert.deepEqual(h.problems, []);
    release();
    await settled(() => assert.equal(h.controller().dirtyCount, 0));
    assert.equal(labelValue(h), "Across a reset");
    assert.deepEqual(h.problems, []); assert.equal(settingsReads(h), reads);
  });

  it("ends unresolved at once when the stream stops while the save waits", async () => {
    const h = await setup();
    holdRows(h);
    await save(h, "Stream stopped");
    await settled(() => assert.equal(h.commands.length, 1));
    assert.equal(h.controller().dirtyCount, 1);
    await h.stop();
    await settled(() => assert.deepEqual(h.problems, [FAILURE]));
    assert.deepEqual(h.notices, []); assert.equal(h.commands.length, 1);
  });

  it("recovers a lost reply by reading Settings back", async () => {
    const h = await setup();
    h.ports.execute = request => { h.authority.execute(request); throw new Error("synthetic-response-lost"); };
    await save(h, "Lost reply");
    await settled(() => assert.equal(labelValue(h), "Lost reply"));
    assert.deepEqual(h.problems, []); assert.equal(h.commands.length, 1);
  });
});

const protectedRevision = (h: Harness): number | undefined => {
  const editor = h.controller().editor;
  if (editor.state !== "loaded" || editor.document.protectedSettings.state !== "available") return undefined;
  return editor.document.protectedSettings.readback.revision;
};

describe("protected settings beside the ordinary row", () => {
  it("keeps protected edits ready while the ordinary row is unavailable", async () => {
    const h = await setup();
    const read = h.ports.read;
    h.ports.read = () => { throw new Error("synthetic-sensitive-server-message"); };
    await settingsAction(() => h.ports.deliver());
    h.ports.read = read;
    assert.equal(h.controller().locked, true);
    assert.equal(h.controller().protectedEditor.locked, false, "protected settings keep their own reads");
  });

  it("keeps a newer protected snapshot when an ordinary row carries an older one", async () => {
    const h = await setup();
    const older = h.authority.read().protectedSettings;
    assert.equal(h.authority.protectedApply({ sharepointOnboardingRosterUrl: { set: "https://example.test/roster" } }).state, "applied");
    const newer = h.authority.read().protectedSettings;
    assert(older.state === "available" && newer.state === "available");
    assert.ok(newer.readback.revision > older.readback.revision);
    await settingsAction(() => h.controller().reload());
    await settled(() => assert.equal(protectedRevision(h), newer.readback.revision));
    assert.equal(h.authority.apply({ "actor.label": { set: "Other session" } }).state, "applied");
    const read = h.ports.read;
    h.ports.read = () => ({ ...h.authority.read(), protectedSettings: older });
    await settingsAction(() => h.ports.deliver());
    h.ports.read = read;
    assert.equal(labelValue(h), "Other session");
    assert.equal(protectedRevision(h), newer.readback.revision, "the ordinary row never moves protected settings back");
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
