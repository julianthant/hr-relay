/**
 * D271's worker-process controls on the Session Panel — the pool roster fold,
 * the plan intent (including its explicit scale-down set), and the two commands
 * the controls post.
 *
 * Three claims are pinned here that nothing else in the tree can hold.
 *
 * **The bundle's copy of the pool contract cannot drift from the kernel's.**
 * `src/dashboard/**` may not import `src/core` (`dashboard-wire-boundary`), so
 * the cap and the canonical worker id are restated in `shell-model.ts`. A test
 * CAN import both, so it does: raising `MAX_WORKERS_PER_POOL` or changing
 * `poolWorkerId` without the panel fails here rather than in front of an
 * operator who is offered a size the supervisor refuses.
 *
 * **The excess set the panel NAMES is the set the kernel reconciles.** A
 * scale-down's members are `desiredWorkers+1..MAX` — the same derivation
 * `createWorkerPoolRuntimeExecutor` builds its `excessMembers` from — so the
 * confirmation the operator reads names exactly the workers the plan will
 * gracefully stop, and never a member picked by any client-side judgement.
 *
 * **Both refusal arms are drawn verbatim** (D253). The two settlements a pool
 * command can come back refused with are rendered and asserted on the server's
 * own sentence, plus the ONE fact each arm adds: the live pool version for a
 * `conflict`, the kernel's code for a `rejected`. Neither renders a retry.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { MAX_WORKERS_PER_POOL, poolWorkerId } from "../../../src/core/worker-loop.js";
import { CommandRequestSchema } from "../../../src/domain/commands.js";
import { PositiveIntSchema, WorkflowIdSchema } from "../../../src/domain/ids.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../src/domain/dashboard/projection.js";
import {
  composePlanWorkerCountCommand,
  composeSpawnWorkerCommand,
  composeStopWorkerCommand,
} from "../../../src/dashboard/app/command-dispatch.js";
import {
  SESSION_POOL_MAX_WORKERS,
  buildSessionPoolGroups,
  planPoolIntent,
  poolIndexOfWorkerId,
  poolMemberWorkerId,
  poolSlotIsUnmet,
  type SessionPoolGroup,
  type WorkerCardWire,
} from "../../../src/dashboard/surfaces/shell-model.js";
import { PoolOutcomeNotice } from "../../../src/dashboard/surfaces/shell.js";
import { FIXTURE_DAY_WIRE } from "../../parity/helpers/fixture-day.js";

const ACTOR = { actorId: "local-operator", source: "session-panel" } as const;

/** Every fixture card is what the STRICT day schema produced, never a hand-built object. */
function parsedCard(source: WorkerCardWire, overrides: Readonly<Record<string, unknown>>): WorkerCardWire {
  const parsed = DashboardDayWireSchema.parse({
    ...FIXTURE_DAY_WIRE,
    workerCards: [{ ...source, ...overrides }],
    workerPools: [],
  }).workerCards[0];
  if (parsed === undefined) throw new Error("the parsed day wire dropped its only worker card");
  return parsed;
}

/** One live card, cloned off the real wire fixture so no case can express a card authority refuses. */
function cardOf(overrides: Readonly<Record<string, unknown>>): WorkerCardWire {
  const live = FIXTURE_DAY_WIRE.workerCards.find((card) => card.state !== "stopped" && card.state !== "failed");
  if (live === undefined) throw new Error("the wire fixture needs one non-terminal worker card");
  return parsedCard(live, overrides);
}

function retainedCardOf(overrides: Readonly<Record<string, unknown>>): WorkerCardWire {
  const failed = FIXTURE_DAY_WIRE.workerCards.find((card) => card.state === "failed");
  if (failed === undefined) throw new Error("the wire fixture needs one retained failed worker card");
  return parsedCard(failed, overrides);
}

function slotAt(group: SessionPoolGroup, poolIndex: number) {
  const slot = group.slots.find((entry) => entry.poolIndex === poolIndex);
  if (slot === undefined) throw new Error(`pool group ${group.workflowId} has no slot at index ${String(poolIndex)}`);
  return slot;
}

function dayOf(
  workerCards: readonly WorkerCardWire[],
  workerPools: DashboardDayWire["workerPools"],
): DashboardDayWire {
  return DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, workerCards, workerPools });
}

