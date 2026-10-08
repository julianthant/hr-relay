/**
 * The row-and-panel catalog documents the SERVED vocabulary or it documents
 * nothing (D274 item 4). Every assertion here is about that: the page's kinds
 * come off the schemas, its display order names every one of them, and its
 * derived tab strips agree with the run-detail wire's own compatibility rule.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ContainmentSchema } from "../../../src/models/dashboard/projection.js";
import { PanelKindSchema, RunDetailSectionSchema } from "../../../src/models/dashboard/primitives.js";
import { RunDetailWireSchema, sectionsForPanelKind } from "../../../src/models/dashboard/run-detail.js";
import { PANEL_TAB_LABEL, TAB_ORDER } from "../../../src/dashboard/surfaces/run-detail/log-panel-model.js";
import {
  DEFAULT_CATALOG_VIEW,
  ROLLUP_COUNTS,
  ROW_SURFACE_ORDER,
  UNSERVED_VOCABULARY,
  containmentSpecs,
  panelKindSpecs,
  parseCatalogView,
  rowSurfaceSpecs,
} from "../../../src/dashboard/surfaces/settings/catalog/row-catalog-model.js";

const RUN = "e1b8ae3e-0000-4000-8000-000000000001";
const AT = "2026-08-25T12:00:00.000Z";

/** A minimal run detail, so the section claim can be checked against the WIRE. */
function detailWith(panelKind: string, sections: readonly string[]) {
  return {
    runId: RUN,
    rowRevision: 1,
    panelKind,
    header: {
      runId: RUN,
      traceId: "pl-100000-e1b8",
      workflowId: "person-lookup",
      actorId: "local-operator",
      title: "EID 10873698",
      status: "running",
      attempt: 1,
    },
    timeline: {
      events: [{
        noteId: "e1b8ae3e-0000-4000-8000-000000000101",
        sequence: 0,
        at: AT,
        label: "searching",
        state: "active",
        notRun: { state: "absent", reason: "this step ran" },
      }],
    },
    gate: { state: "absent", reason: "this run reached no gate" },
    outcome: { state: "absent", reason: "run is still executing" },
    context: { dataFacts: 0, evidenceFacts: 0, attempts: 1 },
    availableSections: sections,
  };
}

describe("row/panel catalog — the vocabulary is read off the schemas", () => {
  it("names every row surface kind the queue wire can discriminate, exactly once", () => {
    const specs = rowSurfaceSpecs();
    assert.equal(specs.length, ROW_SURFACE_ORDER.length);
    assert.deepEqual(specs.map((spec) => spec.key), [...ROW_SURFACE_ORDER]);
    assert.equal(new Set(ROW_SURFACE_ORDER).size, ROW_SURFACE_ORDER.length);
    // The four the projector's `surfaceKindOf` folds a run shape into. A fifth
    // arm on the wire union is a typecheck failure in the model; this is the
    // other direction — an arm dropped from the ORDER list, which the compiler
    // cannot see.
    assert.deepEqual([...ROW_SURFACE_ORDER].toSorted(), ["member", "operation", "preview", "single"]);
  });

  it("names every containment arm, in the schema's own order", () => {
    assert.deepEqual(containmentSpecs().map((spec) => spec.key), [...ContainmentSchema.options]);
  });

  it("names every panel kind, in the schema's own order", () => {
    assert.deepEqual(panelKindSpecs().map((spec) => spec.key), [...PanelKindSchema.options]);
  });

  it("gives every specimen prose that is not the empty string", () => {
    for (const spec of rowSurfaceSpecs()) {
      assert.ok(spec.name.length > 0 && spec.subject.length > 0 && spec.producedWhen.length > 0, spec.key);
      assert.ok(spec.carries.length > 0, `${spec.key} carries nothing`);
    }
    for (const spec of containmentSpecs()) {
      assert.ok(spec.rule.length > 0 && spec.lives.length > 0 && spec.counts.length > 0, spec.key);
    }
  });
});

