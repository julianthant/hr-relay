// @vitest-environment jsdom
/**
 * D274 item 6 (ledger 3 SE40–SE42) — the two READ-ONLY Settings sections, as an
 * operator actually meets them.
 *
 * `settings-facts.test.ts` pins what the SERVER says. What no fold on either
 * side can see is the three-state arm between them: these sections fetch, and a
 * surface that fetches has a loading state, a loaded state and a REFUSAL, and
 * the refusal is the one this repo cares about. An empty table and "we could not
 * ask the server" look identical on screen, and only one of them means the
 * deployment provisions nothing — so this file mounts the real `SettingsPage`
 * into a real document and drives all three.
 *
 * It is the second file in the unit lane to render React (after
 * `session-panel-pool-press.test.ts`) and for the same reason: the standing rule
 * that behaviour belongs to the parity lane holds for PIXELS, and none of the
 * claims below is about a pixel. Each was run against a mutation of the line it
 * pins — collapsing the failed arm into an empty render turns the refusal tests
 * red, and dropping `labelServed` turns the id-fallback test red.
 */
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import {
  SETTINGS_SYSTEM_HOSTS_SECTION_ID,
  SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
  SettingsFactsWireSchema,
  type SettingsFactsWire,
} from "../../../src/domain/dashboard/settings.js";
import {
  SettingsSectionPrimitiveSchema,
  StorageHealthSummaryWireSchema,
} from "../../../src/domain/dashboard/bootstrap.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { SettingsPage } from "../../../src/dashboard/surfaces/settings.js";
import { SYSTEM_HOST_PRESENTATION } from "../../../src/dashboard/surfaces/settings-model.js";
import { BrowserSystemIdSchema } from "../../../src/domain/ids.js";
import { DEFAULT_CATALOG_VIEW } from "../../../src/dashboard/surfaces/row-catalog-model.js";

class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const HEALTHY_STORAGE = StorageHealthSummaryWireSchema.parse({
  authority: "healthy",
  backup: "current",
  checkedAt: "2026-08-26T17:00:00.000Z",
});

/** Every fixture is what the STRICT wire schema produced, never a hand-built object. */
const FACTS: SettingsFactsWire = SettingsFactsWireSchema.parse({
  systemHosts: [
    {
      system: "kuali",
      production: "https://kuali.example/prod",
      test: { state: "provisioned", url: "https://kuali.example/sbx" },
    },
    { system: "crm", production: "https://crm.example/hr", test: { state: "not-provisioned" } },
    // Configured, but identical to production — the third wire state unit
    // F11b finding 2 added: refused at run time, and must not read the same
    // as `crm` above, which was simply never provisioned.
    { system: "onbase", production: "https://onbase.example/hr", test: { state: "not-distinct" } },
  ],
  workflowCapabilities: [
    {
      workflowId: "person-lookup",
      dryRun: { state: "unsupported", reason: "no-transaction-node" },
      typedStart: true,
      reviewPanel: false,
      editData: { state: "declared", editableFields: 3 },
      operatorGates: [],
      browserSystems: ["crm", "ucpath"],
    },
    {
      workflowId: "separations",
      dryRun: { state: "supported", stopsAt: "clear-pending" },
      typedStart: false,
      reviewPanel: false,
      editData: { state: "read-only" },
      operatorGates: ["identity-approval"],
      browserSystems: ["kuali", "ucpath"],
    },
    {
      workflowId: "unpreviewable-fixture",
      dryRun: { state: "unsupported", reason: "node-declares-unsupported", nodeId: "write-anyway" },
      typedStart: false,
      reviewPanel: true,
      editData: { state: "declared", editableFields: 0 },
      operatorGates: [],
      browserSystems: [],
    },
  ],
});

const LABELS = new Map<string, string>([
  ["person-lookup", "Person lookup"],
  ["separations", "Separations"],
  // `unpreviewable-fixture` is deliberately ABSENT — the id-fallback arm.
]);

const SECTIONS = SettingsSectionPrimitiveSchema.array().parse([
  { id: SETTINGS_SYSTEM_HOSTS_SECTION_ID, label: "System hosts", revision: 1 },
  { id: SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, label: "Workflow capabilities", revision: 1 },
]);

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
});

