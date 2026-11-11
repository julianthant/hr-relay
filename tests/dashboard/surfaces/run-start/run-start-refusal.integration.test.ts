// @vitest-environment jsdom
import assert from "node:assert/strict";
import { afterAll, afterEach, it } from "vitest";
import { act } from "react";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createMountedRerunWorld } from "../../../support/helpers/dashboard/mounted-rerun-world.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const { setup, mount, cleanup, press, checkbox, button, fill, text } = createMountedRerunWorld(profiles.create);
afterEach(cleanup);

for (const rerun of [false, true]) {
  async function review(h: Awaited<ReturnType<typeof setup>>) {
    await mount(h, rerun ? await h.completeSource() : undefined);
    if (rerun) { await press("Continue"); await press("Confirm"); await press("Continue"); }
    else { const box = document.querySelector("textarea"); assert.ok(box); await fill(box, "10812345"); await press("Continue"); }
    await act(async () => checkbox("Dry run").click()); await press("Continue");
  }
  it(`${rerun ? "Rerun" : "Run"} re-previews an expired plan and requires another Start`, async () => {
    const h = await setup(); await review(h);
    h.clock.advanceWall(600_000); h.clock.advanceMonotonic(600_000);
    await press("Start dry run");
    assert.ok(text().includes("This plan expired, so it was checked again. Review it and press Start again."));
    assert.equal(document.querySelector('[role="dialog"]') !== null, true);
    assert.equal(text().includes("Run not started"), false);
    assert.equal(h.submissions.length, 2);
    assert.deepEqual(h.submissions[1], h.submissions[0]);
    assert.equal(h.finalCommands.length, 1);
    assert.equal(window.sessionStorage.length, 0);
    await press("Start dry run");
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(h.finalCommands.length, 2);
    assert.equal(h.queueRoots.length, rerun ? 2 : 1);
  });
}
