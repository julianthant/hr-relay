import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import { ownedWorkerLifetimeFixture, attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";
import { runClaim } from "../../../../src/models/run/record.js";
import { publishStartupProcessClosure, readProcessCustodyFile } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { profileProcessQuery } from "../../../../src/backend/storage/maintenance/process-closure.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";

const world = createRunRecordServiceTestWorld();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); await world.cleanup(); vi.restoreAllMocks(); });

async function fixture() {
  const h = await ownedWorkerLifetimeFixture(world, { fenceInOwner: true }); cleanups.push(h.dispose);
  const queued = world.created(h.service, { ...h.request, descriptorVersion: personLookupDescriptor.version, contractFingerprint: personLookupDescriptor.contractFingerprint });
  const claimed = h.database.authority.runs.claimNext({ workflow: queued.envelope.workflow, workerId: h.slot.workerId,
    workerLifetime: { leaseGeneration: h.started.leaseGeneration, membershipRevision: h.slot.membershipRevision }, now: h.now });
  assert.equal(claimed.state, "claimed"); if (claimed.state !== "claimed") throw new Error("fixture-claim-refused");
  let run = claimed.run;
  for (const state of ["validating", "running"] as const) {
    const changed = h.database.authority.runs.transition({ runId: queued.envelope.runId, expectedVersion: run.version, now: h.now,
      lifecycle: { state, workerId: h.slot.workerId, workerLifetime: { leaseGeneration: h.started.leaseGeneration, membershipRevision: h.slot.membershipRevision },
        claimedAt: h.now, heartbeatAt: h.now, ...(state === "running" ? { currentNodeId: "crm-dates" } : {}) } });
    assert.equal(changed.state, "applied"); if (changed.state !== "applied") throw new Error("fixture-transition-refused");
    run = changed.run;
  }
  const custody = h.database.workerLifetimeCustody(h.slot.workerId);
  const file = readProcessCustodyFile(join(custody.birth.processLockRoot, "workers", `${custody.birth.owner.acquisitionId}.lock.json`)).witness;
  const claim = runClaim(run); assert.ok(claim);
  const request = { commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: run.version,
    claim: { workerId: claim.workerId, claimGeneration: claim.claimGeneration }, birth: custody.birth, originalFile: file, closureDigest: "0".repeat(64), now: h.now };
  const die = async () => { const closed = once(h.old.child, "close"); h.old.child.kill("SIGKILL"); await closed; };
  const closeProcess = () => {
    const installation = h.machine.readInstallationContext(); assert.ok(installation);
    const browserRoots = [join(h.root, "browsers")]; mkdirSync(browserRoots[0], { recursive: true, mode: 0o700 });
    vi.spyOn(profileProcessQuery, "spawnSync").mockImplementation(command => ({ pid: 1, output: [], status: 0, signal: null,
      stdout: command === "/bin/ps" ? "1 /sbin/launchd\n" : "p1\nfcwd\ntDIR\nn/\n", stderr: "" }));
    const receipt = publishStartupProcessClosure({ processLockRoot: custody.birth.processLockRoot, original: custody.birth.owner, file,
      ...h.admission.profileBinding, authorityPath: join(h.root, "state.db"), browserRoots,
      heldWriteIntentIds: h.database.authority.writeIntents.listByRun(run.envelope.runId).filter(intent => intent.status !== "committed" && intent.status !== "observed-present").map(intent => intent.writeIntentId),
      witnesses: ["installation.json", "locator.json"].map(name => readProcessCustodyFile(join(installation.workspace, ".tracker", "control", name)).witness),
      roots: [h.root, h.admission.artifactRoot, custody.birth.processLockRoot].map(path => { const stat = lstatSync(path);
        return { path, device: stat.dev, inode: stat.ino, mode: stat.mode, owner: stat.uid }; }) }, h.clock);
    request.closureDigest = receipt.digest;
    return receipt;
  };
  return { ...h, run, request, die, closeProcess };
}

it("refuses live ownership, then terminalizes the exact dead claim as failed with auditable recovery and replay", async () => {
  const f = await fixture();
  assert.throws(() => f.service.recoverCrash(f.request), /crash-recovery-owner-unproved/u);
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.version, f.run.version);
  await f.die();
  assert.throws(() => f.database.terminalizeFailure(personLookupDescriptor, world.failureTerminalRequest(f.run, randomUUID()).terminal), /worker|execution/u);
  f.closeProcess();
  const result = f.service.recoverCrash(f.request);
  assert.equal(result.state, "applied"); if (result.state !== "applied") throw new Error("recovery-refused");
  assert.ok(result.run.lifecycle.state === "terminal" && result.run.lifecycle.outcome === "failed");
  const failure = f.database.authority.failures.listByRun(f.run.envelope.runId)[0]; assert.ok(failure);
  assert.equal(failure.code, "RUN_INTERRUPTED_BY_CRASH");
  const command = f.database.authority.lifecycleJournal.getCommand(f.request.commandId);
  assert.ok(command && "operation" in command); assert.equal(command.operation, "recover-crash");
  assert.equal(f.service.recoverCrash(f.request).state, "applied-already");
  assert.ok(f.database.authority.runResults.get(f.run.envelope.runId));
  const original = readProcessCustodyFile(f.request.originalFile.path);
  assert.equal(canonicalJsonStringify(original.witness), canonicalJsonStringify(f.request.originalFile));
});

it("refuses stale claim/version and changed original process evidence before any recovery effect", async () => {
  const f = await fixture(); await f.die(); f.closeProcess();
  for (const changed of [{ ...f.request, expectedVersion: f.request.expectedVersion + 1 },
    { ...f.request, claim: { ...f.request.claim, claimGeneration: f.request.claim.claimGeneration + 1 } },
    { ...f.request, originalFile: { ...f.request.originalFile, digest: "0".repeat(64) } }]) assert.throws(() => f.service.recoverCrash(changed));
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.version, f.run.version);
  assert.deepEqual(f.database.authority.failures.listByRun(f.run.envelope.runId), []);
});

it("keeps an unknown write unchanged and parks the run without a terminal result", async () => {
  const f = await fixture();
  const intent = await attemptingOwnedWrite(f, f.run);
  await f.die(); const receipt = f.closeProcess();
  assert.equal(receipt.proof.nativeWrites, "HELD");
  assert.deepEqual(receipt.heldWriteIntentIds, [intent.writeIntentId]);
  const result = f.service.recoverCrash(f.request);
  assert.equal(result.state, "applied"); if (result.state !== "applied") throw new Error("recovery-refused");
  assert.equal(result.run.lifecycle.state, "parked-write");
  assert.deepEqual(f.database.authority.writeIntents.get(intent.writeIntentId), intent);
  assert.equal(f.database.authority.runResults.get(f.run.envelope.runId), undefined);
  assert.equal(f.service.recoverCrash(f.request).state, "applied-already");
});
