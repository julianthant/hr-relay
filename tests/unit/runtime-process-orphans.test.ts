import assert from "node:assert/strict";
import fs, { Dir, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { inspectRuntimeProcessOrphans, WorkerProcessLockFileSchema } from "../../src/infra/sqlite/runtime-process-locks.js";
import { NOW, UUID_1 } from "./fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hrauto-orphan-stream-"));
  roots.push(root);
  mkdirSync(join(root, "workers"));
  return root;
}

function writeRecord(root: string, index: number, released: boolean, current = false) {
  const record = WorkerProcessLockFileSchema.parse({
    schemaVersion: current ? 3 : 2, name: "workers", workerId: `fixture-worker-${String(index)}`,
    pid: index, acquisitionId: UUID_1, acquiredAt: NOW, releasedAt: released ? NOW : null,
    ...(current ? { processIdentity: { platform: "darwin", startToken: "original-owner" } } : {}),
  });
  writeFileSync(join(root, "workers", `${String(index)}.lock.json`), JSON.stringify(record));
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
