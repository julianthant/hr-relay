

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { CaptureListSchema } from "../../../src/models/dashboard/run-detail.js";
import { uuidOf } from "../../support/helpers/backend/dashboard-harness.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

describe("run capture authority", () => {

  it("refuses an empty verified capture index rather than projecting a plausible empty receipt", () => {
    assert.equal(CaptureListSchema.safeParse({ runId: uuidOf(301), artifacts: [] }).success, false);
  });
});
