import assert from "node:assert/strict";
import { it } from "vitest";
import { manualClock } from "../../../../../src/domain/clock.js";
import { buildPreflightReport, requiredPreflightChecks } from "../../../../../src/domain/preflight.js";
import { PreflightAdmissionRefusal } from "../../../../../src/domain/preflight-admission.js";
import { WorkflowIdSchema } from "../../../../../src/domain/ids.js";
import { createPreflightReportService, type PreflightReportRuntime } from "../../../../../src/backend/runtime/preflight/report-service.js";
import type { createPreflightAuthority } from "../../../../../src/domain/preflight.js";

const clock = manualClock(new Date("2026-09-19T12:00:00Z"));
const configFingerprint = "a".repeat(64);
const descriptorFingerprint = "b".repeat(64);
const scope = {
  configSnapshotId: "66666666-6666-4666-8666-666666666666",
  configFingerprint, descriptorFingerprint, requestedCapabilities: ["dashboard.serve"] as const,
};
const report = buildPreflightReport({ ...scope, clock,
  observations: requiredPreflightChecks(scope.requestedCapabilities).map(check => ({
    check, state: "unhealthy" as const, summary: "Controlled failed check", impact: "Cannot start",
  })),
});
const dashboard = { readLatest: () => report, execute: async () => { throw new Error("dashboard rerun not selected"); } } as unknown as ReturnType<typeof createPreflightAuthority>;
const selection = { workflowId: WorkflowIdSchema.parse("person-lookup") };
const other = { workflowId: WorkflowIdSchema.parse("kuali-fill") };
const signal = new AbortController().signal;

it("retains completed failed verdicts for the selected workflow while expiry and changed scope remain unavailable", async () => {
  const start = clock.monotonicMs();
  let currentConfig = configFingerprint;
  let failRerun = false;
  let completed = false;
  const runtime = {
    currentScope: (workflowId?: string) => ({ ...scope, configFingerprint: currentConfig,
      descriptorFingerprint: workflowId === other.workflowId ? "c".repeat(64) : descriptorFingerprint }),
    admission: {
      read: (requested: typeof scope) => {
        if (!completed || requested.configFingerprint !== configFingerprint || requested.descriptorFingerprint !== descriptorFingerprint) throw new PreflightAdmissionRefusal("unavailable", "No current check");
        if (clock.monotonicMs() - start >= 60_000) throw new PreflightAdmissionRefusal("stale", "Expired");
        return report;
      },
      prepare: async () => {
        if (failRerun) throw new PreflightAdmissionRefusal("unavailable", "Controlled rerun failure");
        completed = true;
        return report;
      },
    },
  } as unknown as PreflightReportRuntime;
  const service = createPreflightReportService({ dashboard, runtime, clock });
  const command = { commandId: "abababab-abab-4bab-abab-abababababab", requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "settings-surface", type: "rerun-preflight", target: {
    expectedConfigFingerprint: configFingerprint, expectedDescriptorFingerprint: descriptorFingerprint, selection } };
  assert.equal(service.read(selection).state, "unavailable");
  const first = await service.execute(command, signal);
  assert.equal(first.state, "completed");
  assert.ok(first.report.results.some(check => check.status === "fail"));
  assert.equal(service.read(selection).state, "present");
  const otherRead = service.read(other);
  assert.equal(otherRead.state, "unavailable");
  if (otherRead.state !== "unavailable") throw new Error("other workflow accepted");
  assert.equal(otherRead.lastCompleted, undefined);
  currentConfig = "f".repeat(64);
  const changed = service.read(selection);
  assert.equal(changed.state, "unavailable");
  if (changed.state !== "unavailable") throw new Error("changed configuration accepted");
  assert.deepEqual(changed.lastCompleted, report);
  currentConfig = configFingerprint;
  failRerun = true;
  await assert.rejects(service.execute({ ...command, commandId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, signal), /Controlled rerun failure/u);
  clock.advanceWall(60_000); clock.advanceMonotonic(60_000);
  const expired = service.read(selection);
  assert.equal(expired.state, "unavailable");
  if (expired.state !== "unavailable") throw new Error("expired check accepted");
  assert.deepEqual(expired.lastCompleted, report);
});
