// @vitest-environment jsdom
/**
 * THE APPLIED BUMP, PRESSED — the round trip VB43/VB44's banner has to survive
 * (unit F10e; the defect F10d found and reported rather than fixed).
 *
 * `archive-bump-applied.test.ts` pins the banner's COPY and
 * `archive-open-door-query.test.ts` pins the door's wiring by reading the JSX.
 * Neither can see the one thing that decides whether an operator ever meets
 * either of them: applying a bump makes `ArchiveWorkspace` re-read the index,
 * and the re-read used to set the `index` resource back to `"loading"` — which
 * unmounted `VersionsView`, and with it the local `applied` state captured at
 * dispatch, BEFORE the banner could render. Every fold and every render test in
 * the family stayed green while the banner and its door were unreachable by a
 * click.
 *
 * So this file mounts the real `ArchiveWorkspace` against a stub client and
 * presses the real controls. It is the third file in the unit lane to do so
 * (`session-panel-pool-press.test.ts`, then `run-start-dialog.test.ts`), for
 * their reason unchanged: the standing rule that behaviour belongs to the
 * Playwright parity lane still holds for anything about PIXELS, and "is the
 * banner still mounted after the re-read it triggered" is not a pixel.
 *
 * Each case was run against a mutation of the line it pins; the mutation is
 * named in the case.
 */
import assert from "node:assert/strict";
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { ArchiveWorkspace } from "../../../src/dashboard/surfaces/archive.js";
import { ARCHIVE_INDEX, type ArchiveView } from "../../../src/dashboard/surfaces/archive-model.js";
import { ArchiveIndexWireSchema, type ArchiveIndexWire } from "../../../src/domain/dashboard/archive.js";
import { CommandResultSchema, type CommandResult } from "../../../src/domain/commands.js";
import { FIXTURE_ARCHIVE_INDEX } from "../../parity/helpers/fixture-archive.js";

/**
 * The two browser APIs the archive's measured viewport and Radix's popovers ask
 * for that jsdom does not implement. They are STUBS for measurement only —
 * nothing here asserts a position, and an unmeasured viewport renders every row
 * rather than none (the rule `windowArchiveTable` already settled).
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

const ACTOR_ID = "local-operator";
const PLAN_ID = "aa11bb22-0004-4000-8000-aa11bb220004";
const NEW_SWEEP_ID = "aa11bb22-0011-4000-8000-aa11bb220011";
const CANDIDATE_ONE = "aa11bb22-0012-4000-8000-aa11bb220012";
const CANDIDATE_TWO = "aa11bb22-0013-4000-8000-aa11bb220013";
/** the search text the door has to clear — it matches no run in the corpus */
const HIDING_QUERY = "zzz-matches-nothing";

const BASE_PLAN = FIXTURE_ARCHIVE_INDEX.plans[0];
const BASE_ENTRY = FIXTURE_ARCHIVE_INDEX.entries[0];
const BASE_SWEEP = FIXTURE_ARCHIVE_INDEX.sweeps[0];
const BASE_STATE = FIXTURE_ARCHIVE_INDEX.versionState[0];
if (BASE_PLAN === undefined || BASE_ENTRY === undefined || BASE_SWEEP === undefined || BASE_STATE === undefined) {
  throw new Error("the archive fixture no longer carries a plan, an entry, a sweep and a version state");
}

function candidate(runId: string, title: string): unknown {
  return {
    runId,
    traceId: `pl-0904${runId.slice(-2)}-aa11`,
    workflowId: "person-lookup",
    title,
    enqueuedAt: BASE_PLAN.plannedAt,
    drift: ["descriptor-version"],
  };
}

/**
 * The index BEFORE the apply: nothing archived yet, and one open MAJOR plan
 * that would archive two named runs and is blocked by nothing.
 *
 * Parsed through the production wire schema like the corpus it is derived from,
 * so a fixture cannot outlive its contract — D274's refinement would refuse a
 * minor plan carrying these candidates outright.
 */
const INDEX_WITH_PLAN: ArchiveIndexWire = ArchiveIndexWireSchema.parse({
  ...FIXTURE_ARCHIVE_INDEX,
  entries: [],
  sweeps: [],
  versionState: [{ ...BASE_STATE, archivable: 2, blockers: [] }],
  plans: [{
    ...BASE_PLAN,
    versionPlanId: PLAN_ID,
    candidates: [candidate(CANDIDATE_ONE, "EID 10111213"), candidate(CANDIDATE_TWO, "EID 10111214")],
    blockers: [],
  }],
});

