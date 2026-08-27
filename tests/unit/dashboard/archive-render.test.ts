// @vitest-environment jsdom
/**
 * Two ui-review findings on the archive surface (unit F10b) that no pure fold
 * can hold, because both are about what the DOM says once React has drawn it.
 *
 * 1. The windowed table's row count (finding 4, archive.tsx:809). Only the
 *    mounted slice is ever in the DOM — `windowArchiveTable` sees to that on
 *    purpose (D274 item 1) — so an assistive technology reading the tree alone
 *    counts however many rows happen to be rendered, not the true size of the
 *    list. `ArchiveTable` is rendered to static markup (the standing pattern
 *    for a JSX fact `queue-bulk-band-sentence.test.ts` already uses) and the
 *    markup is read back for `aria-rowcount` on the `<table>` and
 *    `aria-rowindex` on each `<tr>`.
 *
 * 2. The capture viewer's Previous/Next walk (finding 1, archive.tsx:2073).
 *    `disabled` pulls a button out of the tab order the instant it disables,
 *    so the control the operator had just pressed to REACH an end lost focus
 *    to the dialog body. `CaptureViewerDialog` is mounted into a real document
 *    and pressed, the way `run-start-dialog.test.ts` presses the Run Modal.
 *    What jsdom can actually prove here is the ROOT CAUSE — the button must
 *    never become a real `disabled` control at either end — not the browser's
 *    own focus-eviction step, which jsdom does not implement (checked by
 *    hand: `btn.disabled = true` on a focused jsdom button leaves
 *    `document.activeElement` untouched, so an `activeElement` assertion
 *    alone would pass against the very `disabled=` code this file exists to
 *    catch). See the comment on the describe block below.
 */
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, it } from "vitest";
import { ArchiveEntryWireSchema } from "../../../src/domain/dashboard/archive.js";
import { ArchivedCaptureTileSchema, type ArchivedCaptureTile } from "../../../src/domain/archive/sections.js";
import {
  ArchiveTable,
  CaptureViewerDialog,
} from "../../../src/dashboard/surfaces/archive.js";
import type { ArchiveSection } from "../../../src/dashboard/surfaces/archive-model.js";
import { FIXTURE_ARCHIVE_INDEX } from "../../parity/helpers/fixture-archive.js";

const noop = (): void => undefined;

/* ── fixtures ─────────────────────────────────────────────────────────── */

const ENTRY = FIXTURE_ARCHIVE_INDEX.entries[0];

/** A distinct, schema-valid uuid per fixture row — ids are branded. */
function uuid(seed: string, index: number): string {
  const tail = `${seed}${String(index)}`.padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${tail}`;
}

function entries(seed: string, applicationId: string, n: number): ArchiveSection["entries"] {
  return Array.from({ length: n }, (_, index) => ArchiveEntryWireSchema.parse({
    ...ENTRY,
    applicationId,
    runId: uuid(seed, index),
  }));
}

function section(seed: string, n: number): ArchiveSection {
  const applicationId = uuid(`${seed}f`, 0);
  return { sweep: undefined, applicationId, entries: entries(seed, applicationId, n) };
}

function markup(sections: readonly ArchiveSection[], codes = new Map<string, string>()): string {
  return renderToStaticMarkup(createElement(ArchiveTable, {
    sections,
    codes,
    query: { text: "", workflowId: "all", status: "all", instance: "all", sort: "when", dir: "desc" },
    onSort: noop,
    collapsed: new Set<string>(),
    onToggleSection: noop,
    selectedRunId: undefined,
    onSelect: noop,
  }));
}

function attr(tag: string, name: string): string | undefined {
  const match = new RegExp(`${name}="([^"]*)"`, "u").exec(tag);
  return match?.[1];
}

describe("the windowed archive table names its true size to assistive tech", () => {
  it("sets aria-rowcount from the flat item list, not the mounted slice", () => {
    const sections = [section("a", 2), section("b", 1)];
    const html = markup(sections);
    const table = /<table\b[^>]*>/u.exec(html)?.[0];
    if (table === undefined) throw new Error("ArchiveTable drew no <table>");
    // 2 sections + 3 runs = 5 flat items — the same count the window arithmetic
    // walks, even though every one of them is mounted here (small fixture, no
    // scroll container measured yet).
    assert.equal(attr(table, "aria-rowcount"), "5");
  });

  it("gives every mounted row a 1-based aria-rowindex over the FULL list", () => {
    const sections = [section("a", 2), section("b", 1)];
    const html = markup(sections);
    const rows = [...html.matchAll(/<tr\b[^>]*>/gu)].map((match) => match[0]);
    const indexed = rows.map((row) => attr(row, "aria-rowindex")).filter((value) => value !== undefined);
    // section head, run, run, section head, run — in that order (flattenArchiveTable).
    assert.deepEqual(indexed, ["1", "2", "3", "4", "5"]);
  });

  it("keeps the window's own rowIndex offset when a section is collapsed", () => {
    const collapsedSection = section("a", 3);
    const html = renderToStaticMarkup(createElement(ArchiveTable, {
      sections: [collapsedSection, section("b", 1)],
      codes: new Map<string, string>(),
      query: { text: "", workflowId: "all", status: "all", instance: "all", sort: "when", dir: "desc" },
      onSort: noop,
      collapsed: new Set([collapsedSection.applicationId]),
      onToggleSection: noop,
      selectedRunId: undefined,
      onSelect: noop,
    }));
    const rows = [...html.matchAll(/<tr\b[^>]*>/gu)].map((match) => match[0]);
    // the header row's `<TR>` carries no `aria-rowindex` — it is not part of
    // the flat item list `rowCount`/`rowIndex` describe — so it drops out here
    // exactly as it does in the two tests above.
    const indexed = rows.map((row) => attr(row, "aria-rowindex")).filter((value) => value !== undefined);
    // the collapsed sweep still costs one flat item (its 3 runs are never
    // built), so the second section's head is row 2 of 3 — never row 4, which
    // is what it would be uncollapsed.
    assert.deepEqual(indexed, ["1", "2", "3"]);
    const table = /<table\b[^>]*>/u.exec(html)?.[0] ?? "";
    assert.equal(attr(table, "aria-rowcount"), "3");
  });
});

