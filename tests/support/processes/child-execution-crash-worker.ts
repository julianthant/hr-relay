import { receiveRuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { catalogCodeForThrown } from "../../../src/models/failures/error-catalog.js";
import { z } from "zod";
import { join } from "node:path";
import { acquireSharedRuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { createProfileRegistry } from "../../../src/backend/profiles/registry.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { composeWorkerRuntime } from "../../../src/backend/app/composition/worker-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { childExecutionModules, childExecutionRoot, childExecutionStores } from "../fixtures/child-execution-workflows.js";
import { childExecutionBuildManifest } from "../fixtures/child-execution-build-manifest.js";
import { childCrashWriteModules, childCrashWriteRoot } from "../fixtures/child-execution-write-workflow.js";
import { absentProbeEvidence, createWriteFixtureWorld, writeFixtureSessions } from "../fixtures/write-sequencer-fixtures.js";
import { systemClock } from "../../../src/rules/time/clock.js";

let stage: "arguments" | "machine" | "profile" | "graph" | "compose" | "terminal" = "arguments";
try {
const [repoRoot, mode, port] = z.tuple([z.string().min(1), z.enum(["checkpoint", "resume", "attempting"]), z.coerce.number().int().positive()]).parse(process.argv.slice(2));
const controller = new AbortController();
const lifetimeLock = await receiveRuntimeLifetimeLock(port, () => controller.abort(new Error("fixture-parent-disconnected")));
stage = "machine";
const machine = acquireSharedRuntimeAdmission(repoRoot, lifetimeLock);
stage = "profile";
const registry = createProfileRegistry(machine), selected = registry.read().activeProfileId;
assert.ok(selected);
const admission = machine.admitProfile(selected);
const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
  erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${selected}.json`) });
let database: AuthorityDatabase | undefined;
let observed = false;
stage = "graph";
const driver = createWriteFixtureWorld();
const writeGraph = childCrashWriteModules(driver);
const modules = mode === "attempting" ? writeGraph.modules : childExecutionModules;
const stores = mode === "attempting" ? writeGraph.stores : childExecutionStores;
const root = mode === "attempting" ? childCrashWriteRoot : childExecutionRoot;
if (mode === "attempting") {
  driver.probeResults.push(absentProbeEvidence(systemClock.now().toISOString()));
  driver.afterCommitClickBeforeTaskSettlement = async () => {
    assert.ok(database);
    const intents = database.readProfileResourceCustody().writeIntents.filter(intent => intent.status === "attempting");
    assert.equal(intents.length, 1);
    const intent = intents[0]; assert.ok(intent);
    const run = database.authority.runs.get(intent.runId); assert.ok(run && "workerId" in run.lifecycle);
    lifetimeLock.assertHeld();
    assert.equal(database.authority.workerLeases.get(run.lifecycle.workerId)?.processId, process.pid);
    const clicks = driver.events.filter(event => event.startsWith("commit-click:")).length;
    assert.equal(clicks, 1);
    assert.ok(typeof process.send === "function");
    process.send({ kind: "attempting", workerId: run.lifecycle.workerId, runId: run.envelope.runId,
      writeIntentId: intent.writeIntentId, pid: process.pid, clicks });
    await new Promise<never>(() => undefined);
  };
}

stage = "compose";
  const report = await composeWorkerRuntime({ lifetimeLock, stopSignal: controller.signal, admission: machine, isolation: rebuildRuntimeIsolation, repoRoot,
    args: [root.descriptor.id, "--pool-index", "1", "--drain"], env: {},
    ...(mode === "attempting" ? { sessionFactory: writeFixtureSessions(driver).factory } : {}),
    executionRegistry: { resolve: id => modules.find(module => module.descriptor.id === id), stores,
      manifest: childExecutionBuildManifest },
    openDatabase: (options, clock) => {
      database = AuthorityDatabase.open(admission, options, clock, undefined, {
        afterSuccessStorageStep: step => {
          if (mode !== "checkpoint" || observed || step !== "result") return;
          assert.ok(database);
          const run = database.authority.runs.listByWorkflow(childExecutionRoot.descriptor.id)
            .flatMap(root => database?.authority.runs.listChildren(root.envelope.runId) ?? [])
            .flatMap(child => [child, ...(database?.authority.runs.listChildren(child.envelope.runId) ?? [])])
            .find(candidate => candidate.lifecycle.state === "running"
              && (database?.authority.runCheckpoints.listByItem(candidate.envelope.workflow, candidate.envelope.itemId).length ?? 0) > 0);
          assert.ok(run && "workerId" in run.lifecycle);
          const checkpoints = database.authority.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId);
          assert.ok(checkpoints.length > 0);
          lifetimeLock.assertHeld();
          assert.equal(database.authority.workerLeases.get(run.lifecycle.workerId)?.processId, process.pid);
          observed = true;
          assert.ok(typeof process.send === "function");
          process.send({ kind: "checkpoint", workerId: run.lifecycle.workerId, runId: run.envelope.runId, pid: process.pid });
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        },
      }, undefined, credentials);
      return database;
    }, write: () => undefined,
  });
  stage = "terminal";
  assert.equal(report.closure, "proved");
  admission.release();
  machine.release();
  await lifetimeLock.close();
  process.send?.({ kind: "terminal", closure: report.closure, done: report.outcomes.filter(outcome => outcome.state === "done").length },
    () => { process.disconnect?.(); });
} catch (error) {
  const type = error instanceof z.ZodError ? "ZOD_ERROR" : error instanceof Error ? "ERROR"
    : error === null ? "NULL" : error === undefined ? "UNDEFINED" : "OTHER";
  const errorSha256 = createHash("sha256").update(error instanceof Error ? error.stack ?? error.message : type).digest("hex");
  process.send?.({ kind: "failure", code: "CHILD_EXECUTION_FAILED", stage, type,
    causeCode: catalogCodeForThrown(error) ?? "UNCLASSIFIED", errorSha256 });
  process.exitCode = 1;
}
