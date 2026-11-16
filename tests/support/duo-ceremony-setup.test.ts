import assert from "node:assert/strict";
import { afterAll, it } from "vitest";
import { closeFixtures } from "./helpers/duo-ceremony-cleanup.js";

const closed: number[] = [];

afterAll(() => {
  assert.deepEqual(closed, [2, 1]);
  assert.deepEqual(closeFixtures, []);
});

it("drains every registered Duo fixture after the test in reverse acquisition order", () => {
  closeFixtures.push(() => { closed.push(1); });
  closeFixtures.push(async () => { await Promise.resolve(); closed.push(2); });
  assert.deepEqual(closed, []);
});
