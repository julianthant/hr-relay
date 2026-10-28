import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { chromium } from "playwright";
import { afterEach,it,vi } from "vitest";
import { createRunResourcesFactory } from "../../../../src/backend/app/composition/worker/run-resources.js";
import { assertProfileBrowserRoot } from "../../../../src/backend/app/composition/profile-credential-inventory.js";
import { findProfileFixtureAdmission } from "../../../support/helpers/admission-fixture.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { createTimeoutDeadlineScheduler } from "../../../../src/backend/runtime/scheduling/timeout-deadline-scheduler.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { assertWorkerProcessCustody,bindWorkerProcessAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { admitDirectWorker } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { WorkerIdSchema,WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { createCredentialStore } from "../../../support/helpers/synthetic-storage-admission.js";
import { chatGptFixture } from "../../../support/helpers/chatgpt-account-fixtures.js";
import { CHATGPT_OCR_MODEL,createChatGptOcrAdapter } from "../../../../src/backend/processing/providers/chatgpt-ocr-adapter.js";
const cleanups: (() => void|Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.restoreAllMocks(); });

it("browser launch forwards retained display and mode through a headless custody fixture", async () => {
  const f = await settingsFixture(true); cleanups.push(f.close);
  const admission=findProfileFixtureAdmission(f.root);assert.ok(admission);
  assert.equal(f.save({ "timeouts.taskMs": { set: 60_000 }, "timeouts.sessionAcquireMs": { set: 120_000 } }).state, "applied");
  const old = f.create();
  assert.equal(f.save({ "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 },
    "browser.headless": { set: false }, "timeouts.taskMs": { set: 90_000 }, "timeouts.sessionAcquireMs": { set: 180_000 } }).state, "applied");
  const next = f.create();
  const artifacts = createContentAddressedArtifactWriter({ admission }); await artifacts.ready;
  const held = bindWorkerProcessAdmission({ processLockRoot: join(f.root, "locks"), authorityPath: f.path, pid: process.pid, clock: f.clock,
    open: () => f.database, close: () => {}, admit: (database) => database.withAuthorityTransaction(repositories => admitDirectWorker(repositories, { commandId: randomUUID(), workflow: personLookupDescriptor.id, poolIndex: 1,
    expectedPoolVersion: repositories.workerPools.get(personLookupDescriptor.id)?.version ?? 0, processId: process.pid,
    now: f.clock.now().toISOString() }, randomUUID()).workerId) });
  cleanups.push(() => held.processLock.release());
  assert.ok(held.processLock.acquisitionId);
  const acquisitionId = held.processLock.acquisitionId;
  const account=await chatGptFixture(admission);cleanups.push(()=>account.cleanup());
  const ocr=createChatGptOcrAdapter({account:account.service,artifacts,clock:f.clock,model:CHATGPT_OCR_MODEL,assertCurrent:()=>admission.assertProfileRuntime()});
  const factory = createRunResourcesFactory({ ocr,assertBrowserRoot: root=>assertProfileBrowserRoot(admission,root), assertProfileOwner: workerId => {
    assert.equal(workerId, held.workerId);
    assertWorkerProcessCustody({ processLockRoot: join(f.root, "locks"), acquisitionId, pid: process.pid, workerId, authorityPath: f.path });
  }, processLockRoot: join(f.root, "locks"), authority: f.database.authority, artifacts, clock: systemClock,
    ids: { uuid: randomUUID }, isolation: rebuildRuntimeIsolation, protectedSecrets: createCredentialStore({ stateRoot: f.root }),
    scheduler: createTimeoutDeadlineScheduler(systemClock), environment: {} });
  const first = factory.forRun(old); const second = factory.forRun(next);
  assert.equal(first.taskDeadlineMs, 60_000); assert.equal(second.taskDeadlineMs, 90_000);
  assert.equal(first.sessionAcquireMs, 120_000); assert.equal(second.sessionAcquireMs, 180_000);
  assert.equal(first.defaultBrowserMode, "headless"); assert.equal(second.defaultBrowserMode, "headed");
  const launchPersistentContext = chromium.launchPersistentContext.bind(chromium);
  // Observe the original options; the local fixture transport always opens headless Chromium.
  const launch = vi.spyOn(chromium, "launchPersistentContext").mockImplementation((profile, options) =>
    launchPersistentContext(profile, { ...options, headless: true }));
  const open = (run: typeof old) => factory.forRun(run).sessionFactory.open({ workerId: WorkerIdSchema.parse(held.workerId), workflowId: WorkflowIdSchema.parse("person-lookup"),
    system: "ucpath", instance: "prod", configFingerprint: run.envelope.configFingerprint, acceptDownloads: false, exclusive: false,
    signal: new AbortController().signal, duoCeremony: { withCeremony: () => { throw new Error("no authentication in launch proof"); } } });
  const started = f.database.authority.workerLeases.start({ workerId: held.workerId, workflow: "person-lookup",
    browserSystems: ["ucpath"], processId: process.pid, requestedBy: "local-operator", now: f.clock.now().toISOString() });
  assert.equal(started.state, "started");
  if (started.state !== "started") throw new Error("native worker lease did not start");
  const openAndClose = async (run: typeof old) => {
    const resource = await open(run);
    assert.ok(resource.browserMode);
    assert.ok(resource.profileDirectory);
    const observation = { workerId: held.workerId, leaseGeneration: started.lease.leaseGeneration,
      sessionId: resource.sessionId, system: resource.system, instance: resource.instance,
      configFingerprint: resource.configFingerprint, signInFingerprint: resource.signInFingerprint,
      browserMode: resource.browserMode, profileDirectory: resource.profileDirectory, profileRevision: resource.profileRevision,
      acceptDownloads: resource.acceptDownloads, exclusive: resource.exclusive,
      openedAt: f.clock.now().toISOString(), observedAt: f.clock.now().toISOString() };
    try {
      f.database.authority.workerControls.observe({ ...observation, health: "unknown" });
    } finally {
      const proof = await resource.close({ reason: "worker-stop" });
      assert.equal(proof.sessionId, resource.sessionId);
      assert.equal(proof.system, resource.system);
      assert.equal(proof.pagesClosed, true);
      assert.equal(proof.contextClosed, true);
      f.database.authority.workerControls.observe({ ...observation, health: "closed", observedAt: f.clock.now().toISOString() });
    }
  };
  await openAndClose(old);
  await openAndClose(next);
  assert.deepEqual(launch.mock.calls.map((call) => call[1]?.viewport), [{ width: 2560, height: 1440 }, { width: 1980, height: 1080 }]);
  assert.deepEqual(launch.mock.calls.map((call) => call[1]?.headless), [true, false]);
  const slot = f.database.authority.workerSlots.get(held.workerId); assert.ok(slot);
  const retained = f.database.authority.configSnapshots.get(old.envelope.configSnapshotId); assert.ok(retained);
  assert.equal(launch.mock.calls[0]?.[0], join(retained.config.paths.browserProfileRoot, `w${String(slot.ordinal)}`, "ucpath"));
  assert.equal(launch.mock.calls[0]?.[0], launch.mock.calls[1]?.[0], "the retained native worker slot owns one stable system profile across settings snapshots");
  assert.equal(factory.forRun(old), first);
});