/** Mounts the real takeover on one section against a stub `settingsFacts`. */
async function mount(section: string, settingsFacts: () => Promise<SettingsFactsWire>): Promise<string> {
  host = document.createElement("div");
  document.body.append(host);
  const client = {
    settingsFacts,
    editableSettings: () => Promise.reject(new Error("editable settings are outside this status-section fixture")),
  } as unknown as DashboardClient;
  const element = createElement(DashboardClientProvider, {
    client,
    children: createElement(SettingsPage, {
      // D295: the catalog is a Settings section now. No render here opens it,
      // so these carry the section's defaults rather than a fixture nothing reads.
      catalogQuery: "",
      catalogView: DEFAULT_CATALOG_VIEW,
      onCatalogQuery: () => undefined,
      onCatalogView: () => undefined,
      storage: HEALTHY_STORAGE,
      sections: SECTIONS,
      workflowLabels: LABELS,
      section,
      actorId: "local-operator",
      descriptorFingerprint: "a".repeat(64),
      preflight: [],
      onSection: () => undefined,
      onClose: () => undefined,
    }),
  });
  await act(async () => {
    root = createRoot(host as HTMLElement);
    root.render(element);
  });
  return host.textContent ?? "";
}

/** The mounted document, for the claims that are about the TREE and not the text. */
function mounted(): HTMLElement {
  if (host === undefined) throw new Error("mount() has not run");
  return host;
}

/** A promise that never settles — the render is frozen in its loading arm. */
function pending(): Promise<SettingsFactsWire> {
  return new Promise<SettingsFactsWire>(() => undefined);
}

