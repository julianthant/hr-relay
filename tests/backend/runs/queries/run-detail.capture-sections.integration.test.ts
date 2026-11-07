

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import {
buildRunDetail,
readRunDetail
} from "../../../../src/backend/runs/queries/run-detail.js";
import { makeWorld,queuedEventOf,uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

describe("run capture authority", () => {

  it("keeps synchronous details field-absent while live reads name capture absence", async () => {
    const world = await makeWorld();
    const runId = uuidOf(301);
    queuedEventOf(world, { seed: 301 });
    const deps = { runReader: world.runReader,
      stateRoot: world.stateRoot,
      timeline: world.timeline,
      projection: world.projection,
      authority: world.authority,
      descriptors: { resolve: () => undefined },
    };
    try {
      const synchronous = buildRunDetail(deps, runId);
      assert.equal(Object.hasOwn(synchronous, "captures"), false);
      assert.equal(synchronous.availableSections.includes("captures"), false);

      const live = await readRunDetail(deps, runId);
      assert.equal(Object.hasOwn(live, "captures"), true);
      assert.deepEqual(live.captures, {
        state: "absent",
        reason: "this composition wires no diagnostic capture authority",
      });
      assert.equal(live.availableSections.includes("captures"), false);
    } finally {
      await world.dispose();
    }
  });
});
