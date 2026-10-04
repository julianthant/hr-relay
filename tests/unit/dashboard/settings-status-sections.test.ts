import { FIXTURE_EDITABLE_SETTINGS } from "../../parity/helpers/fixture-settings.js";
import { fixturePreflightReport } from "../../parity/helpers/fixture-preflight-routes.js";
import { DEFAULT_DASHBOARD_PROFILE } from "../../parity/helpers/fixture-profile.js";
import { PreflightActionsProvider } from "../../../src/dashboard/state/preflight-actions.js";
// @vitest-environment jsdom
/**
 * D274 item 6 (ledger 3 SE40–SE42) — the Workflow capabilities Settings section, as an
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
import { buildSettingsNav } from "../../../src/dashboard/surfaces/settings-model.js";
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
  { id: "storage", label: "Storage checks", revision: 1 },
  { id: SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, label: "Workflow capabilities", revision: 1 },
]);
const LEGACY_SECTIONS = SettingsSectionPrimitiveSchema.array().parse([
  { id: "storage", label: "Storage checks", revision: 1 },
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
async function mount(
  section: string,
  settingsFacts: () => Promise<SettingsFactsWire>,
  sections = SECTIONS,
): Promise<string> {
  host = document.createElement("div");
  document.body.append(host);
  const client = {
    settingsFacts,
    editableSettings: () => Promise.resolve(FIXTURE_EDITABLE_SETTINGS),
    preflightScopes: () => Promise.resolve([]),
    readPreflight: () => Promise.resolve({ state: "present", report: { ...fixturePreflightReport(DEFAULT_DASHBOARD_PROFILE), descriptorFingerprint: "a".repeat(64) } }),
  } as unknown as DashboardClient;
  const element = createElement(DashboardClientProvider, {
    client,
    children: createElement(SettingsPage, { onClose: () => undefined,
      // D295: the catalog is a Settings section now. No render here opens it,
      // so these carry the section's defaults rather than a fixture nothing reads.
      catalogQuery: "",
      catalogView: DEFAULT_CATALOG_VIEW,
      onCatalogQuery: () => undefined,
      onCatalogView: () => undefined,
      storage: HEALTHY_STORAGE,
      sections,
      workflowLabels: LABELS,
      section,
      actorId: "local-operator",
      descriptorFingerprint: "a".repeat(64),
      preflight: [],
      onSection: () => undefined,
    }),
  });
  await act(async () => {
    root = createRoot(host as HTMLElement);
    root.render(createElement(PreflightActionsProvider, { actions: { actorId: "local-operator", descriptorFingerprint: "a".repeat(64), showSettings: () => undefined, showSessions: () => undefined }, children: element }));
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

describe("D349 System hosts page retirement", () => {
  it("leaves a stale served id as a named build gap without rendering the retired page", async () => {
    const entries = buildSettingsNav(LEGACY_SECTIONS).flatMap((group) => group.entries);
    const retiredEntry = entries.find((entry) => entry.id === SETTINGS_SYSTEM_HOSTS_SECTION_ID);
    assert.equal(retiredEntry?.icon, "unrendered");

    const text = await mount(
      SETTINGS_SYSTEM_HOSTS_SECTION_ID,
      () => Promise.resolve(FACTS),
      LEGACY_SECTIONS,
    );
    assert.ok(text.includes("This build has no renderer for the served section “system-hosts”"), text);
    assert.equal(mounted().querySelector(".settings-host-row"), null);
    assert.ok(!text.includes("Production endpoints"), text);
    assert.ok(!text.includes("https://kuali.example/prod"), text);
  });
});

describe("System hosts wire compatibility", () => {
  it("still refuses a facts wire that omits system hosts", () => {
    assert.throws(() => SettingsFactsWireSchema.parse({
      systemHosts: [],
      workflowCapabilities: [],
    }));
  });
});

describe("Workflow capabilities (SE41/SE42)", () => {
  it("names the served descriptor source without blanket teaching", async () => {
    const text = await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes("Source: served workflow descriptors."), text);
    assert.doesNotMatch(text, /Every cell is derived from the same descriptor/u);
  });

  it("draws all three cell shapes, each with its own word", async () => {
    await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    const groups = [...mounted().querySelectorAll(".settings-reference-disclosure")];
    assert.equal(groups.length, 3);
    assert.ok(groups[0]?.textContent?.includes("Not applicable"));
    assert.ok(groups[0]?.textContent?.includes("writes to no system of record"));
    for (const group of groups.slice(1)) {
      const trigger = group.querySelector("button"); assert.ok(trigger);
      await act(async () => { trigger.click(); });
    }
    const text = mounted().textContent ?? "";
    assert.ok(text.includes("stops at clear-pending"), text);
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

  it("groups the six actual capabilities by workflow", async () => {
    await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    assert.equal(mounted().querySelectorAll(".settings-reference-disclosure").length, 3);
    assert.equal(mounted().querySelectorAll(".settings-reference-disclosure[data-state=open]").length, 1);
  });

  it("gives each workflow its own dry-run posture, including the refusal", async () => {
    const text = await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes("Where a dry run stops"), text);
    const supported = [...mounted().querySelectorAll(".settings-reference-disclosure")].find(node => node.textContent?.includes("Separations"));
    assert.ok(supported);
    const supportedTrigger = supported.querySelector("button"); assert.ok(supportedTrigger);
    await act(async () => { supportedTrigger.click(); });
    assert.ok(supported.textContent?.includes("Stops after the prepare of clear-pending"));
    const refusal = [...mounted().querySelectorAll(".settings-reference-disclosure")].find(node => node.textContent?.includes("unpreviewable-fixture"));
    assert.ok(refusal);
    const trigger = refusal.querySelector("button"); assert.ok(trigger);
    await act(async () => { trigger.click(); });
    assert.ok(refusal.textContent?.includes("write-anyway commits and declares no preview arm"));
  });

  it("falls back to the workflow's own id, and says that is what it is", async () => {
    const text = await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, () => Promise.resolve(FACTS));
    assert.ok(text.includes("Person lookup"), text);
    assert.ok(text.includes("unpreviewable-fixture"), text);
    assert.ok(text.includes("not in the served workflow list — this is its id"), text);
  });
});

describe("the F11b review fixes", () => {
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

});

describe("the async arms (D275 item 4)", () => {
  it("says facts are loading instead of drawing an empty matrix", async () => {
    const text = await mount(SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID, pending);
    assert.ok(text.includes("Loading deployment facts"), text);
    assert.ok(!text.includes("Where a dry run stops"), text);
  });

  it("refuses in the capabilities section too, rather than an empty matrix", async () => {
    const text = await mount(
      SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
      () => Promise.reject(new Error("boom")),
    );
    assert.ok(text.includes("These facts could not be read"), text);
    assert.ok(text.includes("boom"), text);
    assert.ok(!text.includes("Where a dry run stops"), text);
    assert.equal(mounted().querySelectorAll('[role="alert"]').length, 1);
  });
});
