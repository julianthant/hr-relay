/**
 * The archive table's window (D274 item 1).
 *
 * The whole mechanic is arithmetic over two DECLARED row heights, so it is
 * pinned here as arithmetic rather than photographed: what the flat item list
 * contains, which items a viewport can see, what the two spacer heights are,
 * and — the half a fold test cannot see on its own — that the two restated
 * pixel constants are the values `ds/tokens.css` actually sets on the rows.
 * A spacer computed from a height the rows do not have is a table that slides
 * under its own scrollbar, and nothing else in the suite could fail on it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ArchiveEntryWireSchema } from "../../../src/domain/dashboard/archive.js";
import {
  ARCHIVE_OVERSCAN,
  ARCHIVE_ROW_PX,
  ARCHIVE_SECTION_PX,
  archiveItemHeightPx,
  flattenArchiveTable,
  windowArchiveTable,
  type ArchiveSection,
  type ArchiveTableItem,
} from "../../../src/dashboard/surfaces/archive/archive-model.js";
import { FIXTURE_ARCHIVE_INDEX } from "../../parity/helpers/fixture-archive.js";

const TOKENS = readFileSync(
  fileURLToPath(new URL("../../../src/dashboard/ds/theme/tokens.css", import.meta.url)),
  "utf8",
);

function tokenPx(name: string): number {
  const match = new RegExp(`--${name}:\\s*(\\d+)px`).exec(TOKENS);
  if (match === null) throw new Error(`ds/tokens.css declares no --${name} in pixels`);
  return Number(match[1]);
}

const ENTRY = FIXTURE_ARCHIVE_INDEX.entries[0];

/** A distinct, schema-valid uuid per fixture row — the ids are branded. */
function uuid(seed: string, index: number): string {
  const tail = `${seed}${String(index)}`.padStart(12, "0").slice(-12);
  return `00000000-0000-4000-8000-${tail}`;
}

/** `n` distinct entries, so a window can be told apart from the list it came from. */
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

function runIds(items: readonly ArchiveTableItem[]): string[] {
  return items.flatMap((item) => (item.kind === "run" ? [item.entry.runId] : []));
}

describe("the archive table's declared row heights", () => {
  it("restates exactly what the tokens set on the two row kinds", () => {
    expect({ row: ARCHIVE_ROW_PX, sweep: ARCHIVE_SECTION_PX }).toEqual({
      row: tokenPx("ds-h-row"),
      sweep: tokenPx("ds-h-archive-sweep"),
    });
  });

  it("gives each item kind its own height", () => {
    expect(archiveItemHeightPx({ kind: "run", entry: ENTRY })).toBe(ARCHIVE_ROW_PX);
    expect(archiveItemHeightPx({ kind: "section", section: section("a", 0), collapsed: false }))
      .toBe(ARCHIVE_SECTION_PX);
  });
});

describe("flattenArchiveTable", () => {
  it("puts heads and runs in ONE sequence, head first", () => {
    const items = flattenArchiveTable([section("a", 2), section("b", 1)], new Set());
    expect(items.map((item) => item.kind)).toEqual(["section", "run", "run", "section", "run"]);
    expect(runIds(items)).toEqual([uuid("a", 0), uuid("a", 1), uuid("b", 0)]);
  });

  it("makes a collapsed sweep cost ONE item, however many runs it holds", () => {
    const items = flattenArchiveTable([section("a", 400), section("b", 1)], new Set([section("a", 400).applicationId]));
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: "section", collapsed: true });
    expect(runIds(items)).toEqual([uuid("b", 0)]);
  });
});

