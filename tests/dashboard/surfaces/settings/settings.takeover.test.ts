import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,it } from "vitest";
import type { DashboardClient } from "../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../src/dashboard/state/client-context.js";
import { buildSettingsNav,resolveSettingsSection } from "../../../../src/dashboard/surfaces/settings/settings-model.js";
import { SettingsPage } from "../../../../src/dashboard/surfaces/settings/settings.js";

describe("curly quotes around a section name (unit F4b finding 3)", () => {
  it("names the requested-but-unknown section without &quot;", () => {
    const resolution = resolveSettingsSection(buildSettingsNav(), "budgets");
    assert.equal(resolution.state, "unknown");
    const markup = renderToStaticMarkup(createElement(DashboardClientProvider, {
      client: {} as DashboardClient,
      children: createElement(SettingsPage, { profileName: "Synthetic Operator", onClose: () => undefined,
        section: "budgets",
        actorId: "local-operator",
        descriptorFingerprint: "a".repeat(64),
        onSection: () => undefined,
      }),
    }));
    assert.match(markup, /No such settings section.*budgets/u);
    assert.ok(!markup.includes("&quot;budgets&quot;"), markup);
  });
});
