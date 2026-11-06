import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { createCommandKernel, type CommandKernelDependencies } from "../../../../../src/backend/runs/commands/command-kernel.js";
import { readOcrReviewAuthority, requireCurrentOcrSnapshot } from "../../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { authenticateRootRun } from "../../../../../src/backend/storage/sqlite/delegation-root-authority.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { createOcrReviewWorld } from "../../../../support/helpers/backend/ocr-review-world.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../../support/fixtures/intake-kernel-seams.js";

const composed = vi.hoisted((): CommandKernelDependencies[] => []);
vi.mock("../../../../../src/backend/runs/commands/command-kernel.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../../../src/backend/runs/commands/command-kernel.js")>();
  return { ...actual, createCommandKernel: (dependencies: CommandKernelDependencies) => {
    composed.push(dependencies); return actual.createCommandKernel(dependencies);
  } };
});
const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("composes served OCR with readable gate authority while public starts remain refused", async () => {
  const profile = await createBoundProfileFixture(), clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(profile.workspace, name));
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null } });
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.ok(active.state === "active");
  let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
  try {
    const before = composed.length;
    dashboard = await composeDashboardRuntime({ lifetimeLock: profile.lifetime, admission: profile.machine,
      profile: { runtime, token: active.token }, repoRoot: profile.workspace, clock, isolation: rebuildRuntimeIsolation,
      env: {}, backendPortOverride: 0, frontendPortOverride: 0, preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { spawn: () => { throw new Error("composition proof must not launch a worker"); } } });
    const created = composed.slice(before); assert.equal(created.length, 1);
    const production = created[0], readable = production.readableDescriptors; assert.ok(readable);
    assert.equal(production.workflowSources?.ocr, "served");
    assert.equal(production.descriptors.resolve("ocr"), undefined);
    assert.equal(readable.resolve("ocr")?.capabilities?.review, true);
    assert.equal(readable.resolve("unknown-review-workflow"), undefined);

    const f = await world.fixture({ record: true, release: true });
    assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
    const unused = (): never => { throw new Error("unrequested native fixture effect"); };
    const kernel = createCommandKernel({ authority: f.database, lifecycle: f.canonical.lifecycle, clock: f.clock,
      ids: { uuid: randomUUID }, appVersion: "0.1.0", descriptors: production.descriptors, readableDescriptors: readable,
      configIdentity: UNSTORED_CONFIG_IDENTITY, intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
      writeResolution: { recheck: unused, resolveAbsent: unused }, workerRuntime: { pool: {
        planPoolWorkerCount: unused, spawnPoolWorker: unused, refreshPoolBrowser: unused, reopenPoolBrowser: unused,
        stopPoolWorker: unused, pausePoolWorker: unused, resumePoolWorker: unused } } });
    const originalStart = authenticateRootRun(f.database.authority, f.run).command;
    const refused = kernel.execute({ ...originalStart, commandId: randomUUID() });
    assert.ok(refused.state === "rejected" && refused.code === "target-not-found");
    const consent = f.approval();
    assert.equal(kernel.execute(consent).state, "applied");
    const approved = requireCurrentOcrSnapshot(f.database.authority, f.canonical.lifecycle, consent.payload.result.value, f.resolve);
    assert.equal(approved.revision, 2);
    assert.equal(approved.records[0].assertedEid, "10800000");
    assert.deepEqual(readOcrReviewAuthority(f.database.authority, f.canonical.lifecycle, f.run.envelope.runId)?.revision.records, approved.records);
    assert.equal(kernel.execute(f.command("discard-ocr-record", 2)).state, "rejected");
    assert.deepEqual(requireCurrentOcrSnapshot(f.database.authority, f.canonical.lifecycle, consent.payload.result.value, f.resolve), approved);
  } finally {
    try { if (dashboard === undefined) await runtime.close(); else await dashboard.stop(); }
    finally { await profile.close(); }
  }
});
