import assert from "node:assert/strict";
import { it } from "vitest";
import { obligationsFor } from "../../../src/models/trust/evidence-obligations.js";

it("refuses writes to an obligation's source list and source declarations", () => {
  const obligation = obligationsFor("person-lookup").find(({ rule }) => rule === "all-equal");
  const source = obligation?.sources[0];
  assert.ok(obligation && source);
  assert.throws(() => Object.assign(obligation.sources, { 0: source }), TypeError);
  assert.throws(() => Object.assign(source, { path: source.path }), TypeError);
});
