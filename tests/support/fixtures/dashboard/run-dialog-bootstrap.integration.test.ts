import assert from "node:assert/strict";
import { it } from "vitest";
import snapshot from "./run-dialog-bootstrap.json" with { type: "json" };
import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";

it("the Run dialog's saved bootstrap is the served fixture bootstrap", () => {
  const { workflows, workbookCompatibility, serverClock, actor } = FIXTURE_BOOTSTRAP;
  assert.deepEqual(snapshot, JSON.parse(JSON.stringify({ workflows, workbookCompatibility, serverClock, actor })));
});

it("the intake sessions saved for the Run dialog stories are the served fixture sessions", async () => {
  const { FIXTURE_INTAKE_IDS, FIXTURE_INTAKE_SESSIONS } = await import("./fixture-intake.js");
  const saved = await import("./run-dialog-intake-sessions.json", { with: { type: "json" } });
  assert.deepEqual(saved.default, JSON.parse(JSON.stringify({ ids: FIXTURE_INTAKE_IDS, sessions: FIXTURE_INTAKE_SESSIONS })));
});
