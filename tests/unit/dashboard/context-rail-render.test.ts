// @vitest-environment jsdom
/**
 * THE CONTEXT RAIL'S DRAWN FACTS — D273 items 5 and 6, rendered rather than described.
 *
 * Five of ledger 2's region-C rows
 * (`docs/plans/2026-08-21-03a-fidelity-2-run-detail.md`) are claims about what
 * reaches the SCREEN, and none of them has a fold that could hold it:
 *
 *   C51 — the step group lost the `Well`, the recessed band and the row
 *         dividers R6 f.1 named beside the levels, so the hierarchy the
 *         operator asked to see was carried by a caps label alone;
 *   C55 — a refusal was one uncoded red `<span>`: no code to quote, no
 *         statement of what was not done;
 *   C57 — and nothing at all said the operator's drafts survived it;
 *   C70 — the blocked reason was on the primary's `title` AND under the dock;
 *   C32 — the direction rail's `sr-only` word was `written`, not `write`.
 *
 * The pieces are JSX inside a `.tsx`, so they are pinned by rendering the real
 * components to static markup — the lane `run-start-kit-render.test.ts` opened
 * for exactly this shape of claim. Two mechanics come with it. The tooltip
 * cases strip every `title=` attribute FIRST, because the assertion IS that the
 * reason is there when the pointer is not (D272 items 8–9's lesson). And the
 * copy fold is asserted with a NEGATIVE control — the two refusal arms must
 * never read the same — because if the arm stopped arriving both strings would
 * still be grammatical English and nothing else in the suite could fail
 * (`refused-notice-model.ts`'s own rule, one surface on).
 *
 * UNIT F7b adds two claims `renderToStaticMarkup` cannot make, so the file
 * takes `// @vitest-environment jsdom` for that half — exactly the shape
 * `run-detail-timeline-render.test.ts` and `session-panel-pool-press.test.ts`
 * already use, and nothing above this line changes behaviour under it:
 *
 *   1. Dismissing the refusal unmounts `CheckpointRefusal` — Dismiss button
 *      included — so a keyboard operator's focus has to be MOVED before the
 *      clear, not merely left to whatever DOM node is still there afterwards.
 *   2. The rejected arm's toast used to share `role="alert"` with the
 *      standing `Refusal` banner, so a screen reader announced the same
 *      refusal twice. A fold can see the copy; only a real toast mounted
 *      beside a real banner can see the DUPLICATE announcement.
 */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it } from "vitest";
import {
  CheckpointRefusal,
  ContextRail,
  type ContextSections,
  type RefusedSettlement,
} from "../../../src/dashboard/surfaces/context-rail.js";
import { checkpointRefusalCopy } from "../../../src/dashboard/surfaces/context-rail-model.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { ToastProvider } from "../../../src/dashboard/ds/ui.js";
import { CommandResultSchema, type CommandResult } from "../../../src/domain/commands.js";
import {
  ContextSummaryWireSchema,
  RunDetailSectionResponseSchema,
} from "../../../src/domain/dashboard/run-detail.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** what a sighted operator can read with no pointer: the markup minus its tooltips */
function withoutTooltips(markup: string): string {
  return markup.replace(/title="[^"]*"/gu, "");
}

