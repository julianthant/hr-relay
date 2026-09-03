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
 * 2. **Nothing is dispatched until the confirmation.** Opening the dialog and
 *    stepping the count are not the act; only the button that names the act is.
 *
 * Since D305 the controls live behind the bar's `+` (the demo's Add workers
 * dialog) rather than in per-workflow bands of the drawer, so every press below
 * starts by opening that dialog — the surface an operator is looking at.
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
    workerCards: [{
      ...live,
      workerId: `${WORKFLOW_ID}-worker-${String(poolIndex)}`,
      workflowId: WORKFLOW_ID,
      browserRequirements: { state: "present", systems: ["ucpath", "crm", "kuali"] },
    }],
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
  /** Every rendered button, portalled dialog and popover content included. */
  buttons: () => HTMLButtonElement[];
  /** Press the ONE button whose visible text is `name`. */
  press: (name: string) => Promise<void>;
  /** Press the ONE button whose accessible name (`aria-label`) is `label`. */
  pressLabel: (label: string) => Promise<void>;
  /** The Add workers dialog's content, or throws when it is not open. */
  dialog: () => Element;
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
  const pressOnly = async (found: HTMLButtonElement[], described: string): Promise<void> => {
    if (found.length !== 1) {
      throw new Error(
        `expected exactly one control ${described}, found ${String(found.length)} among `
        + `[${buttons().map((button) => JSON.stringify(button.getAttribute("aria-label") ?? (button.textContent ?? "").trim())).join(", ")}]`,
      );
    }
    const only = found[0];
    if (only === undefined) throw new Error(`control ${described} vanished between find and press`);
    await act(async () => {
      only.click();
    });
    await settle();
  };
  const press = async (name: string): Promise<void> => pressOnly(
    buttons().filter((button) => (button.textContent ?? "").trim() === name),
    `named "${name}"`,
  );
  const pressLabel = async (label: string): Promise<void> => pressOnly(
    buttons().filter((button) => button.getAttribute("aria-label") === label),
    `labelled "${label}"`,
  );
  const dialog = (): Element => {
    const found = document.body.querySelector("[role='dialog']");
    if (found === null) throw new Error("the Add workers dialog is not open");
    return found;
  };

  // The pool controls live behind the bar's `+` (D305) — every press below
  // happens on the surface an operator is looking at.
  await pressLabel("Add workers");

  return { plans, spawns, buttons, press, pressLabel, dialog };
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

    // The dialog opens at a count of one (the demo's own reset), which is a
    // scale-down of the served three: member 2 is running and would be stopped.
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
  it("prints the unmet member's served id in the dialog's roster, and the card's behind its identity control", async () => {
    const panel = await mountPanel();

    // The roster row IS the confirmation for its spawn, so the id is its text.
    assert.match(panel.dialog().textContent ?? "", /person-lookup-worker-3/u);

    // The strip's card is titled by WORKFLOW (the demo's rule), so its id is
    // behind the identity control — a named route, never `title` alone.
    await panel.press("Close");
    const bar = panel.buttons().find((button) => (button.textContent ?? "").startsWith("Sessions"));
    assert.ok(bar, "the Session Panel rendered no bar toggle");
    await act(async () => {
      bar.click();
    });
    const route = panel.buttons().find(
      (button) => button.getAttribute("aria-label") === "Show full worker identity and run IDs for Person Lookup",
    );
    assert.ok(route, "the worker card offers no named route to its worker id");
    assert.doesNotMatch(document.body.textContent ?? "", /person-lookup-worker-1/u);

    await act(async () => {
      route.click();
    });

    const popover = document.body.querySelector("[role='dialog']");
    assert.ok(popover, "the identity control opened no popover");
    assert.match(popover.textContent ?? "", /person-lookup-worker-1/u);
  });
});

describe("browser requirements are visible before acquisition", () => {
  it("shows every required system without reporting an unopened browser as open", async () => {
    const panel = await mountPanel();

    await panel.press("Close");
    const bar = panel.buttons().find((button) => (button.textContent ?? "").startsWith("Sessions"));
    assert.ok(bar, "the Session Panel rendered no bar toggle");
    await act(async () => {
      bar.click();
    });

    const card = document.body.querySelector("article[title='Worker person-lookup-worker-1']");
    assert.ok(card, "the Session Panel rendered no card for worker 1");
    assert.match(card.textContent ?? "", /KUALI/u, "the unopened required Kuali browser is missing");
    assert.match(card.textContent ?? "", /Opens when needed/u);
    assert.doesNotMatch(card.textContent ?? "", /KUALI browser session/u);
  });
});

describe("nothing is dispatched until the confirmation is pressed", () => {
  it("sends nothing for opening the dialog or stepping the count", async () => {
    const panel = await mountPanel();
    assert.deepEqual(panel.plans, [], "opening the dialog posted a command");

    await panel.pressLabel("One more worker");
    assert.deepEqual(panel.plans, [], "stepping the count posted a command");

    // The choice is only NAMED at this point: a plan of two covers index 3,
    // which holds no running lease, so the sentence names it and stops nothing.
    const confirm = panel.buttons().find((button) => (button.textContent ?? "").trim() === "Plan 2 workers");
    assert.ok(confirm, "the dialog drew no confirmation for a plan of two");
    assert.match(panel.dialog().textContent ?? "", /person-lookup-worker-3/u);
    assert.doesNotMatch(panel.dialog().textContent ?? "", /Stop 1 member/u);

    await act(async () => {
      confirm.click();
    });
    await settle();

    assert.deepEqual(panel.plans, [{
      workflowId: WORKFLOW_ID,
      desiredWorkers: 2,
      expectedVersion: SERVED_POOL_VERSION,
    }]);
  });

  it("re-stepping the count before confirming sends only the LAST count, once", async () => {
    const panel = await mountPanel();

    await panel.pressLabel("One more worker");
    await panel.pressLabel("One more worker");
    // Three is what the pool already declares: the verb stays on screen,
    // disabled, and the reason is stated rather than a control vanishing.
    const same = panel.buttons().find((button) => (button.textContent ?? "").trim() === "Plan 3 workers");
    assert.ok(same, "the dialog drew no verb for the declared count");
    assert.equal(same.disabled, true);
    assert.match(panel.dialog().textContent ?? "", /already declares 3 workers at pool version 7/u);
    assert.deepEqual(panel.plans, []);

    await panel.pressLabel("One fewer worker");
    await panel.press("Plan 2 workers");

    assert.deepEqual(panel.plans, [{
      workflowId: WORKFLOW_ID,
      desiredWorkers: 2,
      expectedVersion: SERVED_POOL_VERSION,
    }]);
  });
});
