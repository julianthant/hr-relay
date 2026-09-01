// @vitest-environment jsdom
/**
 * The catalog surface is a rail beside a record (2026-09-01). These fixtures
 * mount the real section over the real generated catalog and prove the three
 * things the shape promises: the record opens on the search's first hit, a
 * rail row moves the record when clicked or reached by arrow key, and the
 * record prints the selected entry's provenance in full — both evidence refs
 * and every scenario by name — with no disclosure to open.
 */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { UiCatalogWireSchema } from "../../../src/domain/dashboard/explorer.js";
import { UiCatalogEntrySchema, type UiCatalogEntry } from "../../../src/domain/ui/contracts.js";
import { buildSafeUiCatalog } from "../../../src/stores/ucpath/driver/catalog.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { UiCatalogSection } from "../../../src/dashboard/surfaces/ui-catalog.js";
import { foldCatalogRail } from "../../../src/dashboard/surfaces/ui-catalog-model.js";

const ENTRIES: readonly UiCatalogEntry[] = buildSafeUiCatalog().entries.map((entry) => UiCatalogEntrySchema.parse(entry));
const WIRE = UiCatalogWireSchema.parse({
  wireVersion: 1,
  sourcePath: "generated/ui-catalog.json",
  schemaVersion: 1,
  entries: ENTRIES,
});

let mounted: Root | undefined;

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

/** Serves exactly the catalog read; any other client call is a fixture defect. */
function catalogClient(): DashboardClient {
  const served = { uiCatalog: () => Promise.resolve(WIRE) } as unknown as DashboardClient;
  return new Proxy(served, {
    get(target, property, receiver) {
      if (!(property in target)) throw new Error(`the catalog fixture does not serve DashboardClient.${String(property)}`);
      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

async function mountCatalog(query: string): Promise<void> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mounted = root;
  await act(async () => {
    const section = createElement(UiCatalogSection, {
      query,
      onQuery: () => undefined,
      view: "selectors" as const,
      onView: () => undefined,
    });
    root.render(createElement(DashboardClientProvider, { client: catalogClient(), children: section }));
  });
}

function rail(): HTMLElement {
  const node = document.querySelector('[role="listbox"][aria-label="Catalog entries"]');
  assert.ok(node instanceof HTMLElement, "the rail is a listbox");
  return node;
}

function options(): HTMLElement[] {
  return [...rail().querySelectorAll<HTMLElement>('[role="option"]')];
}

function record(): HTMLElement {
  const node = document.querySelector("article[aria-label]");
  assert.ok(node instanceof HTMLElement, "the record column is an article");
  return node;
}

function recordId(): string {
  const heading = record().querySelector("h3");
  assert.ok(heading !== null);
  return heading.textContent ?? "";
}

describe("the UI catalog rail and record", () => {
  it("draws every match in the rail and opens the record on the first one", async () => {
    await mountCatalog("kuali");
    const expected = foldCatalogRail(ENTRIES, "kuali");
    assert.deepEqual(
      options().map((option) => option.getAttribute("title")),
      expected.rows.map((row) => String(row.id)),
      "the rail is the fold's rows, in the fold's order",
    );
    const first = expected.matches[0];
    assert.ok(first !== undefined);
    assert.equal(recordId(), String(first.id));
    const selected = options().filter((option) => option.getAttribute("aria-selected") === "true");
    assert.equal(selected.length, 1);
    assert.equal(selected[0]?.getAttribute("title"), String(first.id));
    assert.equal(selected[0]?.tabIndex, 0, "the selected row holds the rail's one tab stop");
    assert.match(document.body.textContent ?? "", new RegExp(`${String(expected.matchedCount)} of ${String(ENTRIES.length)} entries`, "u"));
  });

  it("moves the record on click and on arrow keys, and keeps focus on the row it moved to", async () => {
    await mountCatalog("kuali");
    const rows = options();
    const third = rows[2];
    assert.ok(third !== undefined);
    await act(async () => {
      third.click();
    });
    assert.equal(recordId(), third.getAttribute("title"));
    assert.equal(rail().getAttribute("aria-activedescendant"), third.id);

    third.focus();
    await act(async () => {
      third.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    const fourth = options()[3];
    assert.ok(fourth !== undefined);
    assert.equal(recordId(), fourth.getAttribute("title"));
    assert.equal(document.activeElement, fourth, "focus follows the selection down the rail");

    await act(async () => {
      fourth.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    assert.equal(recordId(), rows[0]?.getAttribute("title"));
  });

  it("prints the selected entry's provenance whole: both evidence refs, every scenario, every task", async () => {
    const element = ENTRIES.find((entry) => entry.kind === "element" && entry.taskUses.length > 1);
    assert.ok(element !== undefined && element.kind === "element");
    await mountCatalog(String(element.id));
    assert.equal(recordId(), String(element.id));
    const text = record().textContent ?? "";
    assert.ok(text.includes(element.verification.fixtureEvidenceRef), "fixture evidence ref is printed");
    assert.ok(text.includes(element.verification.liveReadOnlyEvidenceRef), "live evidence ref is printed");
    assert.ok(text.includes(element.verification.verifiedAt));
    assert.ok(text.includes(element.sourceLink));
    for (const scenario of element.verification.scenarios) assert.ok(text.includes(String(scenario)), `scenario ${String(scenario)} is named`);
    for (const taskId of element.taskUses) assert.ok(text.includes(String(taskId)), `task ${String(taskId)} is named`);
    assert.equal(record().querySelector("details"), null, "nothing on the record is behind a disclosure");
    // The rail keeps the date beside every id it draws (the half of §5.8 it keeps).
    for (const option of options()) {
      const id = option.getAttribute("title");
      const entry = ENTRIES.find((candidate) => String(candidate.id) === id);
      assert.ok(entry !== undefined);
      assert.ok((option.textContent ?? "").includes(entry.verification.verifiedAt), `${String(id)} carries its verified date`);
    }
  });

  it("offers the other entries on the same screen, and selecting one moves the record", async () => {
    const element = ENTRIES.find((entry) => entry.kind === "element");
    assert.ok(element !== undefined && element.kind === "element");
    await mountCatalog(String(element.id));
    const strip = record().querySelector('section[aria-label="On the same screen"]');
    assert.ok(strip instanceof HTMLElement);
    const siblingChips = [...strip.querySelectorAll<HTMLButtonElement>("button")];
    const expected = ENTRIES.filter(
      (entry) => entry.kind !== "screen" && String(entry.screen) === String(element.screen) && String(entry.id) !== String(element.id),
    );
    assert.deepEqual(siblingChips.map((chip) => chip.textContent), expected.map((entry) => String(entry.id)));
    const target = siblingChips[0];
    assert.ok(target !== undefined);
    await act(async () => {
      target.click();
    });
    assert.equal(recordId(), target.textContent, "a sibling the search does not draw still opens under the same term");
    assert.equal(
      options().filter((option) => option.getAttribute("aria-selected") === "true").length,
      0,
      "the rail marks no row: the record is showing an entry the term does not draw",
    );
  });

  it("shows the empty state, and no rail, when nothing matches", async () => {
    await mountCatalog("no-such-entry-anywhere");
    assert.equal(document.querySelector('[role="listbox"]'), null);
    assert.match(document.body.textContent ?? "", /Nothing in the catalog matches/u);
  });
});