/** the markup's text content, tags gone and React's entity escapes undone */
function textOf(markup: string): string {
  return markup
    .replace(/<[^>]*>/gu, " ")
    .replace(/&#x27;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&amp;/gu, "&")
    .replace(/&#x2F;/gu, "/")
    .replace(/\s+/gu, " ")
    .trim();
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

const RUN_ID = "11111111-1111-4111-8111-111111111111";

/**
 * A client that answers NOTHING and throws by name if the rail reaches for it.
 *
 * Every case here is a resting render — no press, no dispatch — so a reach for
 * the client is a defect this file wants to hear about rather than absorb.
 */
function refusingClient(): DashboardClient {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, property): unknown {
      throw new Error(
        `the Context rail reached for client.${String(property)} on a resting render`,
      );
    },
  };
  return new Proxy({}, handler) as unknown as DashboardClient;
}

const SUMMARY = ContextSummaryWireSchema.parse({ dataFacts: 3, evidenceFacts: 0, attempts: 1 });

/**
 * Three entries over TWO attributed steps and one the build cannot attribute —
 * the exact shape C51 and C54 are about, parsed through the real wire schema so
 * the fixture cannot outlive its contract.
 */
function dataSections(): ContextSections {
  const response = RunDetailSectionResponseSchema.parse({
    section: "context-data",
    payload: {
      runId: RUN_ID,
      editing: { state: "editable", expectedVersion: 4 },
      entries: [
        {
          label: "Employee id",
          valueRedacted: "10••••23",
          edit: {
            state: "editable",
            nodeId: "find-person",
            fieldPath: "employeeId",
            value: "10000023",
            pendingCorrection: { state: "none" },
          },
          origin: { nodeId: "find-person", step: "Find person", dir: "read", system: "ucpath" },
        },
        {
          label: "Department",
          valueRedacted: "Neurosciences",
          edit: { state: "locked", reason: "Recorded by the run." },
          origin: { nodeId: "find-person", step: "Find person", dir: "read", system: "ucpath" },
        },
        {
          label: "Separation date",
          valueRedacted: "2026-09-30",
          edit: { state: "locked", reason: "Recorded by the run." },
          origin: { nodeId: "submit-separation", step: "Submit separation", dir: "write" },
        },
        {
          label: "Legacy key",
          valueRedacted: "sep-4471",
          edit: { state: "locked", reason: "Recorded under an earlier descriptor." },
        },
      ],
    },
  });
  // The parse answers the whole section union; a fixture that drifted onto
  // another arm would otherwise render an empty rail and pass every assertion
  // below by drawing nothing.
  if (response.section !== "context-data") {
    throw new Error(`the fixture parsed as ${response.section}, not context-data`);
  }
  return { "context-data": response.payload };
}

function renderRail(sections: ContextSections, dataExpanded = false): string {
  return renderToStaticMarkup(
    createElement(
      DashboardClientProvider,
      {
        client: refusingClient(),
        children: createElement(ToastProvider, {
          children: createElement(ContextRail, {
            summary: SUMMARY,
            sections,
            onClose: () => undefined,
            actorId: "operator-1",
            liveStatus: "queued",
            dataExpanded,
            onDataExpandedChange: () => undefined,
            onSaved: () => undefined,
          }),
        }),
      },
    ),
  );
}

const CONFLICT: RefusedSettlement = {
  kind: "refused",
  reason: "conflict",
  problem: "The checkpoint moved while this data was open. The server is now at version 9 — "
    + "reopen the run to see what changed before re-applying.",
  message: "The checkpoint moved while this data was open",
  currentVersion: 9,
};

const REJECTED: RefusedSettlement = {
  kind: "refused",
  reason: "rejected",
  problem: "This run's checkpoint is not correctable while a write is fenced.",
  message: "This run's checkpoint is not correctable while a write is fenced.",
  code: "policy-refused",
};

function renderRefusal(settlement: RefusedSettlement, heldEdits: number): string {
  return renderToStaticMarkup(
    createElement(CheckpointRefusal, {
      refusal: { settlement, heldEdits },
      onDismiss: () => undefined,
    }),
  );
}

describe("the refused-save copy (C55 / C57, D273 item 6)", () => {
  it("counts the held drafts and agrees with its own verb", () => {
    assert.equal(checkpointRefusalCopy("rejected", 1).held, "your 1 edit is still here");
    assert.equal(checkpointRefusalCopy("rejected", 3).held, "your 3 edits are still here");
    assert.equal(checkpointRefusalCopy("conflict", 1).heldSentence, "Your 1 edit is still here.");
    assert.equal(checkpointRefusalCopy("conflict", 2).heldSentence, "Your 2 edits are still here.");
  });

  it("never reads the same for the two arms — the parameter has to arrive", () => {
    // THE NEGATIVE CONTROL. If `reason` stopped reaching the fold, both titles
    // would still be grammatical English and every other assertion here would
    // stay green; this is the one that would not.
    const conflict = checkpointRefusalCopy("conflict", 2);
    const rejected = checkpointRefusalCopy("rejected", 2);
    assert.equal(conflict.title === rejected.title, false);
    assert.match(conflict.title, /checkpoint moved/u);
    assert.match(rejected.title, /refused/u);
  });

  it("refuses to compose a reassurance about no edits at all", () => {
    // `save()` returns before dispatching when nothing is dirty, so zero here
    // means a caller lost the count — and "your 0 edits are still here" would
    // reassure the operator about work that does not exist.
    assert.throws(() => checkpointRefusalCopy("rejected", 0), /at least one edit/u);
    assert.throws(() => checkpointRefusalCopy("conflict", 1.5), /at least one edit/u);
  });
});

describe("a refused save is drawn with its code (C55 / C57, D273 item 6)", () => {
  it("prints the SERVED code, the outcome and the held drafts on the coded arm", () => {
    const markup = renderRefusal(REJECTED, 3);
    const text = textOf(withoutTooltips(markup));
    assert.match(text, /code policy-refused/u);
    assert.match(text, /your 3 edits are still here/u);
    assert.match(text, /nothing was written to the checkpoint/u);
    // the server's own sentence, rendered as its own node and never rewritten
    assert.match(text, /not correctable while a write is fenced/u);
    assert.match(text, /Dismiss/u);
  });

  it("says there is nothing to quote on the uncoded arm rather than inventing one", () => {
    const text = textOf(withoutTooltips(renderRefusal(CONFLICT, 2)));
    assert.equal(/code /u.test(text), false);
    assert.match(text, /sent no refusal code/u);
    assert.match(text, /Your 2 edits are still here\./u);
    // the version the operator needs, off the settlement's composed sentence
    assert.match(text, /now at version 9/u);
  });

  it("keeps the server's sentence and the product's in separate blocks", () => {
    // A `conflict` message does not end in a period, so a run-on would read
    // "…re-applying.Your 2 edits…" as one broken sentence.
    const markup = renderRefusal(CONFLICT, 2);
    assert.equal(markup.includes("re-applying.Your"), false);
    assert.equal(markup.includes("</span><span>Your 2 edits"), true);
  });

  it("announces once — one alert, not a nested pair", () => {
    for (const settlement of [CONFLICT, REJECTED]) {
      assert.equal(occurrences(renderRefusal(settlement, 1), 'role="alert"'), 1);
    }
  });

  it("draws nothing at all when no save was refused", () => {
    assert.equal(
      renderToStaticMarkup(
        createElement(CheckpointRefusal, { refusal: null, onDismiss: () => undefined }),
      ),
      "",
    );
  });
});

describe("the step group's own chrome (C51, D273 item 5)", () => {
  it("gives every attributed step a Well, a recessed band and divided rows", () => {
    const markup = renderRail(dataSections());
    // Two attributed steps, so two banded groups. The band is what the recess
    // border under it identifies: a heading floating over rows draws neither.
    assert.equal(occurrences(markup, "border-[color:var(--ds-recess-border)] bg-[var(--ds-surface-1)]"), 2);
    assert.match(markup, /Find person/u);
    assert.match(markup, /Submit separation/u);
    // `Find person` records two rows, so exactly one divider falls between
    // them; `Submit separation` records one and gets none. A divider is drawn
    // BETWEEN values, never above the first.
    assert.equal(occurrences(markup, "border-t border-[color:var(--ds-border-subtle)]"), 1);
  });

  it("gives the unattributed group no band, because it has no step to name", () => {
    const markup = renderRail(dataSections());
    // The chrome encodes the step. The entry with no field identity is drawn
    // as a value — it just is not drawn a heading, empty or invented.
    assert.match(markup, /Legacy key/u);
    assert.equal(occurrences(markup, "border-[color:var(--ds-recess-border)] bg-[var(--ds-surface-1)]"), 2);
  });

  it("puts the system chip on the band and not on each row", () => {
    // `Find person` reads UCPath for two of its values; the chip is said once.
    const markup = renderRail(dataSections());
    assert.equal(occurrences(textOf(withoutTooltips(markup)), "UCPATH"), 1);
  });
});

describe("the rail's words (C16 / C32, D273 item 5)", () => {
  it("names the direction with the demo's own pair", () => {
    const markup = renderRail(dataSections());
    assert.match(markup, /<span class="sr-only">read<\/span>/u);
    assert.match(markup, /<span class="sr-only">write<\/span>/u);
    // `written` was a tense this ledger uses nowhere else.
    assert.equal(markup.includes(">written<"), false);
  });

  it("gives the Data section ONE name, read by its region and its label alike", () => {
    // The recorded divergence from the demo (C16): its region says `Data` under
    // a visible `Extracted fields`. One expression feeds both halves here, so
    // they cannot drift — the rule `intake.tsx` landed for WCAG 2.5.3.
    const markup = renderRail(dataSections());
    assert.match(markup, /<section aria-label="Extracted fields"/u);
    assert.equal(occurrences(markup, "Extracted fields"), 2);
  });
});

describe("the blocked commit arm states its reason exactly once (C70, D273 item 6)", () => {
  it("keeps the reason readable with every tooltip stripped", () => {
    const markup = renderRail(dataSections());
    const reason = "Change a value to save a correction.";
    // The VISIBLE half is the one that survives: a reason reachable only by
    // pointer is a fact the product does not have.
    assert.match(textOf(withoutTooltips(markup)), new RegExp(reason.replace(/\./gu, "\\."), "u"));
  });

  it("says it once, not once on screen and once on a title", () => {
    const markup = renderRail(dataSections());
    assert.equal(occurrences(markup, "Change a value to save a correction."), 1);
  });

  it("draws the resting commit label, not the in-flight one", () => {
    // C71's `Saving…` is a RULED deviation that stays, and it belongs to a
    // command in flight — a resting dock that showed it would be lying about a
    // dispatch that never happened.
    const text = textOf(renderRail(dataSections()));
    assert.match(text, /Save 0 corrections/u);
    assert.equal(text.includes("Saving"), false);
  });
});

/* =========================================================================
 * F7b — a refused save PRESSED, not merely rendered.
 *
 * Neither claim below has a fold that could hold it: (1) is about where the
 * BROWSER's focus lands after a DOM node unmounts, and (2) is about whether
 * TWO mounted components (a toast and a banner) share a live-region role —
 * both are questions only a real document can answer.
 * ====================================================================== */

/** the value setter React's controlled `<input>` tracks, bypassed so `dispatchEvent` reads as real user input */
function typeInto(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  if (descriptor?.set === undefined) throw new Error("jsdom's HTMLInputElement offers no native value setter");
  descriptor.set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** flushes the microtask the `.then()` in `save()` settles on */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const REJECTED_RESULT: CommandResult = CommandResultSchema.parse({
  state: "rejected",
  commandId: "22222222-2222-4222-8222-222222222222",
  code: "policy-refused",
  message: "This run's checkpoint is not correctable while a write is fenced.",
});

/** answers `executeCommand` with a fixed result and throws by name for anything else */
function commandClient(result: CommandResult): DashboardClient {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, property): unknown {
      if (property === "executeCommand") return async () => result;
      throw new Error(`the Context rail reached for client.${String(property)} during a refused-save press`);
    },
  };
  return new Proxy({}, handler) as unknown as DashboardClient;
}

