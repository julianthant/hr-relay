import { runtimeLifetimeLock } from "./support/helpers/backend/runtime-lifetime.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";

vi.mock("../src/backend/app/composition/worker-compose.js", () => ({ composeWorkerRuntime: vi.fn() }));
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});

it.each(["proved", "unproved"] as const)("worker CLI writes its %s closure report and sets the exit status", async closure => {
  vi.resetModules();
  const { composeWorkerRuntime } = await import("../src/backend/app/composition/worker-compose.js");
  const { RuntimeAdmission } = await import("../src/backend/storage/admission/admission.js");
  const { runCli } = await import("../src/cli.js");
  process.argv = ["node", "cli.ts", "worker", "person-lookup", "--drain"];
  process.exitCode = undefined;
  vi.mocked(composeWorkerRuntime).mockResolvedValue({ workerId: "worker-1", workflowId: "person-lookup",
    outcomes: [], stopped: "idle", closure });
  const output: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation(value => { output.push(String(value)); return true; });
  await runCli(RuntimeAdmission.syntheticRoots(join(tmpdir(), "closure-cli-state"), join(tmpdir(), "closure-cli-artifacts")), undefined, { lock: await runtimeLifetimeLock(), parentSignal: new AbortController().signal });
  assert.deepEqual(output.map((value): unknown => JSON.parse(value)), [{ workerId: "worker-1", workflowId: "person-lookup",
    stopped: "idle", closure, outcomes: [] }]);
  assert.equal(process.exitCode, closure === "unproved" ? 1 : undefined);
});
