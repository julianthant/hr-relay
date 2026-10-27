import { RunRecordService, type RunRecordServiceDependencies } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import assert from "node:assert/strict";
import { createBoundProfileFixture } from "../admission-fixture.js";
import {
  createCommandKernel,
  type CommandKernel,
  type CommandKernelDependencies,
} from "../../../../src/backend/runs/commands/command-kernel.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../fixtures/intake-kernel-seams.js";
import { seedSyntheticRuntimeConfig } from "../../fixtures/operator-command-fixtures.js";
import { NOW } from "../../fixtures/phase1c-contract-fixtures.js";
import { sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";

export interface KernelStubHarness {
  readonly database: AuthorityDatabase;
  readonly kernel: CommandKernel;
  readonly clock: ReturnType<typeof manualClock>;
  readonly configIdentity: CommandKernelDependencies["configIdentity"];
  readonly plannerIds: ReturnType<typeof sequentialIdFactory>;
}

export function createKernelStubCommandFixtures(input: {
  readonly roots: string[];
  readonly openDatabases: AuthorityDatabase[];
  readonly profiles: Awaited<ReturnType<typeof createBoundProfileFixture>>[];
  readonly prefix: string;
  readonly migrationOwner: string;
  readonly resolve: (workflowId: string) => AnyWorkflowDescriptor | undefined;
}) {
  let commandSequence = 0;
  const unrelated = (): never => { throw new Error("unrelated kernel effect reached"); };
  const workerRuntime: CommandKernelDependencies["workerRuntime"] = { pool: {
    planPoolWorkerCount: unrelated, spawnPoolWorker: unrelated,
    refreshPoolBrowser: unrelated, reopenPoolBrowser: unrelated, stopPoolWorker: unrelated, pausePoolWorker: unrelated, resumePoolWorker: unrelated,
  } };
  const writeResolution: CommandKernelDependencies["writeResolution"] = { resolvePresent: unrelated, resolveAbsent: unrelated };

  function nextCommandId(): string {
    commandSequence += 1;
    const tail = String(commandSequence).padStart(4, "0");
    return `cccccccc-${tail}-4000-8000-${tail}00000000`;
  }

  function runCommand(type: string, runId: string, expectedVersion: number) {
    return {
      commandId: nextCommandId(),
      requestedAt: NOW,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "run",
      type,
      target: { runId, expectedVersion },
    } as const;
  }

  async function createHarness(options: { publishQueued?: RunRecordServiceDependencies["publishQueued"] } = {}): Promise<KernelStubHarness> {
    const clock = manualClock(new Date(NOW));
    const profile = await createBoundProfileFixture();
    const database = AuthorityDatabase.open(
      { path: profile.path, busyTimeoutMs: 250, migrationOwner: input.migrationOwner },
      clock,
    );
    input.profiles.push(profile);
    input.roots.push(profile.workspace);
    input.openDatabases.push(database);
    seedSyntheticRuntimeConfig(database);
    const active = database.authority.runtimeConfig.get();
    assert.ok(active);
    const configIdentity = { configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint };
    const kernel = createCommandKernel({
      lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: options.publishQueued ?? (() => {}) }),
      appVersion: "0.1.0",
      configIdentity,
      intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS,
      authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
      clock,
      ids: sequentialIdFactory("d"),
      descriptors: { resolve: (workflowId) => input.resolve(workflowId) },
      explorerEdits: {
        apply: (): never => { throw new Error("this harness composes no explorer edit executor"); },
      },
      writeResolution,
      workerRuntime,
      settings: {
        validateRequest: () => undefined,
        commitPrivate: () => undefined,
        reconcileReplay: () => { throw new Error("this harness composes no settings replay authority"); },
        applyOrdinary: (): never => { throw new Error("this harness composes no settings apply authority"); },
      },
    });
    return { database, kernel, clock, configIdentity, plannerIds: sequentialIdFactory("f") };
  }

  return { createHarness, nextCommandId, runCommand };
}
