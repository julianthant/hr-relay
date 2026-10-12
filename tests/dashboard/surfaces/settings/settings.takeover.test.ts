
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import {
buildSettingsNav,
resolveSettingsSection,
type SettingsSection
} from "../../../../src/dashboard/surfaces/settings/settings-model.js";
import { SettingsPage } from "../../../../src/dashboard/surfaces/settings/settings.js";
import {
SettingsSectionPrimitiveSchema,
StorageHealthSummaryWireSchema,
} from "../../../../src/models/dashboard/bootstrap.js";

/** Parsed, so a case cannot express a section the bootstrap would refuse. */
function section(id: string, label: string): SettingsSection {
  return SettingsSectionPrimitiveSchema.parse({ id, label, revision: 1 });
}

const STORAGE = section("storage", "Storage checks");
const HEALTHY_STORAGE = StorageHealthSummaryWireSchema.parse({
  authority: "healthy",
  backup: "current",
  checkedAt: "2026-08-26T16:00:00.000Z",
});
const STATIC_SETTINGS_CLIENT = {} as DashboardClient;

describe("curly quotes around a section name (unit F4b finding 3)", () => {
  it("quotes the requested-but-unknown section name with curly quotes, not &quot;", () => {
    const groups = buildSettingsNav([STORAGE]);
    const resolution = resolveSettingsSection(groups, "budgets");
    assert.equal(resolution.state, "unknown");
    const markup = renderToStaticMarkup(createElement(DashboardClientProvider, {
      client: STATIC_SETTINGS_CLIENT,
      children: createElement(SettingsPage, { onClose: () => undefined,
        storage: HEALTHY_STORAGE,
        sections: [STORAGE],
      section: "budgets",
      actorId: "local-operator",
      descriptorFingerprint: "a".repeat(64),
      preflight: [],
      workflowLabels: new Map<string, string>(),
      onSection: () => undefined,
      }),
    }));
    assert.match(markup, /called “budgets”\./u);
    assert.ok(!markup.includes("&quot;budgets&quot;"), markup);
  });

  it("quotes an unrendered served section's id with curly quotes, not &quot;", () => {
    const markup = renderToStaticMarkup(createElement(DashboardClientProvider, {
      client: STATIC_SETTINGS_CLIENT,
      children: createElement(SettingsPage, { onClose: () => undefined,
        storage: HEALTHY_STORAGE,
        sections: [STORAGE, section("budgets", "Budgets")],
      section: "budgets",
      actorId: "local-operator",
      descriptorFingerprint: "a".repeat(64),
      preflight: [],
      workflowLabels: new Map<string, string>(),
      onSection: () => undefined,
      }),
    }));
    assert.match(markup, /“budgets”/u);
    assert.ok(!markup.includes("&quot;budgets&quot;"), markup);
  });
});
