import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { it, vi } from "vitest";
import { composeWorkerRuntime } from "../../../../src/backend/app/composition/worker-compose.js";
import { createProductionDryRunScenarioRuntime } from "../../../../src/backend/app/dry-run/runtime.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { WorkerSessionClosureUnprovedError } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";

vi.mock("../../../../src/backend/app/composition/worker-compose.js", () => ({ composeWorkerRuntime: vi.fn() }));

it("default dry-run drain refuses unproved worker closure", async () => {
  const runtime = createProductionDryRunScenarioRuntime({
    admission: RuntimeAdmission.syntheticRoots(join(tmpdir(), "closure-dry-run-state"), join(tmpdir(), "closure-dry-run-artifacts")),
    isolation: rebuildRuntimeIsolation, repoRoot: process.cwd(), env: {},
    clock: manualClock(new Date("2026-10-12T18:00:00.000Z")), ids: sequentialIdFactory("c"),
  });
  const report = { workerId: "worker-1", workflowId: "person-lookup", outcomes: [], stopped: "idle" as const };
  vi.mocked(composeWorkerRuntime).mockResolvedValue({ ...report, closure: "unproved" });
  await assert.rejects(runtime.drain("person-lookup"), error => error instanceof WorkerSessionClosureUnprovedError
    && /worker-1/.test(error.message));
  vi.mocked(composeWorkerRuntime).mockResolvedValue({ ...report, closure: "proved" });
  await runtime.drain("person-lookup");
  const failure = new Error("unexpected worker failure");
  vi.mocked(composeWorkerRuntime).mockRejectedValue(failure);
  await assert.rejects(runtime.drain("person-lookup"), error => error === failure);
});