describe("System hosts (SE40)", () => {
  it("prints the configured production host and names the absence of a test one", async () => {
    const text = await mount(SETTINGS_SYSTEM_HOSTS_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes("https://kuali.example/prod"), text);
    assert.ok(text.includes("https://kuali.example/sbx"), text);
    // The absence is a WORD, not a blank cell: a run cannot ask for a test
    // instance that is not provisioned, and an empty cell says nothing.
    assert.ok(text.includes("none provisioned"), text);
  });

  /**
   * Unit F11b finding 2: a test host configured IDENTICAL to production must
   * read differently from one nobody provisioned at all — both are refused a
   * run, but only one of them is a config mistake worth surfacing by name.
   */
  it("names a test host configured identical to production as refused, not as unprovisioned", async () => {
    const text = await mount(SETTINGS_SYSTEM_HOSTS_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes("provisioned identical to production — refused"), text);
    // OnBase is the not-distinct row and CRM is the genuinely unprovisioned
    // one — both must be on screen, and they must be distinguishable words.
    // Named, not id'd: UF-SET-25 replaced the raw wire key with the system's
    // own name, so `onbase` is now `OnBase`.
    assert.ok(text.includes("OnBase"), text);
    assert.ok(text.includes("CRM"), text);
  });

  it("counts the systems that have a test host", async () => {
    const text = await mount(SETTINGS_SYSTEM_HOSTS_SECTION_ID, () => Promise.resolve(FACTS));
    // Only `kuali` is `provisioned`; `onbase`'s `not-distinct` test host does
    // NOT count — it is refused at run time, not a usable test host.
    assert.ok(text.includes("1 of 3 have a test host"), text);
  });

  it("shows the current deployment source beside the per-run host decision", async () => {
    const text = await mount(SETTINGS_SYSTEM_HOSTS_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes("Current deployment. Production is the default."), text);
    assert.ok(text.includes("Each run selects its host"), text);
    assert.ok(text.includes("never falls through to production"), text);
  });

  /**
   * UF-SET-25 — the SYSTEM column printed the raw wire id (`ucpath`,
   * `new-kronos`), which is a KEY. The demo prints the system's own name off a
   * client constant, and so does this now.
   */
  it("names each system rather than printing its wire id", async () => {
    await mount(SETTINGS_SYSTEM_HOSTS_SECTION_ID, () => Promise.resolve(FACTS));
    // Read the SYSTEM cell itself rather than the panel's text: the host URLs
    // in the two columns beside it contain `crm` and `onbase` as substrings, so
    // a whole-panel search cannot tell a name from a hostname.
    const names = [...mounted().querySelectorAll("tbody tr")].map(
      (row) => row.querySelector("td")?.textContent ?? "",
    );
    assert.equal(names.length, 3);
    assert.ok(names[0]?.startsWith("Kuali"), names.join(" | "));
    assert.ok(names[1]?.startsWith("CRM"), names.join(" | "));
    assert.ok(names[2]?.startsWith("OnBase"), names.join(" | "));
    for (const name of names) {
      assert.ok(!/\b(?:crm|onbase|kuali)\b/.test(name), `the raw wire id is still on screen: ${name}`);
    }
  });

  /**
   * UF-SET-26 — every row carries one sentence saying why the instance choice
   * matters for THAT system. Absent entirely before this.
   */
  it("carries the per-system sentence under each name", async () => {
    const text = await mount(SETTINGS_SYSTEM_HOSTS_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes(SYSTEM_HOST_PRESENTATION.kuali.note), text);
    assert.ok(text.includes(SYSTEM_HOST_PRESENTATION.crm.note), text);
    assert.ok(text.includes(SYSTEM_HOST_PRESENTATION.onbase.note), text);
  });

  it("keeps host source and refusal beside the facts after removing the subtitle", async () => {
    const text = await mount(SETTINGS_SYSTEM_HOSTS_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes("Current deployment."), text);
    assert.ok(text.includes("test request without a distinct test host is refused"), text);
    assert.doesNotMatch(text, /Which machine each system resolves to/u);
  });

  /**
   * The map is `Record<BrowserSystemId, …>`, so a MISSING system is already a
   * compile error. This pins the other direction — a key the enum no longer
   * carries, which compiles fine and is dead presentation nobody will notice.
   */
  it("presents exactly the closed system enum, no more and no less", () => {
    assert.deepEqual(
      Object.keys(SYSTEM_HOST_PRESENTATION).sort(),
      [...BrowserSystemIdSchema.options].sort(),
    );
    for (const [system, presentation] of Object.entries(SYSTEM_HOST_PRESENTATION)) {
      assert.ok(presentation.name.length > 0, `${system} has no name`);
      assert.ok(presentation.note.length > 0, `${system} has no note`);
    }
  });

  /**
   * The demo is the design authority for every system it covers, so its note is
   * the note — byte for byte (operator's ruling, unit U4b). U3 re-authored the
   * two that restate provisioning state and a `/provisioned/i` rule test was
   * added to hold the re-authoring in place; both are gone. This pins the port
   * itself instead, for the two the re-authoring had replaced.
   */
  it("carries the demo's own sentence for the systems the demo covers", () => {
    assert.equal(
      SYSTEM_HOST_PRESENTATION.onbase.note,
      "No test host is provisioned — a test run here is refused at enqueue rather than silently sent to production.",
    );
    assert.equal(
      SYSTEM_HOST_PRESENTATION.i9.note,
      "No test host is provisioned. The doctor's I-9 test-instance check reports the same thing.",
    );
  });
});

describe("Workflow capabilities (SE41/SE42)", () => {
  it("names the served descriptor source without blanket teaching", async () => {
    const text = await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes("Source: served workflow descriptors."), text);
    assert.doesNotMatch(text, /Every cell is derived from the same descriptor/u);
  });

  it("draws all three cell shapes, each with its own word", async () => {
    const text = await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    // available — the thing itself, never a tick
    assert.ok(text.includes("stops at clear-pending"), text);
    // not-applicable — the decision
    assert.ok(text.includes("N/A"), text);
    assert.ok(text.includes("writes to no system of record"), text);
    // not-built — the gap, with its named offender
    assert.ok(text.includes("Not built"), text);
    assert.ok(text.includes("write-anyway declares no preview arm"), text);
  });

  it("keeps capability explanations available on demand", async () => {
    await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    const help = mounted().querySelector('button[aria-label="What Dry run means"]');
    assert.ok(help instanceof HTMLButtonElement);
    await act(async () => { help.click(); });
    assert.ok(document.body.textContent?.includes("Offers a rehearsal that reads everything for real and writes nothing."));
  });

  it("counts, per capability, how many workflows answer it", async () => {
    const text = await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    // Dry run: only `separations` is supported, of three rows.
    assert.ok(text.includes("1 of 3"), text);
  });

  it("gives the dry-run posture its own reading, including the refusal", async () => {
    const text = await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes("Where a dry run stops"), text);
    assert.ok(text.includes("Stops after the prepare of clear-pending"), text);
    assert.ok(
      text.includes("write-anyway commits and declares no preview arm"),
      text,
    );
  });

  it("falls back to the workflow's own id, and says that is what it is", async () => {
    const text = await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes("Person lookup"), text);
    assert.ok(text.includes("unpreviewable-fixture"), text);
    assert.ok(text.includes("not in the served workflow list — this is its id"), text);
  });
});