/* ── the capture viewer's walk ────────────────────────────────────────── */

function tile(seed: number, origin: ArchivedCaptureTile["origin"] = "operator-request"): ArchivedCaptureTile {
  return ArchivedCaptureTileSchema.parse({
    // "ca"/"bd" — hex-safe seeds, the way the shared `uuid()` helper needs
    // (archive-window.test.ts's own precedent: every letter must be 0-9a-f).
    artifactId: uuid("ca", seed),
    bundleId: uuid("bd", seed),
    kind: "screenshot",
    mediaType: "image/png",
    byteLength: 1_024 * (seed + 1),
    digest: String(seed).repeat(64).slice(0, 64),
    sensitivity: "redacted",
    capturedAt: "2026-08-20T09:11:00.000Z",
    origin,
    step: { state: "present", nodeId: `node-${String(seed)}` },
    system: { state: "present", value: "crm" },
    retention: { kind: "ordinary", purgeAfter: "2026-09-02T09:11:00.000Z" },
  });
}

const TILES: readonly ArchivedCaptureTile[] = [tile(0), tile(1), tile(2)];

/** The dialog's own parent owns `index` — this is that parent, minimally. */
function Harness({ initialIndex }: { initialIndex: number | undefined }) {
  const [index, setIndex] = useState<number | undefined>(initialIndex);
  return createElement(CaptureViewerDialog, {
    tiles: TILES,
    index,
    subject: "EID 10873698",
    onIndex: setIndex,
    onClose: () => { setIndex(undefined); },
  });
}

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

let mounted: Root | undefined;

afterEach(async () => {
  const root = mounted;
  mounted = undefined;
  if (root !== undefined) {
    await act(async () => { root.unmount(); });
  }
  document.body.replaceChildren();
});

async function mountHarness(initialIndex: number): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    root.render(createElement(Harness, { initialIndex }));
  });
}

function findButton(name: string): HTMLButtonElement {
  const match = [...document.body.querySelectorAll("button")]
    .filter((button) => (button.textContent ?? "").trim() === name);
  if (match.length !== 1) {
    throw new Error(`expected exactly one "${name}" control, found ${String(match.length)}`);
  }
  const only = match[0];
  if (only === undefined) throw new Error(`"${name}" vanished between find and use`);
  return only;
}

/** A `click()` in jsdom moves no focus of its own — focus first, as a pointer or a Tab would. */
async function press(button: HTMLButtonElement): Promise<void> {
  button.focus();
  await act(async () => { button.click(); });
}

describe("the capture viewer's Previous/Next walk never drops focus", () => {
  /*
    `.disabled` is the load-bearing assertion in both cases below: jsdom does
    NOT reproduce the browser's own "a disabled element cannot hold focus"
    step (checked directly against a mutation — setting `btn.disabled = true`
    on a focused jsdom button leaves `document.activeElement` untouched), so
    the `activeElement` assertion alone would pass against the OLD `disabled=`
    code too. What jsdom CAN and does prove is the root cause the finding
    names: the button must never become a real `disabled` control at either
    end of the walk. Reverting `aria-disabled` back to `disabled` turns both
    `.disabled`/`aria-disabled` assertions here red; the real focus-survives-a-
    real-disable claim belongs to the Playwright parity lane.
  */
  it("keeps focus on Previous once the walk reaches the first capture", async () => {
    await mountHarness(1);
    const previous = findButton("Previous capture");

    await press(previous);

    assert.equal(previous.disabled, false, "Previous became a real disabled control at the start of the walk");
    assert.equal(previous.getAttribute("aria-disabled"), "true");
    assert.equal(document.activeElement, previous, "focus left the nav control at the start of the walk");
  });

  it("keeps focus on Next once the walk reaches the last capture", async () => {
    await mountHarness(1);
    const next = findButton("Next capture");

    await press(next);

    assert.equal(next.disabled, false, "Next became a real disabled control at the end of the walk");
    assert.equal(next.getAttribute("aria-disabled"), "true");
    assert.equal(document.activeElement, next, "focus left the nav control at the end of the walk");
  });

  it("does not advance past either end", async () => {
    await mountHarness(0);
    const previous = findButton("Previous capture");

    await press(previous);
    await press(previous);

    // still on the first tile's own facts — pressing Previous at the start
    // never called onIndex(-1)
    assert.match(document.body.textContent ?? "", /node-0/u);
  });
});