/** The index the re-read serves AFTER the apply: the plan is gone, the sweep is minted. */
const INDEX_AFTER_APPLY: ArchiveIndexWire = ArchiveIndexWireSchema.parse({
  ...FIXTURE_ARCHIVE_INDEX,
  entries: [CANDIDATE_ONE, CANDIDATE_TWO].map((runId, offset) => ({
    ...BASE_ENTRY,
    runId,
    traceId: `pl-09040${String(offset)}-aa11`,
    title: `EID 1011121${String(offset + 3)}`,
    applicationId: NEW_SWEEP_ID,
  })),
  sweeps: [{ ...BASE_SWEEP, applicationId: NEW_SWEEP_ID, versionPlanId: PLAN_ID, archivedCount: 2 }],
  versionState: [{ ...BASE_STATE, archivable: 0, blockers: [] }],
  plans: [],
});

const APPLIED: CommandResult = CommandResultSchema.parse({
  state: "applied",
  commandId: "aa11bb22-0009-4000-8000-aa11bb220009",
  affectedTargets: [{ family: "version-archive", versionPlanId: PLAN_ID }],
});

/**
 * A client that serves exactly what this file wires and THROWS for anything
 * else. A blanket no-op stub would let the surface reach for a query nobody
 * meant it to have and answer `undefined` — the silent substitution this repo
 * bans, wearing a test's clothes. (The shape `run-start-dialog.test.ts` uses.)
 */
function stubClient(served: Partial<DashboardClient>): DashboardClient {
  const handler: ProxyHandler<Partial<DashboardClient>> = {
    get(target, property): unknown {
      const impl: unknown = Reflect.get(target, property);
      if (impl === undefined) {
        throw new Error(`the Archive reached for client.${String(property)}, which this case does not serve`);
      }
      return impl;
    },
  };
  return new Proxy(served, handler) as DashboardClient;
}

let mounted: Root | undefined;

/**
 * A press resolves a promise; the surface records the settlement, bumps its
 * re-read nonce, and the effect that follows issues ANOTHER promise. Three
 * flushes carry the whole round trip — an unflushed settlement is a React `act`
 * warning today and a state update landing inside the next case tomorrow.
 */
async function settle(): Promise<void> {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => { root.unmount(); });
  }
  document.body.replaceChildren();
});

function buttons(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")];
}

/** The archive's own search box, by the accessible name the toolbar gives it. */
function searchBox(): HTMLInputElement {
  const box = document.body.querySelector<HTMLInputElement>(
    "input[aria-label='Search archived runs by title, trace id or workflow']",
  );
  if (box === null) throw new Error("the archived-runs toolbar drew no search box");
  return box;
}

/**
 * Set a control's value the way a keystroke does. React keeps its own value
 * tracker on the node, so assigning `.value` leaves the tracker agreeing with
 * the new text and React discards the event that follows as "nothing changed";
 * the PROTOTYPE's setter is the one that moves the tracker.
 */
function typeInto(node: HTMLInputElement, next: string): void {
  const descriptor: { set?: (this: unknown, value: string) => void } | undefined =
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  const setter = descriptor?.set;
  if (setter === undefined) throw new Error("this environment has no native value setter for <input>");
  setter.call(node, next);
  node.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * The route around the workspace, exactly as `dashboard-app.tsx` owns it: the
 * VIEW is a prop the parent holds, so the door's `onView("runs")` has somewhere
 * real to land.
 */
function ArchiveRoute({ client }: { client: DashboardClient }): ReactElement {
  const [view, setView] = useState<ArchiveView>("runs");
  const [selection, setSelection] = useState<string>(ARCHIVE_INDEX);
  return createElement(DashboardClientProvider, {
    client,
    children: createElement(ArchiveWorkspace, {
      selection,
      view,
      actorId: ACTOR_ID,
      onSelection: setSelection,
      onView: setView,
      onClose: () => undefined,
    }),
  });
}

interface MountedArchive {
  /** every index read this case served, in order */
  readonly reads: () => number;
  /** every envelope the surface posted */
  readonly commands: readonly unknown[];
  readonly press: (name: string) => Promise<void>;
  readonly text: () => string;
  /** hold the NEXT index read open, so the in-flight window can be asserted */
  readonly holdNextRead: () => void;
  readonly releaseHeldRead: () => Promise<void>;
}

async function mountArchive(served: readonly ArchiveIndexWire[]): Promise<MountedArchive> {
  const queue = [...served];
  const commands: unknown[] = [];
  let reads = 0;
  let hold = false;
  let release: (() => void) | undefined;

  const nextIndex = (): ArchiveIndexWire => {
    const next = queue.shift();
    if (next === undefined) {
      throw new Error(`the Archive read its index ${String(reads + 1)} times; this case serves ${String(served.length)}`);
    }
    reads += 1;
    return next;
  };

  const client = stubClient({
    archiveIndex: async (): Promise<ArchiveIndexWire> => {
      if (!hold) return nextIndex();
      hold = false;
      await new Promise<void>((resolve) => { release = resolve; });
      return nextIndex();
    },
    executeCommand: async (request: unknown): Promise<CommandResult> => {
      commands.push(request);
      return APPLIED;
    },
  });

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(createElement(ArchiveRoute, { client }));
  });
  await settle();

  const press = async (name: string): Promise<void> => {
    const matches = buttons().filter((button) => (button.textContent ?? "").trim() === name);
    const only = matches[0];
    if (matches.length !== 1 || only === undefined) {
      throw new Error(
        `expected exactly one control named "${name}", found ${String(matches.length)} among `
        + `[${buttons().map((button) => JSON.stringify((button.textContent ?? "").trim())).join(", ")}]`,
      );
    }
    await act(async () => { only.click(); });
    await settle();
  };

  return {
    reads: () => reads,
    commands,
    press,
    text: () => document.body.textContent ?? "",
    holdNextRead: () => { hold = true; },
    releaseHeldRead: async () => {
      const resume = release;
      release = undefined;
      if (resume === undefined) throw new Error("no index read is being held open");
      await act(async () => { resume(); });
      await settle();
    },
  };
}

