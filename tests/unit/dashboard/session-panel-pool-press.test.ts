// @vitest-environment jsdom
/**
 * D271's pool controls, PRESSED — the half of the Session Panel that no fold
 * can hold.
 *
 * `worker-pool-controls.test.ts` pins the folds these controls are built from:
 * `planPoolIntent` derives the excess set and the CAS basis, and
 * `composePlanWorkerCountCommand` / `composeSpawnWorkerCommand` turn a plan into
 * an envelope. What neither of them can see is the WIRING between the two —
 * which value `shell.tsx` actually hands the composer when a finger lands on
 * the button, and how many times. Both of those have been wrong in this tree
 * before: a stale basis re-read at the composer instead of carried from the
 * view is the bug the CAS exists to catch, and the F2d correction was a control
 * that dispatched on a press nobody meant as confirmation.
 *
 * So this file renders the real `SessionPanel` into a real document and presses
 * the real controls. It is the ONE file in the unit lane that does — the tree's
 * standing rule is that behaviour belongs to the Playwright parity lane
 * (`src/dashboard/CLAUDE.md`), and it still does for anything about PIXELS. A
 * dispatched payload is not a pixel: it is the command this dashboard sends to
 * a supervisor that starts and stops real worker processes, and the assertion
 * that names it belongs beside the folds it is composed from.
 *
 * Two claims, and each was run against a mutation of the line it pins:
 *
 * 1. **The dispatched basis is the SERVED pool row's version**, carried down
 *    from the view the operator was reading. Replacing either handler's
 *    `expectedVersion` source with `0` turns both press tests red.
 * 2. **Nothing is dispatched until the confirmation.** Opening the popover and
 *    choosing a count are not the act; only the button that names the act is.
 */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../src/domain/dashboard/projection.js";
import { parseWorkflows, type WorkerCardWire } from "../../../src/dashboard/surfaces/shell-model.js";
import { SessionPanel } from "../../../src/dashboard/surfaces/shell.js";
import { FIXTURE_BOOTSTRAP, FIXTURE_DAY_WIRE, FIXTURE_NOW } from "../../parity/helpers/fixture-day.js";

/**
 * The two browser APIs `@radix-ui/react-popover`'s positioner asks for that
 * jsdom does not implement. They are STUBS for measurement only — nothing in
 * this file asserts a position, and anything that did would be asserting
 * against these stubs rather than against a layout engine, which is exactly
 * what the parity lane exists for.
 */
class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

class ZeroDOMRect {
  readonly x = 0;
  readonly y = 0;
  readonly width = 0;
  readonly height = 0;
  readonly top = 0;
  readonly left = 0;
  readonly right = 0;
  readonly bottom = 0;
  static fromRect(): ZeroDOMRect {
    return new ZeroDOMRect();
  }
  toJSON(): Readonly<Record<string, number>> {
    return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
}

Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "DOMRect", ZeroDOMRect);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** The pool version every assertion in this file is about. */
const SERVED_POOL_VERSION = 7;
const WORKFLOW_ID = "person-lookup";

/** Every card is what the STRICT day schema produced, never a hand-built object. */
function cardAt(poolIndex: number): WorkerCardWire {
  const live = FIXTURE_DAY_WIRE.workerCards.find((card) => card.state !== "stopped" && card.state !== "failed");
  if (live === undefined) throw new Error("the wire fixture needs one non-terminal worker card");
  const parsed = DashboardDayWireSchema.parse({
    ...FIXTURE_DAY_WIRE,
    workerCards: [{ ...live, workerId: `${WORKFLOW_ID}-worker-${String(poolIndex)}`, workflowId: WORKFLOW_ID }],
    workerPools: [],
  }).workerCards[0];
  if (parsed === undefined) throw new Error("the parsed day wire dropped its only worker card");
  return parsed;
}

/**
 * A pool DECLARED at three with leases served for members 1 and 2 — so the
 * roster holds one running member above a plan of one (the scale-down the
 * confirmation is about) and one unmet index (the spawn).
 */
function servedDay(): DashboardDayWire {
  return DashboardDayWireSchema.parse({
    ...FIXTURE_DAY_WIRE,
    workerCards: [cardAt(1), cardAt(2)],
    workerPools: [{
      workflowId: WORKFLOW_ID,
      desiredWorkers: 3,
      version: SERVED_POOL_VERSION,
      plannedBy: "local-operator",
      plannedAt: "2026-08-03T09:00:00.000-07:00",
    }],
  });
}

type PlanDispatch = Readonly<{ workflowId: string; desiredWorkers: number; expectedVersion: number }>;
type SpawnDispatch = Readonly<{ workflowId: string; workerId: string; expectedVersion: number }>;

interface MountedPanel {
  readonly plans: PlanDispatch[];
  readonly spawns: SpawnDispatch[];
  /** Every rendered button, portalled popover content included. */
  buttons: () => HTMLButtonElement[];
  press: (name: string) => Promise<void>;
}

let mounted: Root | undefined;

/**
 * The press is only half the act: the handler under it RESOLVES a promise, and
 * the panel records the settlement in state a microtask later. Flushing it here
 * is not cosmetic — an unflushed settlement is a React `act` warning today and
 * a state update landing inside the NEXT test tomorrow.
 */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
});

