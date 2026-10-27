import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../src/models/failures/error-catalog.js";
import { createMountedRerunWorld } from "../../../support/helpers/dashboard/mounted-rerun-world.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach,describe,it } from "vitest";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";

const { setup, text, button, press, checkbox, field, fill, mount, cleanup, unmount } = createMountedRerunWorld();
afterEach(cleanup);

describe("mounted Rerun uses source authority and the ordinary launch host", () => {
  it("lost response survives unmount and exact replay without a second run", async () => {
    const h = await setup(); const source = await h.completeSource(); await mount(h, source); await press("Continue"); await press("Confirm");
    assert.equal(field("Employee ID").value, "10812345"); await press("Continue"); await act(async () => checkbox("Dry run").click()); await press("Continue");
    h.loseResponse(); await press("Start dry run"); assert.match(text(), /uncertain/u); const roots = h.queueRoots;
    await unmount(); document.body.replaceChildren();
    await mount(h, source); assert.match(text(), /needs readback/u); await press("Replay exact submission");
    assert.equal(document.querySelector('[role="dialog"]') === null, true, 'exact replay must close the launch dialog'); assert.match(text(), /Run submission confirmed/u); assert.deepEqual(h.queueRoots, roots);
  });
  it("rapid clicks share one envelope and a delayed response cannot overwrite a reopened launch", async () => {
    const h = await setup(); const source = await h.completeSource(); let release: () => void = () => { throw new Error("release not initialized"); };
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const client = { ...h.client, executeCommand: async (input: unknown) => { const result = await h.client.executeCommand(input); await pending; return result; } };
    await mount(h, source, client); await press("Continue"); await press("Confirm"); assert.equal(field("Employee ID").value, "10812345");
    await press("Continue"); await act(async () => checkbox("Dry run").click()); await press("Continue");
    await act(async () => { button("Start dry run").click(); button("Start dry run").click(); });
    assert.equal(h.finalCommands.length, 1); assert.equal(h.queueRoots.length, 2);
    await press("Cancel"); await press("Rerun source"); await act(async () => release());
    assert.ok(!text().includes("Start applied")); assert.match(text(), /needs readback/u);
    await press("Replay exact submission"); assert.equal(h.finalCommands.length, 2);
    assert.deepEqual(h.finalCommands[1], h.finalCommands[0]); assert.equal(h.queueRoots.length, 2);
  });
  it("a stale source refuses in the mounted launcher before warning navigation or plan allocation", async () => {
    const h = await setup(); const source = await h.completeSource();
    const before = h.authoritySnapshot(); await mount(h, { ...source, version: PositiveIntSchema.parse(source.version - 1) });
    assert.match(text(), /source-stale/u); assert.equal(button("Continue").disabled, true); assert.equal(h.authoritySnapshot(), before);
  });

  it("keeps the dialog and recovery when readback omits the exact plan origin", async () => {
    const h = await setup(); const source = await h.completeSource();
    const client = { ...h.client, dashboardDay: async (day: string) => {
      const snapshot = await h.client.dashboardDay(day);
      return { ...snapshot, queueSurfaces: snapshot.queueSurfaces.map(row => ({ ...row,
        session: row.session.state === "present" ? { state: "present" as const, sessionId: row.session.sessionId } : row.session })) };
    } };
    await mount(h, source, client); await press("Continue"); await press("Confirm"); await press("Continue");
    await act(async () => checkbox("Dry run").click()); await press("Continue"); await press("Start dry run");
    assert.equal(document.querySelector('[role="dialog"]') !== null, true);
    assert.equal(window.sessionStorage.length, 1); assert.equal(h.queueRoots.length, 2);
    assert.equal(text().includes("Rerun started"), false); assert.match(text(), /readback/u);
    await press("Cancel"); assert.equal(window.sessionStorage.length, 1);
  });
  for (const replacement of ["client", "actor", "day ABA"] as const) {
    it(`does not close or toast from a late Start after ${replacement} replacement`, async () => {
      const h = await setup(); const source = await h.completeSource(); let release: (() => void) | undefined;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const client = { ...h.client, executeCommand: async (input: unknown) => {
        const reply = await h.client.executeCommand(input); await pending; return reply;
      } };
      const replaceBinding = await mount(h, source, client);
      await press("Continue"); await press("Confirm"); await press("Continue");
      await act(async () => checkbox("Dry run").click()); await press("Continue");
      await act(async () => button("Start dry run").click()); assert.equal(h.finalCommands.length, 1);
      if (replacement === "day ABA") await replaceBinding(client, { requestKey: 1, nowIso: "2026-08-01T17:00:00.000Z" });
      await replaceBinding(replacement === "client" ? { ...client } : client,
        { actorId: replacement === "actor" ? "other-operator" : "local-operator", requestKey: replacement === "day ABA" ? 2 : 0 });
      const finish = release; assert.ok(finish); await act(async () => finish());
      assert.equal(document.querySelector('[role="dialog"]') !== null, true);
      assert.equal(text().includes("Rerun started"), false); assert.equal(window.sessionStorage.length, 1);
      assert.equal(h.finalCommands.length, 1);
      if (replacement !== "actor") assert.equal(button("Replay exact submission").disabled, false);
    });
  }
  it("does not publish a late final result after editing the reviewed plan", async () => {
    const h = await setup(); const source = await h.completeSource(); let release: (() => void) | undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const client = { ...h.client, executeCommand: async (input: unknown) => { const reply = await h.client.executeCommand(input); await pending; return reply; } };
    await mount(h, source, client); await press("Continue"); await press("Confirm"); await press("Continue");
    await act(async () => checkbox("Dry run").click()); await press("Continue");
    await act(async () => button("Start dry run").click());
    await press("Back"); await press("Back"); await fill(field("Employee ID"), "10812346");
    const finish = release; assert.ok(finish); await act(async () => finish());
    assert.equal(document.querySelector('[role="dialog"]') !== null, true); assert.equal(text().includes("Rerun started"), false);
    assert.equal(window.sessionStorage.length, 1); assert.equal(h.finalCommands.length, 1);
  });
  it("refuses a final submission without a command binding", async () => {
    const h = await setup(); const source = await h.completeSource(); const replaceBinding = await mount(h, source);
    await replaceBinding(h.client, { bound: false }); await press("Rerun source");
    await press("Continue"); await press("Confirm"); await press("Continue");
    await act(async () => checkbox("Dry run").click()); await press("Continue"); await press("Start dry run");
    assert.equal(h.finalCommands.length, 0); assert.equal(window.sessionStorage.length, 0);
    assert.equal(document.querySelector('[role="dialog"]') !== null, true); assert.equal(text().includes(formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_AUTHORITY_REPLACED", {})).text), true, "missing binding shows fixed authority feedback");
  });

});