function poolRow(workflowId: string, desiredWorkers: number, version: number): DashboardDayWire["workerPools"][number] {
  return DashboardDayWireSchema.parse({
    ...FIXTURE_DAY_WIRE,
    workerPools: [{
      workflowId,
      desiredWorkers,
      version,
      plannedBy: "local-operator",
      plannedAt: "2026-08-03T09:00:00.000-07:00",
    }],
  }).workerPools[0];
}

function groupFor(day: DashboardDayWire, workflowId: string): SessionPoolGroup {
  const group = buildSessionPoolGroups(day.workerCards, day.workerPools)
    .find((entry) => entry.workflowId === workflowId);
  if (group === undefined) throw new Error(`no pool group folded for ${workflowId}`);
  return group;
}

describe("the panel's copy of the pool contract is pinned to the kernel's", () => {
  it("restates D271's cap as the kernel's own number", () => {
    assert.equal(SESSION_POOL_MAX_WORKERS, MAX_WORKERS_PER_POOL);
  });

  it("derives the same canonical identity the supervisor requires", () => {
    const workflowId = WorkflowIdSchema.parse("person-lookup");
    for (let index = 1; index <= MAX_WORKERS_PER_POOL; index += 1) {
      assert.equal(
        poolMemberWorkerId(String(workflowId), index),
        String(poolWorkerId(workflowId, PositiveIntSchema.parse(index))),
      );
    }
  });

  it("refuses to mint an identity outside the pool's index range", () => {
    assert.throws(() => poolMemberWorkerId("person-lookup", 0), /outside 1\.\.3/u);
    assert.throws(() => poolMemberWorkerId("person-lookup", MAX_WORKERS_PER_POOL + 1), /outside 1\.\.3/u);
    assert.throws(() => poolMemberWorkerId("person-lookup", 1.5), /outside 1\.\.3/u);
  });

  it("reads an index back only from a canonical, unpadded identity", () => {
    assert.equal(poolIndexOfWorkerId("person-lookup", "person-lookup-worker-2"), 2);
    assert.equal(poolIndexOfWorkerId("person-lookup", "person-lookup-worker-01"), undefined);
    assert.equal(poolIndexOfWorkerId("person-lookup", "person-lookup-worker-0"), undefined);
    assert.equal(poolIndexOfWorkerId("person-lookup", "person-lookup-worker-9"), undefined);
    assert.equal(poolIndexOfWorkerId("person-lookup", "separations-worker-1"), undefined);
    assert.equal(poolIndexOfWorkerId("person-lookup", "person-lookup-daemon"), undefined);
  });
});

describe("the pool roster is folded from served facts only", () => {
  it("gives a declared index with no served lease an unmet slot, and never a reason nobody served", () => {
    const day = dayOf(
      [cardOf({ workerId: "person-lookup-worker-1", workflowId: "person-lookup" })],
      [poolRow("person-lookup", 2, 4)],
    );
    const group = groupFor(day, "person-lookup");

    assert.equal(group.expectedVersion, 4);
    assert.deepEqual(group.slots.map((slot) => slot.poolIndex), [1, 2]);
    assert.equal(slotAt(group, 1).membership.state, "live");
    assert.equal(slotAt(group, 2).membership.state, "not-served");
    assert.equal(poolSlotIsUnmet(slotAt(group, 1)), false);
    assert.equal(poolSlotIsUnmet(slotAt(group, 2)), true);
    assert.equal(slotAt(group, 2).workerId, "person-lookup-worker-2");
  });

  it("keeps a retained terminal card on its declared index as a visibly unmet member (D271)", () => {
    const day = dayOf(
      [retainedCardOf({ workerId: "person-lookup-worker-1", workflowId: "person-lookup", stopReason: "crashed" })],
      [poolRow("person-lookup", 1, 2)],
    );
    const group = groupFor(day, "person-lookup");

    assert.equal(slotAt(group, 1).membership.state, "retained");
    assert.equal(poolSlotIsUnmet(slotAt(group, 1)), true);
    assert.equal(group.facts.activeWorkers, 0);
  });

  it("reads a workflow with no pool row as no declaration at basis 0, never as one worker", () => {
    const day = dayOf([cardOf({ workerId: "separations-worker-2", workflowId: "separations" })], []);
    const group = groupFor(day, "separations");

    assert.equal(group.facts.state, "absent");
    assert.equal(group.declaration, undefined);
    assert.equal(group.expectedVersion, 0);
    // The served card's index is still a member of the roster: a live worker
    // above an undeclared pool is real, and hiding it would hide the member a
    // plan is about to stop.
    assert.deepEqual(group.slots.map((slot) => slot.poolIndex), [2]);
    assert.equal(slotAt(group, 2).declared, false);
  });

  it("keeps a worker id the pool contract cannot address out of the indexed roster", () => {
    const day = dayOf(
      [cardOf({ workerId: "person-lookup-daemon", workflowId: "person-lookup" })],
      [poolRow("person-lookup", 1, 1)],
    );
    const group = groupFor(day, "person-lookup");

    assert.deepEqual(group.unindexedCards.map((card) => String(card.workerId)), ["person-lookup-daemon"]);
    assert.deepEqual(group.slots.map((slot) => slot.membership.state), ["not-served"]);
  });
});