async function mountPanel(): Promise<MountedPanel> {
  const day = servedDay();
  const plans: PlanDispatch[] = [];
  const spawns: SpawnDispatch[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;

  await act(async () => {
    root.render(createElement(SessionPanel, {
      workerCards: day.workerCards,
      queueSurfaces: day.queueSurfaces,
      workerPools: day.workerPools,
      workflows: parseWorkflows(FIXTURE_BOOTSTRAP.workflows),
      counts: day.workflowCounts,
      nowIso: FIXTURE_NOW,
      connection: { state: "live" },
      appVersion: "0.1.0",
      onPlanWorkerCount: async (plan) => {
        plans.push(plan);
        return { kind: "applied", requestId: "plan-1", replayed: false };
      },
      onSpawnWorker: async (member) => {
        spawns.push(member);
        return { kind: "applied", requestId: "spawn-1", replayed: false };
      },
    }));
  });

  const buttons = (): HTMLButtonElement[] => [...document.body.querySelectorAll("button")];
  const press = async (name: string): Promise<void> => {
    const target = buttons().filter((button) => (button.textContent ?? "").trim() === name);
    if (target.length !== 1) {
      throw new Error(
        `expected exactly one control named "${name}", found ${String(target.length)} among `
        + `[${buttons().map((button) => JSON.stringify((button.textContent ?? "").trim())).join(", ")}]`,
      );
    }
    const only = target[0];
    if (only === undefined) throw new Error(`control "${name}" vanished between find and press`);
    await act(async () => {
      only.click();
    });
    await settle();
  };

  // The pool bands live in the drawer, which is closed until the operator opens
  // it — every press below happens on the surface an operator is looking at.
  const bar = buttons().find((button) => (button.textContent ?? "").startsWith("Sessions"));
  if (bar === undefined) throw new Error("the Session Panel rendered no bar toggle");
  await act(async () => {
    bar.click();
  });

  return { plans, spawns, buttons, press };
}

describe("a pool command carries the CAS basis the operator was reading", () => {
  it("spawns against the SERVED pool version, not a re-read one", async () => {
    const panel = await mountPanel();

    await panel.press("Spawn worker 3");

    assert.deepEqual(panel.spawns, [{
      workflowId: WORKFLOW_ID,
      workerId: "person-lookup-worker-3",
      expectedVersion: SERVED_POOL_VERSION,
    }]);
    assert.deepEqual(panel.plans, []);
  });

  it("plans against the SERVED pool version, and sends the count that was confirmed", async () => {
    const panel = await mountPanel();

    await panel.press("Plan workers");
    await panel.press("1");
    await panel.press("Stop 1 member and plan 1 worker");

    assert.deepEqual(panel.plans, [{
      workflowId: WORKFLOW_ID,
      desiredWorkers: 1,
      expectedVersion: SERVED_POOL_VERSION,
    }]);
    assert.deepEqual(panel.spawns, []);
  });
});

describe("the worker id is reachable without a mouse", () => {
  it("prints the served id behind the unmet member's identity control", async () => {
    const panel = await mountPanel();

    const route = panel.buttons().find(
      (button) => button.getAttribute("aria-label") === "Show full worker identity for member 3",
    );
    assert.ok(route, "the unmet member card offers no named route to its worker id");
    // It was `title="Worker person-lookup-worker-3"` and nothing else: readable
    // by hovering a mouse, unreachable by a keyboard and by a finger.
    assert.doesNotMatch(document.body.textContent ?? "", /person-lookup-worker-3/u);

    await act(async () => {
      route.click();
    });

    const dialog = document.body.querySelector("[role='dialog']");
    assert.ok(dialog, "the identity control opened no popover");
    assert.match(dialog.textContent ?? "", /person-lookup-worker-3/u);
  });
});

describe("nothing is dispatched until the confirmation is pressed", () => {
  it("sends nothing for opening the popover or choosing a count", async () => {
    const panel = await mountPanel();

    await panel.press("Plan workers");
    assert.deepEqual(panel.plans, [], "opening the popover posted a command");

    await panel.press("1");
    assert.deepEqual(panel.plans, [], "choosing a count posted a command");

    // The choice is only NAMED at this point, and the sentence beside it names
    // the member the confirmation would stop.
    const confirm = panel.buttons().find((button) => (button.textContent ?? "").startsWith("Stop 1 member"));
    assert.ok(confirm, "the popover drew no confirmation for a scale-down");
    assert.match(document.body.textContent ?? "", /person-lookup-worker-2/u);

    await act(async () => {
      confirm.click();
    });
    await settle();

    assert.deepEqual(panel.plans, [{
      workflowId: WORKFLOW_ID,
      desiredWorkers: 1,
      expectedVersion: SERVED_POOL_VERSION,
    }]);
  });

  it("re-choosing a count before confirming sends only the LAST choice, once", async () => {
    const panel = await mountPanel();

    await panel.press("Plan workers");
    await panel.press("1");
    await panel.press("2");
    assert.deepEqual(panel.plans, []);

    await panel.press("Plan 2 workers");

    assert.deepEqual(panel.plans, [{
      workflowId: WORKFLOW_ID,
      desiredWorkers: 2,
      expectedVersion: SERVED_POOL_VERSION,
    }]);
  });
});
