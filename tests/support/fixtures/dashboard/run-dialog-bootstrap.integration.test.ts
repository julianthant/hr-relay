import assert from "node:assert/strict";
import { it } from "vitest";
import snapshot from "./run-dialog-bootstrap.json" with { type: "json" };
import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";

it("the Run dialog's saved bootstrap is the served fixture bootstrap", () => {
  const { workflows, workbookCompatibility, serverClock, actor } = FIXTURE_BOOTSTRAP;
  assert.deepEqual(snapshot, JSON.parse(JSON.stringify({ workflows, workbookCompatibility, serverClock, actor })));
});
