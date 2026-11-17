import assert from "node:assert/strict";
import { it } from "vitest";
import { browserRootUpgradeTransition, type BrowserRootUpgradeEvent, type BrowserRootUpgradeState } from "../../../../src/backend/storage/maintenance/browser-root-upgrade.js";

it("browser-root upgrade: each phase takes only its own next step", () => {
  const events: readonly BrowserRootUpgradeEvent[] = ["back-up", "probe", "stage", "publish"];
  const expected: Record<BrowserRootUpgradeState, Record<BrowserRootUpgradeEvent, string>> = {
    absent: { "back-up": "probing", probe: "refused", stage: "refused", publish: "refused" },
    probing: { "back-up": "refused", probe: "prepared", stage: "refused", publish: "refused" },
    prepared: { "back-up": "refused", probe: "refused", stage: "ready", publish: "refused" },
    ready: { "back-up": "refused", probe: "refused", stage: "refused", publish: "absent" },
  };
  for (const [state, row] of Object.entries(expected) as [BrowserRootUpgradeState, Record<BrowserRootUpgradeEvent, string>][]) {
    for (const event of events) assert.equal(browserRootUpgradeTransition(state, event) ?? "refused", row[event], `${state} + ${event}`);
  }
});
