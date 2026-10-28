import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { parseWorkerProcessRecoveryCommand } from "../../../../src/backend/storage/maintenance/worker-process-recovery.js";
import { processCustodyDigest, validateWorkerProcessRecoveryReceipt } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";

const acquisitionId = "00000000-0000-4000-8000-000000000001";
function receiptFixture() {
  const workspace = "/synthetic/relay", state = `${workspace}/.tracker/data`, processLockRoot = `${state}/locks`;
  const witness = (path: string) => ({ path, device: 1, inode: 2, digest: "a".repeat(64) });
  const capture = { singletonClaims: [], workspace, installationId: acquisitionId, processLockRoot,
    original: { schemaVersion: 3, name: "workers", workerId: "synthetic-worker", pid: 123,
      processIdentity: { platform: "darwin", startToken: "123" }, acquisitionId,
      acquiredAt: "2026-10-18T05:47:55.967Z", releasedAt: null },
    file: witness(`${processLockRoot}/workers/${acquisitionId}.lock.json`),
    witnesses: [`${workspace}/.tracker/control/installation.json`, `${workspace}/.tracker/control/locator.json`,
      `${state}/.runtime-owner.json`, `${state}/artifacts/.runtime-owner.json`].map(witness),
    roots: [state, `${state}/artifacts`, processLockRoot].map(path => ({ path, device: 1, inode: 2, mode: 0o40700, owner: 501 })) };
  const body = { schemaVersion: 1, kind: "offline-worker-process-recovery", capture, captureDigest: processCustodyDigest(capture),
    proof: { sourceDigest: "b".repeat(64), nativeDigest: "c".repeat(64), runtimeDigest: "d".repeat(64),
      originalOwner: "gone", processes: "absent", openFiles: "absent", workingDirectories: "absent", nativeResources: "closed",
      checkedAt: "2026-10-27T05:47:55.967Z", recoveringPid: 456, recoveringIdentity: { platform: "darwin", startToken: "456" }, restoreAdmissionId: acquisitionId } };
  return { ...body, digest: processCustodyDigest(body) };
}

describe("offline worker process recovery command and receipt boundary", () => {
  it("requires a deliberate plan or an exact captured apply identity", () => {
    assert.deepEqual(parseWorkerProcessRecoveryCommand(["--acquisition", acquisitionId, "--plan"]), { mode: "plan", acquisitionId, json: false });
    assert.deepEqual(parseWorkerProcessRecoveryCommand(["--apply", "--capture", "a".repeat(64), "--acquisition", acquisitionId, "--json"]),
      { mode: "apply", acquisitionId, captureDigest: "a".repeat(64), json: true });
    for (const args of [[], ["--acquisition", acquisitionId], ["--acquisition", acquisitionId, "--apply"],
      ["--acquisition", acquisitionId, "--plan", "--apply"], ["--acquisition", acquisitionId, "--plan", "--capture", "a".repeat(64)],
      ["--acquisition", acquisitionId, "--plan", "--plan"], ["--acquisition", acquisitionId, "--plan", "--force"],
      ["--acquisition", acquisitionId, "--apply", "--capture", "broken"]]) assert.throws(() => parseWorkerProcessRecoveryCommand(args));
  });

  it("authenticates a distinct full recovery receipt without rewriting original release", () => {
    const receipt = receiptFixture(), bytes = JSON.stringify(receipt);
    const validated = validateWorkerProcessRecoveryReceipt(JSON.parse(bytes));
    assert.equal(validated.kind, "offline-worker-process-recovery");
    assert.equal(validated.capture.original.releasedAt, null);
    assert.equal(validated.capture.original.acquisitionId, acquisitionId);
    assert.equal(JSON.stringify(receipt), bytes);
    for (const mutate of [
      (value: typeof receipt) => { value.capture.original.pid += 1; },
      (value: typeof receipt) => { value.capture.file.inode += 1; },
      (value: typeof receipt) => { value.capture.file.digest = "f".repeat(64); },
      (value: typeof receipt) => { value.proof.nativeDigest = "f".repeat(64); },
      (value: typeof receipt) => { value.captureDigest = "f".repeat(64); },
    ]) {
      const changed = structuredClone(receipt); mutate(changed);
      assert.throws(() => validateWorkerProcessRecoveryReceipt(changed), /receipt-unproved/u);
    }
  });

  it("refuses incomplete, fabricated release and predating closure even with recomputed envelope digest", () => {
    const original = receiptFixture();
    const { digest: _digest, ...body } = original;
    assert.throws(() => validateWorkerProcessRecoveryReceipt(body));
    const early = { ...body, proof: { ...body.proof, checkedAt: "2026-10-01T00:00:00.000Z" } };
    assert.throws(() => validateWorkerProcessRecoveryReceipt({ ...early, digest: processCustodyDigest(early) }), /receipt-unproved/u);
    const capture = { ...body.capture, original: { ...body.capture.original, releasedAt: body.proof.checkedAt } };
    const released = { ...body, capture, captureDigest: processCustodyDigest(capture) };
    assert.throws(() => validateWorkerProcessRecoveryReceipt({ ...released, digest: processCustodyDigest(released) }), /receipt-unproved/u);
    assert.throws(() => validateWorkerProcessRecoveryReceipt({ ...original, ownerRelease: true }));
  });
});
