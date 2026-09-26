import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { EditableSettingsLeafWire } from "../../../src/domain/dashboard/settings-editor.js";
import { fixtureSettingsDocument } from "../../parity/helpers/fixture-settings.js";
import { draftError, patchFromSettingsDraft, settingInput, settingsSectionGroups, valueFromSettingInput } from "../../../src/dashboard/surfaces/settings-draft-model.js";
import { settingNote, settingTitle } from "../../../src/dashboard/surfaces/settings-presentation.js";
import { timeoutSetting } from "../../../src/dashboard/surfaces/settings-timeouts-model.js";

const performance = fixtureSettingsDocument().sections.find(section => section.id === "performance");
if (performance === undefined) throw new Error("performance fixture section missing");
const timeouts = performance.leaves.filter(leaf => timeoutSetting(leaf.path) !== undefined);
function leaf(path: string): EditableSettingsLeafWire {
  const found = timeouts.find(candidate => candidate.path === path);
  if (found === undefined) throw new Error(`timeout fixture leaf missing: ${path}`);
  return found;
}

describe("Performance timeout presentation", () => {
  it("shows all ten timeout settings with descriptions and purpose groups", () => {
    assert.equal(timeouts.length, 10);
    assert.deepEqual(settingsSectionGroups("performance", performance.leaves).slice(0, 3).map(group => [group.title, group.leaves.length]), [
      ["Navigation", 3], ["Work", 3], ["Sign-in & Duo", 4],
    ]);
    for (const item of timeouts) {
      assert.ok(settingTitle(item).length > 0);
      assert.ok((settingNote(item) ?? "").length > 0);
      assert.equal(valueFromSettingInput(item, settingInput(item)), item.effectiveValue);
    }
    assert.equal(settingTitle(leaf("timeouts.navigationMs")), "Standard navigation");
    assert.equal(settingTitle(leaf("timeouts.duoApprovalCrmSeconds")), "CRM Duo approval");
  });

  it("displays every duration in seconds and converts exactly to stored units", () => {
    const expected = [
      ["timeouts.navigationMs", "15", 15_000],
      ["timeouts.longNavigationMs", "30", 30_000],
      ["timeouts.ukgNavigationMs", "60", 60_000],
      ["timeouts.taskMs", "180", 180_000],
      ["timeouts.transactionMs", "300", 300_000],
      ["timeouts.retryDelayMs", "5", 5_000],
      ["timeouts.sessionAcquireMs", "60", 60_000],
      ["timeouts.duoCeremonyLeaseGraceMs", "20", 20_000],
      ["timeouts.duoApprovalSeconds", "180", 180],
      ["timeouts.duoApprovalCrmSeconds", "60", 60],
    ] as const;
    for (const [path, display, stored] of expected) {
      const item = leaf(path);
      assert.equal(settingInput(item), display);
      assert.equal(valueFromSettingInput(item, display), stored);
    }
    assert.deepEqual(patchFromSettingsDraft(timeouts, {
      "timeouts.taskMs": { kind: "set", raw: "3.5" },
      "timeouts.retryDelayMs": { kind: "set", raw: "0.125" },
    }), {
      "timeouts.taskMs": { set: 3_500 },
      "timeouts.retryDelayMs": { set: 125 },
    });
    assert.ok(draftError(leaf("timeouts.duoApprovalSeconds"), { kind: "set", raw: "2.5" }));
  });

  it("preserves millisecond precision and refuses sub-millisecond or fractional-second input", () => {
    const task = { ...leaf("timeouts.taskMs"), effectiveValue: 181_001 };
    assert.equal(settingInput(task), "181.001");
    assert.equal(valueFromSettingInput(task, "181.001"), 181_001);
    const crm = leaf("timeouts.duoApprovalCrmSeconds");
    for (const raw of ["", "0", "0.001", "1.5", "1.", "3e2", "-1"]) {
      assert.ok(draftError(crm, { kind: "set", raw }), `accepted invalid seconds: ${raw}`);
    }
    assert.ok(draftError(task, { kind: "set", raw: "181.0001" }));
    assert.ok(draftError(task, { kind: "set", raw: "0.0001" }));
  });
});
