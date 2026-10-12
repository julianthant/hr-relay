import assert from "node:assert/strict";
import fs,{ Dir,mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach,describe,it,vi } from "vitest";
import { inspectRuntimeProcessOrphans,WorkerProcessLockFileSchema } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-orphan-stream-"));
  roots.push(root);
  mkdirSync(join(root, "workers"));
  return root;
}

function writeRecord(root: string, index: number, released: boolean, current = false) {
  const record = WorkerProcessLockFileSchema.parse({
    schemaVersion: 3, name: "workers", workerId: `fixture-worker-${String(index)}`,
    pid: index, acquisitionId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, acquiredAt: NOW, releasedAt: released ? NOW : null,
    processIdentity: { platform: "darwin", startToken: current ? "original-owner" : "new-owner" },
  });
  writeFileSync(join(root, "workers", `${record.acquisitionId}.lock.json`), JSON.stringify(record), { mode: 0o600 });
}

describe("streamed optional process-orphan inspection", () => {
  it("inspects every unreleased owner without materializing or sorting worker history", () => {
    const root = fixture();
    for (let index = 1; index <= 64; index += 1) writeRecord(root, index, true);
    writeRecord(root, 101, false);
    writeRecord(root, 102, false);
    writeRecord(root, 103, false, true);
    writeFileSync(join(root, "workers", ".pending-write"), "unfinished hidden atomic-write staging");
    const bulkReads = vi.spyOn(fs, "readdirSync");
    syncBuiltinESMExports();
    const observed: number[] = [];
    const result = inspectRuntimeProcessOrphans(root, {
      observeProcessIdentity(pid) {
        observed.push(pid);
        return pid === 101
          ? { state: "gone" }
          : { state: "alive", identity: { platform: "darwin", startToken: "new-owner" } };
      },
    });
    assert.deepEqual(result, { staleServerRecords: 0, staleWorkerRecords: 2 });
    assert.deepEqual(observed.sort((a, b) => a - b), [101, 102, 103]);
    assert.equal(bulkReads.mock.calls.length, 0, "preflight must not allocate the whole retained history");
  });

  it("validates released history too and closes its stream when a malformed record refuses", () => {
    const root = fixture();
    writeRecord(root, 1, true);
    writeFileSync(join(root, "workers", "malformed.lock.json"), JSON.stringify({ releasedAt: NOW }));
    const closed = vi.spyOn(Dir.prototype, "closeSync");
    assert.throws(() => inspectRuntimeProcessOrphans(root), /worker process-lock record malformed.lock.json is malformed/u);
    assert.equal(closed.mock.calls.length, 1);
  });
});
