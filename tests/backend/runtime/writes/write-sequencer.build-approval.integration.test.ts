import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { TaskError } from "../../../../src/workflow-kit/errors.js";
import { writeFixtureQueuedRun } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createWriteSequencerTestWorld } from "../../../support/helpers/backend/write-sequencer-world.js";

const build = vi.hoisted(() => ({ id: "a".repeat(64) }));
vi.mock("../../../../src/backend/app/build-id.js", async importOriginal => ({
  ...await importOriginal<typeof import("../../../../src/backend/app/build-id.js")>(),
  currentBuildId: () => build.id,
}));

const BUILD_X = "a".repeat(64);
const BUILD_Y = "b".repeat(64);
const { harness, claimRunning, contextFor, intentByKey, cleanup } = createWriteSequencerTestWorld();
afterEach(async () => { build.id = BUILD_X; await cleanup(); });

const effects = (events: readonly string[]) => events.filter(event => event === "probe" || event === "prepare" || event.startsWith("commit-click:"));

describe("write sequencer — a write is approved under one build", () => {
  it("refuses an approval from another build before any key, intent, fence or click", async () => {
    const h = await harness();
    build.id = BUILD_X;
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun());
    assert.equal(run.envelope.buildId, BUILD_X);
    build.id = BUILD_Y;
    await assert.rejects(h.execute(contextFor(run, claim)),
      (error: unknown) => error instanceof TaskError && error.code === "WRITE_BUILD_CHANGED");
    assert.deepEqual(effects(h.world.events), []);
    assert.equal(intentByKey(h.database), undefined);
    assert.deepEqual(h.database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId), []);
  });

  it("writes once when the approving build is the running build", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun());
    const outcome = await h.execute(contextFor(run, claim));
    assert.equal(Reflect.get(outcome as object, "disposition"), "committed");
    assert.equal(effects(h.world.events).filter(event => event.startsWith("commit-click:")).length, 1);
    assert.equal(intentByKey(h.database)?.status, "committed");
  });

  it("replays a committed outcome under a later build without another click", async () => {
    const h = await harness();
    const { run, claim } = claimRunning(h.database, h.clock, writeFixtureQueuedRun());
    await h.execute(contextFor(run, claim));
    const clicks = effects(h.world.events).length;
    build.id = BUILD_Y;
    await h.execute(contextFor(run, claim));
    assert.equal(effects(h.world.events).length, clicks, "the replay must not probe, prepare or click");
    assert.equal(intentByKey(h.database)?.status, "committed");
  });
});