let mountedRoot: Root | undefined;

afterEach(async () => {
  const root = mountedRoot;
  mountedRoot = undefined;
  if (root !== undefined) {
    await act(async () => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
});

/** mounts the real rail, dirties its one editable field and types a reason — everything short of the Save press */
async function mountDirtyRail(client: DashboardClient): Promise<{ save: HTMLButtonElement }> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoot = root;

  await act(async () => {
    root.render(
      createElement(DashboardClientProvider, {
        client,
        children: createElement(ToastProvider, {
          children: createElement(ContextRail, {
            summary: SUMMARY,
            sections: dataSections(),
            onClose: () => undefined,
            actorId: "operator-1",
            liveStatus: "queued",
            dataExpanded: false,
            onDataExpandedChange: () => undefined,
            onSaved: () => undefined,
          }),
        }),
      }),
    );
  });

  const inputsBeforeDirty = [...document.body.querySelectorAll("input")];
  if (inputsBeforeDirty.length !== 1) {
    throw new Error(`expected exactly one editable value input before typing, found ${String(inputsBeforeDirty.length)}`);
  }
  const value = inputsBeforeDirty[0];
  if (value === undefined) throw new Error("the rail's one editable input vanished between find and type");

  await act(async () => {
    typeInto(value, "10000099");
  });

  const reason = [...document.body.querySelectorAll("input")].find(
    (candidate) => candidate.placeholder.startsWith("e.g. CRM shows"),
  );
  if (reason === undefined) throw new Error("dirtying the value did not raise the reason field");
  await act(async () => {
    typeInto(reason, "CRM shows 10000099");
  });

  const save = [...document.body.querySelectorAll("button")].find(
    (button) => (button.textContent ?? "").startsWith("Save"),
  );
  if (save === undefined) throw new Error("the rail rendered no Save control");
  return { save };
}

describe("dismissing a refusal restores focus, it does not drop it (finding 1)", () => {
  it("moves focus to the Save control before the refusal unmounts", async () => {
    const { save } = await mountDirtyRail(commandClient(REJECTED_RESULT));

    await act(async () => {
      save.click();
    });
    await flush();

    const dismiss = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "Dismiss",
    );
    if (dismiss === undefined) throw new Error("the refused save drew no Dismiss control");
    // The press that reads this assertion IS keyboard input on this control —
    // give it the focus a keyboard operator would have left it with.
    dismiss.focus();

    await act(async () => {
      dismiss.click();
    });

    // Before the fix, `onDismiss` only cleared state: `CheckpointRefusal`
    // (Dismiss button included) unmounted and nothing had told the document
    // where focus goes next, so it fell to `<body>` — indistinguishable from
    // "the operator was never in this dialog" to anything listening for focus.
    assert.notEqual(document.activeElement, document.body);
    assert.equal(document.activeElement, save);
  });
});

describe("a refused save's toast does not repeat the banner's alert (finding 2)", () => {
  it("mounts the banner as the one role=\"alert\" and the toast as role=\"status\"", async () => {
    const { save } = await mountDirtyRail(commandClient(REJECTED_RESULT));

    await act(async () => {
      save.click();
    });
    await flush();

    const alerts = document.body.querySelectorAll('[role="alert"]');
    const statuses = document.body.querySelectorAll('[role="status"]');
    // Before the fix, the rejected arm's toast carried `tone: "danger"`, which
    // `ds/primitives-overlay.tsx` maps straight to `role="alert"` — the same
    // role the `Refusal` banner beside it already carries, and near-identical
    // copy announced twice. One alert (the banner) and one status (the toast)
    // is the fix; two alerts is the regression.
    assert.equal(alerts.length, 1, `expected one role="alert", found ${String(alerts.length)}`);
    assert.ok(statuses.length >= 1, "expected the toast to mount as role=\"status\"");
    assert.match(alerts[0]?.textContent ?? "", /refused/u);
  });
});