describe("a plan names the exact members it will stop", () => {
  const plannedTwo = (): SessionPoolGroup => groupFor(
    dayOf(
      [
        cardOf({ workerId: "person-lookup-worker-1", workflowId: "person-lookup" }),
        cardOf({ workerId: "person-lookup-worker-2", workflowId: "person-lookup" }),
      ],
      [poolRow("person-lookup", 2, 4)],
    ),
    "person-lookup",
  );

  it("refuses a count outside D271's range without composing anything", () => {
    for (const count of [0, -1, MAX_WORKERS_PER_POOL + 1, 2.5]) {
      const intent = planPoolIntent(plannedTwo(), count);
      assert.equal(intent.kind, "refused");
      if (intent.kind === "refused") assert.match(intent.reason, /1 to 3 workers \(D271\)/u);
    }
  });

  it("refuses a plan that changes nothing", () => {
    const intent = planPoolIntent(plannedTwo(), 2);
    assert.equal(intent.kind, "refused");
    if (intent.kind === "refused") assert.match(intent.reason, /already declares 2 workers at pool version 4/u);
  });

  it("names indices N+1..MAX as the excess set, exactly as the kernel reconciles them", () => {
    const intent = planPoolIntent(plannedTwo(), 1);
    assert.equal(intent.kind, "ready");
    if (intent.kind !== "ready") return;

    assert.equal(intent.scaleDown, true);
    assert.equal(intent.expectedVersion, 4);
    assert.deepEqual(intent.excess.map((member) => member.workerId), [
      "person-lookup-worker-2",
      "person-lookup-worker-3",
    ]);
    // The running flag is a SERVED fact per member, not a guess: index 2 holds
    // a live lease and index 3 holds nothing, and the confirmation says so.
    assert.deepEqual(intent.excess.map((member) => member.running), [true, false]);
  });

  it("calls a first plan over a running CLI worker a scale-down, because it stops one", () => {
    const group = groupFor(
      dayOf([cardOf({ workerId: "separations-worker-2", workflowId: "separations" })], []),
      "separations",
    );
    const intent = planPoolIntent(group, 1);

    assert.equal(intent.kind, "ready");
    if (intent.kind !== "ready") return;
    assert.equal(intent.expectedVersion, 0);
    assert.equal(intent.scaleDown, true);
    assert.deepEqual(
      intent.excess.filter((member) => member.running).map((member) => member.workerId),
      ["separations-worker-2"],
    );
  });

  it("does not call a scale-UP a scale-down when nothing above the count is running", () => {
    const intent = planPoolIntent(
      groupFor(dayOf([cardOf({ workerId: "person-lookup-worker-1", workflowId: "person-lookup" })], [poolRow("person-lookup", 1, 3)]), "person-lookup"),
      3,
    );

    assert.equal(intent.kind, "ready");
    if (intent.kind !== "ready") return;
    assert.equal(intent.scaleDown, false);
    assert.deepEqual(intent.excess, []);
  });
});

