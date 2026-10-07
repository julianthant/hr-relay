import { StartCommandRequestSchema } from "../../../../../src/rules/commands/commands.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { readLaunchRecovery, retainLaunchFinal, dismissLaunchRecovery } from "../../../../../src/dashboard/app/run-launch-recovery.js";
import { launchHarness } from "../../../../support/fixtures/run-launch-fixtures.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
function storage() { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; }
describe("minimal final submission recovery through production services", () => {
  it("retains no raw values; lost-response reload and duplicate replay return the same run", async () => {
    const h = launchHarness(); cleanup.push(h.dispose); const persisted = storage();
    const plan = h.proposal(undefined, undefined, true);
    const command = h.launch.prepareFinal(plan); retainLaunchFinal(persisted, command);
    const bytes = [...persisted.data.values()].join(""); assert.ok(!bytes.includes("10812345"));
    assert.ok(!bytes.includes("submissions") && !bytes.includes("rawInput"));
    h.loseResponse(); await assert.rejects(h.launch.submit(command), /lost response/);
    const roots = h.queueRoots; assert.equal(roots.length, 1);
    const restored = readLaunchRecovery(persisted, "local-operator"); assert.deepEqual(restored, command); assert.ok(restored);
    const response = await h.launch.replay(restored); assert.equal(response.state, "already-applied");
    assert.deepEqual(h.queueRoots, roots);
    await assert.rejects(h.launch.replay({ ...restored, requestedAt: "2026-09-21T00:00:00.000Z" }), /divergent|reused/);
    dismissLaunchRecovery(persisted, restored); assert.equal(readLaunchRecovery(persisted, "local-operator"), null);
  });
  it("refuses divergent pending identities, corrupt records, missing acknowledgments and failed persistence before sending", () => {
    const h = launchHarness(); cleanup.push(h.dispose); const persisted = storage();
    const command = h.launch.prepareFinal(h.proposal()); retainLaunchFinal(persisted, command);
    assert.throws(() => retainLaunchFinal(persisted, StartCommandRequestSchema.parse({ ...command, commandId: h.ids.uuid() })), /RECOVERY_PENDING/);
    const key = [...persisted.data.keys()][0]; persisted.data.set(key, "{}");
    assert.throws(() => readLaunchRecovery(persisted, "local-operator"), /RECOVERY_INVALID/);
    persisted.data.clear(); assert.throws(() => dismissLaunchRecovery(persisted, command), /RECOVERY_MISMATCH/);
    assert.throws(() => retainLaunchFinal({ getItem: () => null, setItem: () => {} }, command), /RECOVERY_WRITE_FAILED/);
    assert.equal(h.queueRoots.length, 0);
  });
});
