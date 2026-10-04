// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { fixtureSettingsDocument } from "../../parity/helpers/fixture-settings.js";
import { SettingsSectionPrimitiveSchema, StorageHealthSummaryWireSchema } from "../../../src/domain/dashboard/bootstrap.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { buildSettingsNav, resolveSettingsSection } from "../../../src/dashboard/surfaces/settings-model.js";
import { SettingsPage } from "../../../src/dashboard/surfaces/settings.js";
import { DEFAULT_CATALOG_VIEW } from "../../../src/dashboard/surfaces/row-catalog-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
class MeasurementFreeResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);

const STORAGE = StorageHealthSummaryWireSchema.parse({
  authority: "healthy",
  backup: "current",
  checkedAt: "2026-08-26T17:00:00.000Z",
});
const servedStatusSections = SettingsSectionPrimitiveSchema.array().parse([
  { id: "storage", label: "Storage checks", revision: 1 },
  { id: "workflow-capabilities", label: "Workflow capabilities", revision: 1 },
]);

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  if (root !== undefined) act(() => { root?.unmount(); });
  host?.remove();
  root = undefined;
  host = undefined;
});

async function mountFailedRead(section: string): Promise<HTMLElement> {
  const container = document.createElement("div");
  host = container;
  document.body.append(container);
  const client = {
    editableSettings: () => Promise.reject(new Error("read failed")),
    settingsFacts: () => Promise.reject(new Error("facts unavailable")),
  } as unknown as DashboardClient;
  const element = createElement(DashboardClientProvider, {
    client,
    children: createElement(SettingsPage, {
      catalogQuery: "",
      catalogView: DEFAULT_CATALOG_VIEW,
      onCatalogQuery: () => undefined,
      onCatalogView: () => undefined,
      storage: STORAGE,
      sections: servedStatusSections,
      workflowLabels: new Map(),
      section,
      actorId: "local-operator",
      descriptorFingerprint: "a".repeat(64),
      preflight: [],
      onSection: () => undefined,
    }),
  });
  await act(async () => {
    root = createRoot(container);
    root.render(element);
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  return container;
}

describe("canonical Settings navigation", () => {
  const document = fixtureSettingsDocument();
  const groups = buildSettingsNav(servedStatusSections, document);

  it("serves the approved 15 pages under the four shared groups", () => {
    assert.deepEqual(groups.map(group => [group.heading, group.entries.map(entry => entry.id)]), [
      ["Personal", ["general", "performance", "paths", "spreadsheets", "routes", "providers", "credentials"]],
      ["Data", ["explorer", "archive", "activity"]],
      ["Status", ["storage", "preflight", "workflow-capabilities"]],
      ["Help", ["keyboard", "ui-catalog"]],
    ]);
    assert.equal(groups.flatMap(group => group.entries).length, 15);
  });

  it("keeps the approved navigation while the editable settings projection is unavailable", () => {
    const unavailableGroups = buildSettingsNav(servedStatusSections);
    assert.deepEqual(unavailableGroups.map(group => [group.heading, group.entries.map(entry => entry.id)]), [
      ["Personal", ["general", "performance", "paths", "spreadsheets", "routes", "providers", "credentials"]],
      ["Data", ["explorer", "archive", "activity"]],
      ["Status", ["storage", "preflight", "workflow-capabilities"]],
      ["Help", ["keyboard", "ui-catalog"]],
    ]);
    assert.ok(unavailableGroups[0]?.entries.every(entry => entry.source === "client"));
    const credentials = resolveSettingsSection(unavailableGroups, "credentials");
    assert.equal(credentials.state, "open");
  });

  it("folds legacy section URLs to their new page and keeps unknown requests explicit", () => {
    for (const [legacy, canonical] of [
      ["display", "general"], ["annual-dates", "general"], ["runtime-isolation", "paths"],
      ["provider-env", "credentials"], ["protected-store", "credentials"],
    ] as const) {
      const resolved = resolveSettingsSection(groups, legacy);
      assert.equal(resolved.state, "open");
      if (resolved.state === "open") assert.equal(resolved.entry.id, canonical);
    }
    assert.deepEqual(resolveSettingsSection(groups, "observed-host"), { state: "unknown", requested: "observed-host" });
  });

  it("shows the read refusal without hiding tabs while an independent page is open", async () => {
    const page = await mountFailedRead("keyboard");
    assert.equal(page.querySelectorAll('a[href^="?settings="]').length, 15);
    assert.ok(page.textContent?.includes("Editable settings unavailable"), page.textContent ?? "");
    assert.ok(page.textContent?.includes("Settings could not be read."), page.textContent ?? "");
    assert.ok(page.querySelector('button')?.textContent?.includes("Try again"));
  });

  it("reports a credential read failure instead of leaving its loading spinner", async () => {
    const page = await mountFailedRead("credentials");
    assert.ok(page.textContent?.includes("Credentials unavailable"), page.textContent ?? "");
    assert.ok(page.textContent?.includes("Settings could not be read."), page.textContent ?? "");
    assert.ok(page.querySelector('button')?.textContent?.includes("Try again"));
    assert.ok(!page.textContent?.includes("Reading settings authorities"), page.textContent ?? "");
  });
});
