/**
 * The catalog rail is a fold over the SERVED entries and nothing else: every
 * non-screen entry sits under the screen it names, a search keeps a screen
 * whenever one of its entries matches, and the record follows the requested id
 * only while the rail still draws it. Each assertion here pins one of those
 * against the real generated catalog, so the rail cannot drift from the
 * registries the way a hand-kept tree could.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { UiCatalogEntrySchema, type UiCatalogEntry } from "../../../src/domain/ui/contracts.js";
import { buildSafeUiCatalog } from "../../../src/stores/ucpath/driver/catalog.js";
import {
  ENTRY_KIND,
  catalogRowDomId,
  foldCatalogRail,
  railDisplayId,
  resolveCatalogSelection,
  siblingsOnScreen,
  stepCatalogSelection,
} from "../../../src/dashboard/surfaces/settings/catalog/ui-catalog-model.js";

const ENTRIES: readonly UiCatalogEntry[] = buildSafeUiCatalog().entries.map((entry) => UiCatalogEntrySchema.parse(entry));

describe("foldCatalogRail", () => {
  it("draws every served entry exactly once, nested under the screen it names", () => {
    const rail = foldCatalogRail(ENTRIES, "");
    assert.equal(rail.matchedCount, ENTRIES.length);
    assert.deepEqual(rail.matches, rail.rows, "with no query every drawn row is a match");
    assert.deepEqual(
      [...rail.rows.map((row) => String(row.id))].sort(),
      [...ENTRIES.map((entry) => String(entry.id))].sort(),
      "the unfiltered rail is the whole catalog, each id once",
    );
    for (const system of rail.systems) {
      for (const { screen, matched, children } of system.screens) {
        assert.equal(screen.kind, "screen");
        assert.equal(matched, true, "with no query every screen is a hit in its own right");
        for (const child of children) {
          assert.notEqual(child.kind, "screen");
          assert.equal("screen" in child ? String(child.screen) : undefined, String(screen.id));
          assert.equal(child.system, system.system);
        }
      }
    }
    assert.deepEqual(
      rail.systems.map((system) => system.system),
      [...new Set(ENTRIES.map((entry) => entry.system))].sort((a, b) => a.localeCompare(b)),
      "systems are the top-level partition, in name order",
    );
  });

  it("keeps a screen as the heading of its matching entries without counting it as a hit", () => {
    const child = ENTRIES.find((entry) => entry.kind === "element");
    assert.ok(child !== undefined && child.kind === "element");
    // Search by the child's own id: the screen row does not match the term
    // unless its id happens to contain it, which the assertion below checks.
    const rail = foldCatalogRail(ENTRIES, String(child.id));
    const screenRow = rail.systems.flatMap((system) => system.screens).find(({ screen }) => String(screen.id) === String(child.screen));
    assert.ok(screenRow !== undefined, "the child's screen is still drawn as its heading");
    assert.equal(screenRow.matched, String(child.screen).includes(String(child.id)));
    assert.ok(screenRow.children.some((entry) => String(entry.id) === String(child.id)));
    assert.equal(rail.rows[0]?.id, screenRow.screen.id, "the heading precedes its children in row order");
    assert.equal(rail.matchedCount, rail.matches.length);
    if (!screenRow.matched) assert.ok(!rail.matches.includes(screenRow.screen), "an unmatched heading is not a match");
  });

  it("narrows by every whitespace-split term, exactly as the shared matcher does", () => {
    const rail = foldCatalogRail(ENTRIES, "kuali observation");
    assert.ok(rail.matchedCount > 0);
    for (const row of rail.rows) {
      assert.equal(row.system, "kuali");
    }
    for (const system of rail.systems) {
      for (const { screen, matched, children } of system.screens) {
        if (matched) assert.equal(screen.kind, "screen");
        for (const entry of children) assert.equal(entry.kind, "observation");
      }
    }
  });

  it("returns an empty rail, not a throw, for a term nothing matches", () => {
    const rail = foldCatalogRail(ENTRIES, "no-such-entry-anywhere");
    assert.deepEqual(rail, { systems: [], rows: [], matches: [], matchedCount: 0 });
  });

  it("refuses an entry whose screen the catalog does not serve", () => {
    const orphan = ENTRIES.find((entry) => entry.kind === "element");
    assert.ok(orphan !== undefined && orphan.kind === "element");
    const withoutScreen = ENTRIES.filter((entry) => String(entry.id) !== String(orphan.screen));
    assert.throws(
      () => foldCatalogRail(withoutScreen, ""),
      new RegExp(`${String(orphan.id)} names screen ${String(orphan.screen)}`, "u"),
    );
  });
});

describe("the selection", () => {
  const rail = foldCatalogRail(ENTRIES, "");

  it("follows a drawn request, else a same-term request, else the first match, else nothing", () => {
    const last = rail.rows[rail.rows.length - 1];
    assert.ok(last !== undefined);
    assert.equal(resolveCatalogSelection(ENTRIES, rail, { id: String(last.id), query: "" }, ""), last);
    assert.equal(resolveCatalogSelection(ENTRIES, rail, undefined, ""), rail.rows[0]);
    assert.equal(resolveCatalogSelection(ENTRIES, rail, { id: "not.a.row", query: "" }, ""), rail.rows[0]);
    const empty = foldCatalogRail(ENTRIES, "no-such-entry-anywhere");
    assert.equal(resolveCatalogSelection(ENTRIES, empty, { id: "not.a.row", query: "x" }, "x"), undefined);

    // A term that draws only a heading opens on the heading's first CHILD.
    const child = ENTRIES.find((entry) => entry.kind === "element");
    assert.ok(child !== undefined && child.kind === "element");
    const narrowed = foldCatalogRail(ENTRIES, String(child.id));
    assert.equal(resolveCatalogSelection(ENTRIES, narrowed, undefined, String(child.id)), child);

    // A request the rail cannot draw is honoured under the term it was made
    // under (a sibling chip), and retired by the next term.
    const sibling = siblingsOnScreen(ENTRIES, child)[0];
    assert.ok(sibling !== undefined);
    const request = { id: String(sibling.id), query: String(child.id) };
    assert.equal(resolveCatalogSelection(ENTRIES, narrowed, request, String(child.id)), sibling);
    const elsewhere = ENTRIES.find((entry) => entry.system !== child.system);
    assert.ok(elsewhere !== undefined, "the catalog spans more than one system");
    const retyped = foldCatalogRail(ENTRIES, elsewhere.system);
    assert.ok(!retyped.rows.includes(sibling), "the new term does not draw the old request");
    assert.equal(resolveCatalogSelection(ENTRIES, retyped, request, elsewhere.system), retyped.matches[0]);
  });

  it("prints a nested id without its screen's prefix, and whole when it has none", () => {
    const prefixed = ENTRIES.find((entry) => entry.kind !== "screen" && String(entry.id).startsWith(`${String(entry.screen)}.`));
    assert.ok(prefixed !== undefined && prefixed.kind !== "screen");
    assert.equal(`${String(prefixed.screen)}.${railDisplayId(prefixed)}`, String(prefixed.id));
    const unprefixed = ENTRIES.find((entry) => entry.kind !== "screen" && !String(entry.id).startsWith(`${String(entry.screen)}.`));
    assert.ok(unprefixed !== undefined, "the catalog has a page state named off its screen's prefix");
    assert.equal(railDisplayId(unprefixed), String(unprefixed.id));
    const screen = ENTRIES.find((entry) => entry.kind === "screen");
    assert.ok(screen !== undefined);
    assert.equal(railDisplayId(screen), String(screen.id));
  });

  it("steps by one row and clamps at both ends", () => {
    const first = rail.rows[0];
    const second = rail.rows[1];
    const last = rail.rows[rail.rows.length - 1];
    assert.ok(first !== undefined && second !== undefined && last !== undefined);
    assert.equal(stepCatalogSelection(rail.rows, String(first.id), "ArrowDown"), second);
    assert.equal(stepCatalogSelection(rail.rows, String(second.id), "ArrowUp"), first);
    assert.equal(stepCatalogSelection(rail.rows, String(first.id), "ArrowUp"), first);
    assert.equal(stepCatalogSelection(rail.rows, String(last.id), "ArrowDown"), last);
    assert.equal(stepCatalogSelection(rail.rows, String(second.id), "Home"), first);
    assert.equal(stepCatalogSelection(rail.rows, String(second.id), "End"), last);
    assert.equal(stepCatalogSelection(rail.rows, undefined, "ArrowDown"), first);
    assert.equal(stepCatalogSelection([], undefined, "ArrowDown"), undefined);
  });

  it("names the other entries on the selected entry's screen, never itself and never the screen", () => {
    const element = ENTRIES.find((entry) => entry.kind === "element");
    assert.ok(element !== undefined && element.kind === "element");
    const siblings = siblingsOnScreen(ENTRIES, element);
    assert.ok(!siblings.some((entry) => String(entry.id) === String(element.id)));
    for (const sibling of siblings) {
      assert.notEqual(sibling.kind, "screen");
      assert.equal("screen" in sibling ? String(sibling.screen) : undefined, String(element.screen));
    }
    const screen = ENTRIES.find((entry) => String(entry.id) === String(element.screen));
    assert.ok(screen !== undefined);
    assert.ok(siblingsOnScreen(ENTRIES, screen).some((entry) => String(entry.id) === String(element.id)));
  });
});

describe("the vocabulary", () => {
  it("names every entry kind the schema serves, with one mark each", () => {
    const kinds = UiCatalogEntrySchema.options.map((option) => option.shape.kind.value);
    assert.deepEqual(Object.keys(ENTRY_KIND).sort(), [...kinds].sort());
    const marks = Object.values(ENTRY_KIND).map((kind) => kind.mark);
    assert.equal(new Set(marks).size, marks.length, "a rail glyph must be unambiguous");
  });

  it("makes a DOM id out of an entry id without dropping its identity", () => {
    assert.equal(catalogRowDomId(":r1:", "kuali.rrss-document.eid-field"), ":r1:-row-kuali_rrss-document_eid-field");
    assert.notEqual(catalogRowDomId("b", "a.b"), catalogRowDomId("b", "a-b"), "distinct ids stay distinct");
  });
});
