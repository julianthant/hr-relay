import assert from "node:assert/strict";
import { it } from "vitest";
import { runRelayBackend } from "../../../scripts/dev/relay-backend.js";
import { StorageMaintenanceCustodyUnavailableError } from "../../../src/backend/storage/maintenance/custody-availability.js";

it("reports a stop only after the entire bootstrap has settled", async () => {
  let finish: (() => void) | undefined;
  let settled = false;
  const drain = new Promise<void>(resolve => { finish = resolve; });
  const pending = runRelayBackend(() => drain).then(result => { settled = true; return result; });
  await Promise.resolve();
  assert.equal(settled, false);
  finish?.();
  assert.deepEqual(await pending, { type: "relay-dashboard-stopped", state: "clean" });
});

it("classifies only the bare backup custody refusal as an expected stop", async () => {
  assert.deepEqual(await runRelayBackend(async () => { throw new StorageMaintenanceCustodyUnavailableError("backup"); }),
    { type: "relay-dashboard-stopped", state: "backup-unavailable" });
  class DerivedRefusal extends StorageMaintenanceCustodyUnavailableError {}
  const caused = new StorageMaintenanceCustodyUnavailableError("backup");
  Object.defineProperty(caused, "cause", { value: new Error("closure failed") });
  for (const failure of [caused, new DerivedRefusal("backup"), new StorageMaintenanceCustodyUnavailableError("restore"),
    new AggregateError([new StorageMaintenanceCustodyUnavailableError("backup")]),
    Object.assign(new Error("spoof"), { code: "STORAGE_MAINTENANCE_CUSTODY_UNAVAILABLE" }), new Error("write failed")]) {
    await assert.rejects(runRelayBackend(async () => { throw failure; }), error => error === failure);
  }
});