describe("the F11b review fixes", () => {
  it("announces a refusal ONCE — the danger Banner is the only alert", async () => {
    await mount(
      SETTINGS_SYSTEM_HOSTS_SECTION_ID,
      () => Promise.reject(new Error("boom")),
    );
    // The defect this pins: an inner `role="alert"` inside a `danger` Banner
    // that already carries one, so the sentence is read twice and every
    // `getByRole("alert")` on this pane goes ambiguous (D273 items 9-10).
    assert.equal(mounted().querySelectorAll("[role=\"alert\"]").length, 1);
  });

  it("keeps a capability detail out of a clipping chip", async () => {
    await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    const dom = mounted();
    // A chip is `overflow-hidden whitespace-nowrap` outside and `truncate`
    // inside, so a value in one is unreachable the moment it is too long --
    // on EVERY pointer. The state token may be a chip; the detail may not.
    for (const chip of dom.querySelectorAll("span")) {
      if (!chip.className.includes("whitespace-nowrap")) continue;
      const text = chip.textContent ?? "";
      assert.ok(
        !text.includes("crm, ucpath") && !text.includes("identity-approval"),
        `a served capability value is inside a clipping token: ${text}`,
      );
    }
    // ...and it is still on screen, in full.
    assert.ok((dom.textContent ?? "").includes("crm, ucpath"), dom.textContent ?? "");
  });

  it("names an empty registry instead of drawing six header-only tables", async () => {
    const empty = SettingsFactsWireSchema.parse({
      systemHosts: [{ system: "crm", production: "https://crm.example/hr", test: { state: "not-provisioned" } }],
      workflowCapabilities: [],
    });
    const text = await mount(
      SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
      () => Promise.resolve(empty),
    );
    assert.ok(text.includes("This build registers no workflows"), text);
    assert.ok(!text.includes("Where a dry run stops"), text);
    assert.ok(!text.includes("0 of 0"), text);
  });

  it("refuses a document that serves zero system hosts", () => {
    // Not an empty state to draw: the system list is a closed enum and every
    // member has a production default, so zero is a broken producer.
    assert.throws(() => SettingsFactsWireSchema.parse({
      systemHosts: [],
      workflowCapabilities: [],
    }));
  });
});

describe("the async arms (D275 item 4)", () => {
  it("says it is reading, rather than drawing an empty table", async () => {
    const text = await mount(SETTINGS_SYSTEM_HOSTS_SECTION_ID, pending);
    assert.ok(text.includes("Reading what this deployment is configured with"), text);
    assert.ok(!text.includes("none provisioned"), text);
  });

  it("names a refusal and says nothing below is missing", async () => {
    const text = await mount(
      SETTINGS_SYSTEM_HOSTS_SECTION_ID,
      () => Promise.reject(new Error("GET /api/v1/settings/facts failed: 500")),
    );
    assert.ok(text.includes("These facts could not be read"), text);
    assert.ok(text.includes("GET /api/v1/settings/facts failed: 500"), text);
    // The negative control: a refusal that rendered an empty table would look
    // exactly like a deployment that provisions nothing.
    assert.ok(!text.includes("none provisioned"), text);
  });

  it("refuses in the capabilities section too, rather than an empty matrix", async () => {
    const text = await mount(
      SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
      () => Promise.reject(new Error("boom")),
    );
    assert.ok(text.includes("These facts could not be read"), text);
    assert.ok(!text.includes("Where a dry run stops"), text);
  });
});
