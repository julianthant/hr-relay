import assert from "node:assert/strict";
import { it } from "vitest";
import snapshot from "./run-dialog-bootstrap.json" with { type: "json" };
import workStudy from "./run-dialog-work-study.json" with { type: "json" };
import { FIXTURE_BOOTSTRAP } from "./fixture-bootstrap.js";
import { DESCRIPTORS, descriptorSetHash, INTAKE_PROJECTIONS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { buildBootstrap } from "../../../../src/backend/runs/queries/bootstrap.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { healthyDashboardPreflightReport } from "../preflight-seams.js";

it("the Run dialog's saved bootstrap is the served fixture bootstrap", () => {
  assert.deepEqual(snapshot, JSON.parse(JSON.stringify(FIXTURE_BOOTSTRAP)));
});

it("the Work-Study entry saved for the cancelled-rerun stories is the served one", () => {
  const descriptor = DESCRIPTORS.find(candidate => String(candidate.id) === "work-study");
  assert.ok(descriptor);
  const clock = manualClock(new Date("2026-08-26T21:00:00.000Z"));
  const intake = INTAKE_PROJECTIONS["work-study"];
  const wire = buildBootstrap({ appVersion: "0.1.0", actorLabel: () => "Fixture Operator", clock,
    modules: [{ descriptor, role: defineWorkflowRole({ kind: "composition" }), ...(intake === undefined ? {} : { intake }) }],
    descriptorSetHash: descriptorSetHash([descriptor.contractFingerprint]), settingsSchemaHash: descriptorSetHash(["settings-schema"]),
    projection: { generation: () => 1 }, authorityMeta: () => ({ schemaVersion: 1, authorityGeneration: 1 }),
    workbookCompatibility: () => ({ workflows: [], libraries: [] }), preflightReport: () => healthyDashboardPreflightReport(clock) });
  assert.deepEqual(workStudy, JSON.parse(JSON.stringify(wire.workflows[0])));
});

it("the intake sessions saved for the Run dialog stories are the served fixture sessions", async () => {
  const { FIXTURE_INTAKE_IDS, FIXTURE_INTAKE_SESSIONS } = await import("./fixture-intake.js");
  const saved = await import("./run-dialog-intake-sessions.json", { with: { type: "json" } });
  assert.deepEqual(saved.default, JSON.parse(JSON.stringify({ ids: FIXTURE_INTAKE_IDS, sessions: FIXTURE_INTAKE_SESSIONS })));
});