describe("row/panel catalog — a tab strip the product would refuse cannot be drawn", () => {
  it("draws only tabs whose section the run-detail wire accepts on that panel kind", () => {
    for (const spec of panelKindSpecs()) {
      for (const tab of spec.tabs) {
        const parsed = RunDetailWireSchema.safeParse(detailWith(spec.key, [tab.key]));
        assert.equal(parsed.success, true, `${spec.key} advertises ${tab.key}, which the wire refuses`);
      }
    }
  });

  it("omits the tab whose section that panel kind may NOT advertise", () => {
    // The negative control. Without it, a `tabsForPanelKind` that returned
    // every tab for every kind would pass the assertion above only if the wire
    // were permissive — so the refused pairings are named here directly.
    const byKind = new Map(panelKindSpecs().map((spec) => [spec.key, spec.tabs.map((tab) => tab.key)]));
    assert.deepEqual(byKind.get("run"), ["logs", "receipt"]);
    assert.deepEqual(byKind.get("member"), ["logs", "receipt"]);
    assert.deepEqual(byKind.get("review"), ["review", "logs", "receipt"]);
    assert.deepEqual(byKind.get("group"), ["people", "logs", "receipt"]);
    for (const [kind, tabs] of byKind) {
      const refused = kind === "group" ? "review" : kind === "review" ? "people" : undefined;
      if (refused === undefined) continue;
      assert.equal(tabs.includes(refused as never), false, `${kind} must not advertise ${refused}`);
    }
  });

  it("draws the tabs in the panel's own TAB_ORDER, never a second copy of it", () => {
    // The catalog used to iterate a hand-copied `["review","people","logs",
    // "receipt"]`. The per-kind lists above pin the ORDER, but only against the
    // copy — so this asserts the shared array is the one being read, and that
    // it still covers every tab the panel can draw.
    // `PANEL_TAB_LABEL` is a `Record<PanelTab, string>`, so its keys ARE the
    // union — a fifth tab is a typecheck failure there and shows up here.
    assert.deepEqual([...TAB_ORDER].sort(), Object.keys(PANEL_TAB_LABEL).sort());
    for (const spec of panelKindSpecs()) {
      const positions = spec.tabs.map((tab) => TAB_ORDER.indexOf(tab.key));
      assert.equal(positions.includes(-1), false, `${spec.key} draws a tab TAB_ORDER does not name`);
      assert.deepEqual(positions, [...positions].sort((a, b) => a - b), `${spec.key} draws them out of order`);
    }
  });

  it("prints the panel's own word for a tab, never a second copy of it", () => {
    for (const spec of panelKindSpecs()) {
      for (const tab of spec.tabs) assert.equal(tab.label, PANEL_TAB_LABEL[tab.key]);
    }
  });

  it("lists only sections the run-detail section enum declares", () => {
    const declared = new Set<string>(RunDetailSectionSchema.options);
    for (const spec of panelKindSpecs()) {
      assert.ok(spec.sections.length > 0, `${spec.key} advertises no section at all`);
      for (const section of spec.sections) assert.equal(declared.has(section), true, section);
    }
  });

  it("derives the ceiling from the wire rule rather than from a second list", () => {
    for (const kind of PanelKindSchema.options) {
      const derived = sectionsForPanelKind(kind);
      const spec = panelKindSpecs().find((entry) => entry.key === kind);
      assert.notEqual(spec, undefined);
      assert.deepEqual(spec?.sections, derived);
    }
  });
});

describe("row/panel catalog — the absences are stated, not implied", () => {
  it("names the demo vocabulary this build cannot serve, with a reason each", () => {
    assert.ok(UNSERVED_VOCABULARY.length >= 4);
    for (const entry of UNSERVED_VOCABULARY) {
      assert.ok(entry.demo.length > 0 && entry.why.length > 0);
    }
    const all = UNSERVED_VOCABULARY.map((entry) => `${entry.demo} ${entry.why}`).join(" ");
    // The four the roll-up's decision 4 names. If one of them ever becomes
    // servable, this test is where the page and the plan meet.
    assert.ok(all.includes("rejected"), "the fourth containment kind must be named");
    assert.ok(all.toLowerCase().includes("precedence"), "the rollup precedence chain must be named");
    assert.ok(all.includes("VARIANT"), "the eight row variants must be named");
    assert.ok(all.toLowerCase().includes("per-workflow map"), "the per-workflow map must be named");
  });

  it("states no rollup arm the projection does not serve", () => {
    assert.deepEqual(ROLLUP_COUNTS.map((count) => count.key), ["total", "terminal", "failed"]);
  });
});

describe("catalog view routing", () => {
  it("accepts the two views and drops anything else", () => {
    assert.equal(parseCatalogView("vocabulary"), "vocabulary");
    assert.equal(parseCatalogView("selectors"), "selectors");
    assert.equal(parseCatalogView("Selectors"), undefined);
    assert.equal(parseCatalogView(""), undefined);
    assert.equal(parseCatalogView(null), undefined);
  });

  it("defaults to the panel this key has always opened", () => {
    assert.equal(DEFAULT_CATALOG_VIEW, "selectors");
  });
});