describe("the applied-bump banner survives the index re-read its own success triggers", () => {
  it("still names the sweep and offers the door once the re-read has landed", async () => {
    // The mutation this pins: restoring `setIndex(LOADING)` in the workspace's
    // index effect. `VersionsView` unmounts, its dispatch-captured `applied`
    // goes with it, and neither assertion below can be satisfied again.
    const archive = await mountArchive([INDEX_WITH_PLAN, INDEX_AFTER_APPLY]);
    await archive.press("Versions & bumps");

    await archive.press("Apply the bump");

    assert.equal(archive.commands.length, 1);
    assert.equal(archive.reads(), 2, "an applied bump re-reads the index it changed");
    assert.match(archive.text(), /The bump was applied/u);
    assert.match(archive.text(), /2 runs left the live surfaces/u);
    assert.equal(
      buttons().some((button) => (button.textContent ?? "").trim() === "Open the archive"),
      true,
      "the banner offers no door onto the runs the sweep it names just archived",
    );
  });

  it("opens the ledger through the door with the standing filter cleared", async () => {
    const archive = await mountArchive([INDEX_WITH_PLAN, INDEX_AFTER_APPLY]);
    // A filter left standing from an earlier visit, which hides every run the
    // sweep is about to mint (unit F10d finding 2).
    await act(async () => { typeInto(searchBox(), HIDING_QUERY); });
    assert.equal(searchBox().value, HIDING_QUERY);

    await archive.press("Versions & bumps");
    await archive.press("Apply the bump");
    await archive.press("Open the archive");

    assert.equal(searchBox().value, "", "the door opened onto the ledger with the old query still standing");
    assert.match(archive.text(), /2 of 2/u, "the ledger the door opened hides the runs the door named");
  });

  it("does not offer the same plan for a second apply while the stale index still lists it", async () => {
    // The stale index is the price of keeping the banner mounted: for as long
    // as the re-read is in flight, the wire on screen still carries the plan
    // that was just applied. An `Apply the bump` standing under `The bump was
    // applied` is a control contradicting the sentence above it, so the plan
    // the dispatch record names stands down.
    const archive = await mountArchive([INDEX_WITH_PLAN, INDEX_AFTER_APPLY]);
    await archive.press("Versions & bumps");
    archive.holdNextRead();

    await archive.press("Apply the bump");

    assert.equal(archive.reads(), 1, "the re-read settled before the in-flight window could be read");
    assert.match(archive.text(), /The bump was applied/u);
    assert.equal(
      buttons().some((button) => (button.textContent ?? "").trim() === "Apply the bump"),
      false,
      "the applied plan is still offered for a second apply while its re-read is in flight",
    );

    await archive.releaseHeldRead();
    assert.equal(archive.reads(), 2);
    assert.match(archive.text(), /The bump was applied/u);
    assert.equal(archive.commands.length, 1);
  });

  it("clears the banner when the operator leaves the view it belongs to", async () => {
    // The banner is about an act the operator just performed HERE. Carrying it
    // across a view change would put a settled success over a ledger that has
    // its own account of the same sweep.
    const archive = await mountArchive([INDEX_WITH_PLAN, INDEX_AFTER_APPLY]);
    await archive.press("Versions & bumps");
    await archive.press("Apply the bump");
    assert.match(archive.text(), /The bump was applied/u);

    await archive.press("Archived runs");
    await archive.press("Versions & bumps");

    assert.doesNotMatch(archive.text(), /The bump was applied/u);
    // Only the APPLY re-read the index. A view toggle is not a command, so a
    // third read here would be this surface re-fetching on navigation.
    assert.equal(archive.reads(), 2, "toggling the view issued an index read of its own");
  });
});