describe("the controls post the arms the wire declares", () => {
  it("plans against the POOL version the view was drawn from", () => {
    const group = groupFor(
      dayOf([cardOf({ workerId: "person-lookup-worker-1", workflowId: "person-lookup" })], [poolRow("person-lookup", 1, 7)]),
      "person-lookup",
    );
    const intent = planPoolIntent(group, 2);
    assert.equal(intent.kind, "ready");
    if (intent.kind !== "ready") return;

    const request = CommandRequestSchema.parse(composePlanWorkerCountCommand(
      { workflowId: intent.workflowId, desiredWorkers: intent.desiredWorkers, expectedVersion: intent.expectedVersion },
      ACTOR,
    ));

    assert.equal(request.family, "worker-browser");
    assert.equal(request.type, "plan-worker-count");
    assert.deepEqual(request.target, { workflowId: "person-lookup", expectedVersion: 7 });
    assert.deepEqual(request.type === "plan-worker-count" ? request.payload : undefined, { desiredWorkers: 2 });
    assert.equal(request.source, "session-panel");
    assert.equal(request.requestedBy, "local-operator");
  });

  it("plans a first pool against basis 0 — the honest basis, not a guess", () => {
    const request = CommandRequestSchema.parse(composePlanWorkerCountCommand(
      { workflowId: "separations", desiredWorkers: 1, expectedVersion: 0 },
      ACTOR,
    ));
    assert.deepEqual(request.target, { workflowId: "separations", expectedVersion: 0 });
  });

  it("spawns the EXACT member the operator pressed, against the pool version", () => {
    const request = CommandRequestSchema.parse(composeSpawnWorkerCommand(
      { workflowId: "person-lookup", workerId: poolMemberWorkerId("person-lookup", 2), expectedVersion: 4 },
      ACTOR,
    ));

    assert.equal(request.type, "spawn-worker");
    assert.deepEqual(request.target, { workflowId: "person-lookup", expectedVersion: 4 });
    assert.deepEqual(
      request.type === "spawn-worker" ? request.payload : undefined,
      { workerId: "person-lookup-worker-2" },
    );
  });

  it("stops a worker against its LEASE version, which is a different basis", () => {
    const request = CommandRequestSchema.parse(composeStopWorkerCommand(
      { workerId: "person-lookup-worker-1", leaseVersion: 12 },
      ACTOR,
    ));

    assert.equal(request.type, "stop-worker");
    assert.deepEqual(request.target, { workerId: "person-lookup-worker-1", expectedVersion: 12 });
  });
});

describe("both refusal arms are drawn, verbatim", () => {
  it("draws a CAS conflict with the live pool version and no retry", () => {
    const markup = renderToStaticMarkup(createElement(PoolOutcomeNotice, {
      outcome: {
        basis: 4,
        action: "Plan 2 workers",
        state: {
          kind: "refused",
          settlement: {
            kind: "refused",
            reason: "conflict",
            problem: "composed sentence the panel must not print instead",
            message: "worker pool person-lookup is at version 6, not 4; re-read the pool before planning against it",
            currentVersion: 6,
          },
        },
      },
    }));

    assert.match(markup, /worker pool person-lookup is at version 6, not 4/u);
    assert.match(markup, /pool version 6/u);
    assert.match(markup, /Nothing was recorded/u);
    assert.doesNotMatch(markup, /composed sentence/u);
    assert.doesNotMatch(markup, /retry/iu);
  });

  it("draws a kernel rejection with its own code", () => {
    const markup = renderToStaticMarkup(createElement(PoolOutcomeNotice, {
      outcome: {
        basis: 0,
        action: "Spawn separations-worker-2",
        state: {
          kind: "refused",
          settlement: {
            kind: "refused",
            reason: "rejected",
            problem: "worker separations-worker-2 already holds a live lease in state idle",
            message: "worker separations-worker-2 already holds a live lease in state idle",
            code: "invalid-state",
          },
        },
      },
    }));

    assert.match(markup, /worker separations-worker-2 already holds a live lease in state idle/u);
    assert.match(markup, /code invalid-state/u);
    assert.match(markup, /Spawn separations-worker-2/u);
  });

  it("never claims a thrown post recorded nothing — the envelope was already on the wire", () => {
    const markup = renderToStaticMarkup(createElement(PoolOutcomeNotice, {
      outcome: {
        basis: 4,
        action: "Plan 3 workers",
        state: { kind: "unknown", message: "Failed to fetch" },
      },
    }));

    assert.match(markup, /Result unknown/u);
    assert.match(markup, /Failed to fetch/u);
    assert.match(markup, /may already have been recorded/u);
    // Unit F2d's correction, on this surface: "nothing was recorded" is a
    // negative this side cannot know once the request left, and an operator who
    // believes it re-issues a plan whose processes already started.
    assert.doesNotMatch(markup, /Nothing was recorded/u);
    assert.doesNotMatch(markup, /Nothing was sent/u);
  });
});
