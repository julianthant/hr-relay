import { existsSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { acquireRuntimeProcessLock } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
const root = process.argv[2]; const contender = process.argv[3];
if (root === undefined || contender === undefined) throw new Error("synthetic-election-input-required");
try {
  const lock = acquireRuntimeProcessLock({ processLockRoot: root, name: "geocode", pid: process.pid }, undefined, { afterGeocodeGenerationRead() {
    writeFileSync(join(root, `${contender}.ready`), "ready");
    const deadline = Date.now() + 5000;
    while (!existsSync(join(root, "contend"))) { if (Date.now() >= deadline) throw new Error("synthetic-election-barrier-timeout"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5); }
  } });
  process.send?.({ kind: "election", state: "owned", generation: lock.generation, acquisitionId: lock.acquisitionId });
  process.on("message", () => { lock.release(); process.disconnect?.(); });
} catch (error) { process.send?.({ kind: "election", state: "refused", error: String(error) }); process.disconnect?.(); }