describe("windowArchiveTable", () => {
  const items = flattenArchiveTable([section("a", 800)], new Set());
  const total = ARCHIVE_SECTION_PX + 800 * ARCHIVE_ROW_PX;

  it("renders EVERY item while the viewport is unmeasured, with no spacers", () => {
    expect(windowArchiveTable(items, undefined)).toEqual({
      firstIndex: 0,
      lastIndex: items.length,
      beforePx: 0,
      afterPx: 0,
      totalPx: total,
    });
  });

  it("holds only the visible items plus the overscan, at 800 rows", () => {
    const pane = windowArchiveTable(items, { scrollTop: 0, height: 640 });
    // head (52px) + 19 rows fills 640px; twelve more ride the overscan.
    expect(pane.firstIndex).toBe(0);
    expect(pane.lastIndex).toBe(1 + 19 + ARCHIVE_OVERSCAN);
    expect(pane.lastIndex).toBeLessThan(items.length);
    expect(pane.beforePx).toBe(0);
    expect(pane.afterPx).toBe(total - (ARCHIVE_SECTION_PX + (19 + ARCHIVE_OVERSCAN) * ARCHIVE_ROW_PX));
  });

  it("keeps the two spacers and the window exactly covering the list", () => {
    for (const scrollTop of [0, 33, 51, 52, 1_000, 12_345, total]) {
      const pane = windowArchiveTable(items, { scrollTop, height: 640 });
      const inside = items
        .slice(pane.firstIndex, pane.lastIndex)
        .reduce((sum, item) => sum + archiveItemHeightPx(item), 0);
      expect(pane.beforePx + inside + pane.afterPx).toBe(total);
      expect(pane.beforePx).toBeGreaterThanOrEqual(0);
      expect(pane.afterPx).toBeGreaterThanOrEqual(0);
    }
  });

  it("scrolls the window down the list rather than growing it", () => {
    const mid = windowArchiveTable(items, { scrollTop: 3_200, height: 320 });
    const deep = windowArchiveTable(items, { scrollTop: 6_400, height: 320 });
    expect(deep.firstIndex).toBeGreaterThan(mid.lastIndex);
    expect(deep.lastIndex - deep.firstIndex).toBe(mid.lastIndex - mid.firstIndex);
    expect(deep.beforePx).toBeGreaterThan(mid.beforePx);
  });

  it("clips the overscan at the ends rather than reaching past the list", () => {
    const top = windowArchiveTable(items, { scrollTop: 0, height: 320 });
    const mid = windowArchiveTable(items, { scrollTop: 3_200, height: 320 });
    expect(top.firstIndex).toBe(0);
    expect(top.beforePx).toBe(0);
    // the top window is the mid window WITHOUT the overscan it has no room
    // for above it — it does not silently reach past index 0
    expect(mid.firstIndex).toBeGreaterThanOrEqual(ARCHIVE_OVERSCAN);
    expect(mid.lastIndex - mid.firstIndex).toBeGreaterThan(top.lastIndex - top.firstIndex);

    const end = windowArchiveTable(items, { scrollTop: total, height: 320 });
    expect(end.lastIndex).toBe(items.length);
    expect(end.afterPx).toBe(0);
  });

  it("clamps an elastic overscroll to the top rather than refusing it", () => {
    expect(windowArchiveTable(items, { scrollTop: -120, height: 640 }))
      .toEqual(windowArchiveTable(items, { scrollTop: 0, height: 640 }));
  });

  it("refuses a measurement that is not a number, instead of blanking the table", () => {
    expect(() => windowArchiveTable(items, { scrollTop: Number.NaN, height: 640 }))
      .toThrow(/non-finite viewport/);
    expect(() => windowArchiveTable(items, { scrollTop: 0, height: Number.POSITIVE_INFINITY }))
      .toThrow(/non-finite viewport/);
    expect(() => windowArchiveTable(items, { scrollTop: 0, height: -1 }))
      .toThrow(/negative viewport height/);
  });

  it("windows an empty list to nothing", () => {
    expect(windowArchiveTable([], { scrollTop: 0, height: 640 })).toEqual({
      firstIndex: 0,
      lastIndex: 0,
      beforePx: 0,
      afterPx: 0,
      totalPx: 0,
    });
  });
});
