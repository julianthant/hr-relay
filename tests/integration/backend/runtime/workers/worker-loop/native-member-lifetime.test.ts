import assert from "node:assert/strict";
import { it } from "vitest";
import { foundationFixture, id, NOW } from "../../../../../support/helpers/database-foundation/fixtures.js";
import { ManualScheduler } from "../../../../../support/helpers/phase1f-executor-harness.js";
import { workerPoolMember, WorkerPoolMemberSchema } from "../../../../../../src/models/run/worker-slot.js";
import { createDashboardWorkerProcessSupervisor } from "../../../../../../src/backend/runtime/workers/worker-supervisor.js";
import { ActorIdSchema, IsoInstantSchema } from "../../../../../../src/rules/identity/ids.js";

it.each(["poolIndex", "membershipRevision"] as const)("refuses an altered same-id spawned member %s before stop effects", async field => {
  const fixture = foundationFixture();
  const slot = fixture.db.authority.workerSlots.list("person-lookup")[0];
  assert.ok(slot);
  const member = workerPoolMember(slot);
  const lease = fixture.db.authority.workerLeases.get(member.workerId);
  assert.ok(lease);
  let onExit: ((code: number | null, signal: string | null) => void) | undefined;
  const effects: string[] = [];
  let spawned = false;
  const supervisor = createDashboardWorkerProcessSupervisor({
    launch: { command: process.execPath, prefixArgs: [], cwd: fixture.root, environment: {} },
    spawn: () => { spawned = true; return ({ pid: process.pid, kill: signal => { effects.push(signal); return true; },
      onExit: listener => { onExit = listener; }, onError: () => undefined });
    },
    leases: { observe: () => spawned ? ({ processId: process.pid, startedAt: lease.lifecycle.startedAt }) : undefined },
    gracefulStop: { request: () => { effects.push("graceful-stop"); return { requestedAt: NOW, leaseVersions: { before: 1, after: 2 } }; } },
    clock: fixture.clock, scheduler: new ManualScheduler(fixture.clock, 0), birth: { pollMs: 250, timeoutMs: 10_000 },
    proveRetirement: () => { throw new Error("retirement must not be requested"); },
    onFault: error => { throw error; },
  });
  try {
    await supervisor.execute({ command: "spawn-worker", commandId: id(200), member });
    const before = supervisor.memberEvidence(member);
    const generation = fixture.db.getMeta().authorityGeneration;
    const altered = WorkerPoolMemberSchema.parse({ ...member, [field]: member[field] + 1 });
    await assert.rejects(() => supervisor.execute({ command: "stop-worker", commandId: id(201), member: altered,
      escalation: [{ stage: "graceful-stop-requested", timeoutMs: 120_000 }, { stage: "sigterm-sent", timeoutMs: 30_000 }, { stage: "sigkill-sent" }],
      directive: { commandId: id(201), requestedAt: IsoInstantSchema.parse(NOW), requestedBy: ActorIdSchema.parse("local-operator") },
    }), /worker-control-owned-member-changed/u);
    assert.deepEqual(effects, []);
    assert.deepEqual(supervisor.memberEvidence(member), before);
    assert.deepEqual(fixture.db.authority.workerSlots.get(member.workerId), slot);
    assert.deepEqual(fixture.db.authority.workerLeases.get(member.workerId), lease);
    assert.equal(fixture.db.getMeta().authorityGeneration, generation);
  } finally {
    onExit?.(0, null);
    fixture.dispose();
  }
});
