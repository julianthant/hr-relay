import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { EditableSettingsLeafWire } from "../../../src/domain/dashboard/settings-editor.js";
import { fixtureSettingsDocument } from "../../parity/helpers/fixture-settings.js";
import { draftError, patchFromSettingsDraft, settingInput, settingsSectionGroups, valueFromSettingInput } from "../../../src/dashboard/surfaces/settings-draft-model.js";
import { settingNote, settingTitle } from "../../../src/dashboard/surfaces/settings-presentation.js";
import { timeoutDisplayUnit, timeoutSetting } from "../../../src/dashboard/surfaces/settings-timeouts-model.js";

const performance = fixtureSettingsDocument().sections.find(section => section.id === "performance");
if (performance === undefined) throw new Error("performance fixture section missing");
const timeouts = performance.leaves.filter(leaf => timeoutSetting(leaf.path) !== undefined);
function leaf(path: string): EditableSettingsLeafWire {
  const found = timeouts.find(candidate => candidate.path === path);
  if (found === undefined) throw new Error(`timeout fixture leaf missing: ${path}`);
  return found;
}

describe("Performance timeout presentation", () => {
  it("shows all ten timeout settings with a description and groups them by purpose", () => {
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

  it("displays the supplied defaults in seconds or minutes and saves exact stored units", () => {
    const expected = [
      ["timeouts.navigationMs", "15", "seconds", 15_000],
      ["timeouts.longNavigationMs", "30", "seconds", 30_000],
      ["timeouts.ukgNavigationMs", "60", "seconds", 60_000],
      ["timeouts.taskMs", "3", "minutes", 180_000],
      ["timeouts.transactionMs", "5", "minutes", 300_000],
      ["timeouts.retryDelayMs", "5", "seconds", 5_000],
      ["timeouts.sessionAcquireMs", "60", "seconds", 60_000],
      ["timeouts.duoCeremonyLeaseGraceMs", "20", "seconds", 20_000],
      ["timeouts.duoApprovalSeconds", "3", "minutes", 180],
      ["timeouts.duoApprovalCrmSeconds", "60", "seconds", 60],
    ] as const;
    for (const [path, display, unit, stored] of expected) {
      const item = leaf(path);
      assert.equal(settingInput(item), display);
      assert.equal(timeoutDisplayUnit(item), unit);
      assert.equal(valueFromSettingInput(item, display), stored);
    }
    assert.deepEqual(patchFromSettingsDraft(timeouts, {
      "timeouts.taskMs": { kind: "set", raw: "3.5" },
      "timeouts.duoApprovalSeconds": { kind: "set", raw: "2.5" },
      "timeouts.retryDelayMs": { kind: "set", raw: "0.125" },
    }), {
      "timeouts.taskMs": { set: 210_000 },
      "timeouts.duoApprovalSeconds": { set: 150 },
      "timeouts.retryDelayMs": { set: 125 },
    });
    assert.deepEqual(patchFromSettingsDraft(timeouts, {
      "timeouts.taskMs": { kind: "set", raw: "181.001", timeoutUnit: "seconds" },
      "timeouts.duoApprovalSeconds": { kind: "set", raw: "181", timeoutUnit: "seconds" },
    }), {
      "timeouts.taskMs": { set: 181_001 },
      "timeouts.duoApprovalSeconds": { set: 181 },
    });
  });

  it("preserves odd stored millisecond values and refuses fractional storage units", () => {
    const task = { ...leaf("timeouts.taskMs"), effectiveValue: 181_001 };
    assert.equal(timeoutDisplayUnit(task), "seconds");
    assert.equal(settingInput(task), "181.001");
    assert.equal(valueFromSettingInput(task, "181.001"), 181_001);
    assert.equal(valueFromSettingInput(leaf("timeouts.taskMs"), "181.001", "seconds"), 181_001);
    const ninetySeconds = { ...leaf("timeouts.taskMs"), effectiveValue: 90_000 };
    assert.equal(timeoutDisplayUnit(ninetySeconds), "minutes");
    assert.equal(settingInput(ninetySeconds), "1.5");
    assert.equal(valueFromSettingInput(ninetySeconds, "1.5"), 90_000);
    const crm = leaf("timeouts.duoApprovalCrmSeconds");
    for (const raw of ["", "0", "0.001", "1.5", "1.", "3e2", "-1"]) {
      assert.ok(draftError(crm, { kind: "set", raw }), `accepted invalid seconds: ${raw}`);
    }
    assert.ok(draftError(task, { kind: "set", raw: "181.0001" }));
    assert.ok(draftError(ninetySeconds, { kind: "set", raw: "1.000001" }));
  });
});
