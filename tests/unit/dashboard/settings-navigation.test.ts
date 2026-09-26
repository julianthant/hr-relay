import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { fixtureSettingsDocument } from "../../parity/helpers/fixture-settings.js";
import { SettingsSectionPrimitiveSchema } from "../../../src/domain/dashboard/bootstrap.js";
import { buildSettingsNav, resolveSettingsSection } from "../../../src/dashboard/surfaces/settings-model.js";

describe("canonical Settings navigation", () => {
  const document = fixtureSettingsDocument();
  const servedStatusSections = SettingsSectionPrimitiveSchema.array().parse([
    { id: "storage", label: "Storage checks", revision: 1 },
    { id: "workflow-capabilities", label: "Workflow capabilities", revision: 1 },
  ]);
  const groups = buildSettingsNav(servedStatusSections, document);

  it("serves the approved 11 pages under the three shared groups", () => {
    assert.deepEqual(groups.map(group => [group.heading, group.entries.map(entry => entry.id)]), [
      ["Settings", ["general", "performance", "paths", "routes", "providers", "credentials"]],
      ["Status", ["storage", "preflight", "workflow-capabilities"]],
      ["Help", ["keyboard", "ui-catalog"]],
    ]);
    assert.equal(groups.flatMap(group => group.entries).length, 11);
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
});
