import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PanelKindSchema, RunDetailSectionSchema } from "../../../../../src/models/dashboard/primitives.js";
import { RunDetailWireSchema, sectionsForPanelKind } from "../../../../../src/models/dashboard/run-detail.js";
import { PANEL_TAB_LABEL, TAB_ORDER, type PanelTab } from "../../../../../src/dashboard/surfaces/log-panel-model.js";

type RunDetailSection = (typeof RunDetailSectionSchema.options)[number];
type PanelKindSpec = {
  readonly key: (typeof PanelKindSchema.options)[number];
  readonly tabs: readonly { readonly key: PanelTab; readonly label: string }[];
  readonly sections: readonly RunDetailSection[];
};

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

/** Replaces the retired reference projection with the exact source rules it exposed. */
function panelKindSpecs(): readonly PanelKindSpec[] {
  return PanelKindSchema.options.map((key) => {
    const sections = sectionsForPanelKind(key);
    const advertisable = new Set<RunDetailSection>(sections);
    const tabs: { key: PanelTab; label: string }[] = [];
    for (const tab of TAB_ORDER) {
      if (advertisable.has(tab)) tabs.push({ key: tab, label: PANEL_TAB_LABEL[tab] });
    }
    return { key, tabs, sections };
  });
}

describe("run-detail panels — a tab strip the wire refuses cannot be drawn", () => {
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
    // The per-kind lists pin the ORDER against the wire. This asserts the
    // shared array is the one being read and that it covers every drawable tab.
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
