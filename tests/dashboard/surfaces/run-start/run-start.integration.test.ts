import { createMountedRerunWorld } from "../../../support/helpers/dashboard/mounted-rerun-world.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act } from "react";
import { afterEach,describe,it } from "vitest";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";

const { setup, text, button, press, checkbox, field, mount, cleanup, unmount } = createMountedRerunWorld();
afterEach(cleanup);

describe("mounted Rerun uses source authority and the ordinary launch host", () => {
  it("lost response survives unmount and exact replay without a second run", async () => {
    const h = setup(); const source = await h.completeSource(); await mount(h, source); await press("Continue"); await press("Confirm");
    assert.equal(field("Employee ID").value, "10812345"); await press("Continue"); await act(async () => checkbox("Dry run").click()); await press("Continue");
    h.loseResponse(); await press("Start dry run"); assert.match(text(), /lost response/u); const roots = h.queueRoots;
    await unmount(); document.body.replaceChildren();
    await mount(h, source); assert.match(text(), /needs readback/u); await press("Replay exact submission");
    assert.equal(document.querySelector('[role="dialog"]'), null); assert.match(text(), /Run submission confirmed/u); assert.deepEqual(h.queueRoots, roots);
  });
  it("rapid clicks share one envelope and a delayed response cannot overwrite a reopened launch", async () => {
    const h = setup(); const source = await h.completeSource(); let release: () => void = () => { throw new Error("release not initialized"); };
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
    const h = setup(); const source = await h.completeSource();
    const before = h.authoritySnapshot(); await mount(h, { ...source, version: PositiveIntSchema.parse(source.version - 1) });
    assert.match(text(), /source-stale/u); assert.equal(button("Continue").disabled, true); assert.equal(h.authoritySnapshot(), before);
  });

});
