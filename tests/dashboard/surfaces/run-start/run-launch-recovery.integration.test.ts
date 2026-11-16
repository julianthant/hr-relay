import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { dismissLaunchRecovery,readLaunchRecovery,readLaunchVerificationPlan,retainLaunchFinal } from "../../../../src/dashboard/surfaces/run-start/run-launch-recovery.js";
import { StartCommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { StartPlanIdSchema } from "../../../../src/rules/identity/ids.js";
import { launchHarness } from "../../../support/fixtures/run-launch-fixtures.js";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const dispose of cleanup.splice(0)) await dispose(); });
function storage() { const data = new Map<string, string>(); return { data, getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; }
describe("minimal final submission recovery through production services", () => {
  it("retains no raw values; lost-response reload and duplicate replay return the same run", async () => {
    const h = await launchHarness(); cleanup.push(h.dispose); const persisted = storage();
    const plan = h.proposal(undefined, undefined, true);
    const command = h.launch.prepareFinal(plan); retainLaunchFinal(persisted, command);
    const bytes = [...persisted.data.values()].join(""); assert.ok(!bytes.includes("10812345"));
    assert.ok(!bytes.includes("submissions") && !bytes.includes("rawInput"));
    h.loseResponse(); const lost = await h.launch.submit(command, h.binding, plan); assert.equal(lost.kind, "uncertain"); assert.match(String(lost.cause), /lost response/);
    const roots = h.queueRoots; assert.equal(roots.length, 1);
    const restored = readLaunchRecovery(persisted, "local-operator"); assert.deepEqual(restored, command); assert.ok(restored);
    const response = await h.launch.submit(restored, h.binding); assert.equal(response.kind, "confirmed"); assert.equal(response.reply && "state" in response.reply ? response.reply.state : undefined, "already-applied");
    assert.deepEqual(h.queueRoots, roots);
    assert.throws(() => h.launch.submit({ ...restored, requestedAt: "2026-09-21T00:00:00.000Z" }, h.binding), /divergent|reused/);
    dismissLaunchRecovery(persisted, restored); assert.equal(readLaunchRecovery(persisted, "local-operator"), null);
  });
  it("refuses divergent pending identities, corrupt records, missing acknowledgments and failed persistence before sending", async () => {
    const h = await launchHarness(); cleanup.push(h.dispose); const persisted = storage();
    const command = h.launch.prepareFinal(h.proposal()); retainLaunchFinal(persisted, command);
    assert.throws(() => retainLaunchFinal(persisted, StartCommandRequestSchema.parse({ ...command, commandId: h.ids.uuid() })), /RECOVERY_PENDING/);
    const key = [...persisted.data.keys()][0]; persisted.data.set(key, "{}");
    assert.throws(() => readLaunchRecovery(persisted, "local-operator"), /RECOVERY_INVALID/);
    persisted.data.clear(); assert.throws(() => dismissLaunchRecovery(persisted, command), /RECOVERY_MISMATCH/);
    assert.throws(() => retainLaunchFinal({ getItem: () => null, setItem: () => {} }, command), /RECOVERY_WRITE_FAILED/);
    assert.equal(h.queueRoots.length, 0);
  });
  it("retains the reviewed verification bindings across reload without retaining subject or source values", async () => {
    const h = await launchHarness(); cleanup.push(h.dispose); const persisted = storage();
    const plan = h.proposal(undefined, undefined, true);
    const command = h.launch.prepareFinal(plan);
    retainLaunchFinal(persisted, command, { ...plan, planned: plan.planned.map(entry => ({ ...entry, title: "private-subject-title", subtitle: "private-source-value" })) });
    const bytes = [...persisted.data.values()].join("");
    assert.doesNotMatch(bytes, /private-subject-title|private-source-value|10812345|submissions|rawInput/);
    const bindings = readLaunchVerificationPlan(persisted, "local-operator"); assert.ok(bindings);
    assert.deepEqual(bindings.fingerprints, command.payload); assert.equal(bindings.planned.length, plan.planned.length);
    h.loseResponse(); assert.equal((await h.launch.submit(command, h.binding, bindings)).kind, "uncertain");
    const roots = h.queueRoots;
    retainLaunchFinal(persisted, command);
    assert.deepEqual(readLaunchVerificationPlan(persisted, "local-operator"), bindings);
    assert.equal((await h.launch.submit(command, h.binding, readLaunchVerificationPlan(persisted, "local-operator"))).kind, "confirmed");
    assert.deepEqual(h.queueRoots, roots);
    assert.throws(() => retainLaunchFinal(persisted, command, { ...plan, dryRun: !plan.dryRun }), /RECOVERY_MISMATCH/);
    assert.deepEqual(readLaunchVerificationPlan(persisted, "local-operator"), bindings);
    assert.throws(() => retainLaunchFinal(storage(), command, { ...plan, startPlanId: StartPlanIdSchema.parse(h.ids.uuid()) }), /RECOVERY_INVALID/);
  });

});
