import { vi } from "vitest";
// @vitest-environment jsdom
import { default as assert_m0,default as assert_m1 } from 'node:assert/strict';
import { act as act_m0 } from 'react';
import { afterEach as afterEach_m0,describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from 'vitest';
import { draftError as draftError_m1,patchFromSettingsDraft as patchFromSettingsDraft_m1,settingInput as settingInput_m0,settingInput as settingInput_m1,settingsSectionGroups as settingsSectionGroups_m1,valueFromSettingInput as valueFromSettingInput_m1 } from '../../../../../src/dashboard/surfaces/settings/editor/settings-draft-model.js';
import { performancePresentation as performancePresentation_m1,performanceSectionGroups as performanceSectionGroups_m1 } from "../../../../../src/dashboard/surfaces/settings/general/settings-performance-model.js";
import { settingNote as settingNote_m1,settingTitle as settingTitle_m1 } from "../../../../../src/dashboard/surfaces/settings/settings-presentation.js";
import type { EditableSettingsLeafWire as EditableSettingsLeafWire_m1 } from "../../../../../src/models/dashboard/settings-editor.js";
import { fixtureSettingsDocument as fixtureSettingsDocument_m1 } from "../../../../parity/helpers/fixture-settings.js";
import { mountSettingsHarness as mountSettingsHarness_m0,syntheticSettingsAuthority as syntheticSettingsAuthority_m0 } from '../../../../support/helpers/dashboard/settings-harness.js';

{

const cleanups: (() => void | Promise<void>)[] = [];
const _afterEachFixture0 = async () => { vi.useRealTimers(); for (const close of cleanups.splice(0).reverse()) await close(); };
describe_m0('confirmed Settings feedback through the current editor', () => {
afterEach_m0(_afterEachFixture0);

  it_m0('names atomic route saves with their visible system label', async () => {
    const authority = await syntheticSettingsAuthority_m0(); cleanups.push(authority.close);
    const { controller, notices, close } = await mountSettingsHarness_m0(authority); cleanups.push(close);
    vi.useFakeTimers();
    const leaf = controller().leaves.find(candidate => candidate.path === 'urls.crm.prod');
    assert_m0(leaf && typeof leaf.effectiveValue === 'object' && !Array.isArray(leaf.effectiveValue));
    const raw = settingInput_m0(leaf); assert_m0.notEqual(typeof raw, 'string');
    if (typeof raw === 'string') throw new Error('route-fixture-invalid');
    await act_m0(async () => controller().update(leaf.path, { ...raw, entry: 'https://crm.example.test/private-route-sentinel' }));
    await act_m0(async () => vi.advanceTimersByTimeAsync(701));
    assert_m0.equal(controller().save.state, 'applied');
    assert_m0.deepEqual(notices, [{ title: 'Saved CRM routes' }]);
    assert_m0.doesNotMatch(JSON.stringify(notices), /private-route-sentinel/);
  });

});
}

{

const performance = fixtureSettingsDocument_m1().sections.find(section => section.id === "performance");
if (performance === undefined) throw new Error("performance fixture section missing");
const performanceLeaves = performance.leaves;
const timeouts = performanceLeaves.filter(leaf => leaf.path.startsWith("timeouts."));
function leaf(path: string): EditableSettingsLeafWire_m1 {
  const found = timeouts.find(candidate => candidate.path === path);
  if (found === undefined) throw new Error(`timeout fixture leaf missing: ${path}`);
  return found;
}
function performanceLeaf(path: string): EditableSettingsLeafWire_m1 {
  const found = performanceLeaves.find(candidate => candidate.path === path);
  if (found === undefined) throw new Error(`performance fixture leaf missing: ${path}`);
  return found;
}

describe_m1("Performance timeout presentation", () => {
  it_m1("shows all ten timeout settings with descriptions and purpose groups", () => {
    assert_m1.equal(timeouts.length, 10);
    assert_m1.deepEqual(settingsSectionGroups_m1("performance", performance.leaves).slice(0, 3).map(group => [group.title, group.leaves.length]), [
      ["Navigation", 3], ["Work", 3], ["Sign-in & Duo", 4],
    ]);
    for (const item of timeouts) {
      assert_m1.ok(settingTitle_m1(item).length > 0);
      assert_m1.ok((settingNote_m1(item) ?? "").length > 0);
      assert_m1.equal(valueFromSettingInput_m1(item, settingInput_m1(item)), item.effectiveValue);
    }
    assert_m1.equal(settingTitle_m1(leaf("timeouts.navigationMs")), "Standard navigation");
    assert_m1.equal(settingTitle_m1(leaf("timeouts.duoApprovalCrmSeconds")), "CRM Duo approval");
  });

  it_m1("displays every duration in seconds and converts exactly to stored units", () => {
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
      assert_m1.equal(settingInput_m1(item), display);
      assert_m1.equal(valueFromSettingInput_m1(item, display), stored);
    }
    assert_m1.deepEqual(patchFromSettingsDraft_m1(timeouts, {
      "timeouts.taskMs": { kind: "set", raw: "3.5" },
      "timeouts.retryDelayMs": { kind: "set", raw: "0.125" },
    }), {
      "timeouts.taskMs": { set: 3_500 },
      "timeouts.retryDelayMs": { set: 125 },
    });
    assert_m1.ok(draftError_m1(leaf("timeouts.duoApprovalSeconds"), { kind: "set", raw: "2.5" }));
  });

  it_m1("preserves millisecond precision and refuses sub-millisecond or fractional-second input", () => {
    const task = { ...leaf("timeouts.taskMs"), effectiveValue: 181_001 };
    assert_m1.equal(settingInput_m1(task), "181.001");
    assert_m1.equal(valueFromSettingInput_m1(task, "181.001"), 181_001);
    const crm = leaf("timeouts.duoApprovalCrmSeconds");
    for (const raw of ["", "0", "0.001", "1.5", "1.", "3e2", "-1"]) {
      assert_m1.ok(draftError_m1(crm, { kind: "set", raw }), `accepted invalid seconds: ${raw}`);
    }
    assert_m1.ok(draftError_m1(task, { kind: "set", raw: "181.0001" }));
    assert_m1.ok(draftError_m1(task, { kind: "set", raw: "0.0001" }));
  });

  it_m1("groups every served additional limit and converts its durations exactly to seconds", () => {
    const groups = performanceSectionGroups_m1(performance.leaves);
    assert_m1.deepEqual(groups.map(group => [group.title, group.leaves.length]), [
      ["Navigation", 3], ["Work", 3], ["Sign-in & Duo", 4], ["Worker scheduling", 3],
      ["Retry & termination", 2], ["OCR processing", 9], ["Browser recovery", 4],
    ]);
    assert_m1.deepEqual(groups.flatMap(group => group.leaves.map(item => item.path)).sort(), performance.leaves.map(item => item.path).sort());
    for (const item of performance.leaves.filter(candidate => !candidate.path.startsWith("timeouts."))) {
      assert_m1.ok(performancePresentation_m1(item.path), `missing presentation: ${item.path}`);
      assert_m1.ok((settingNote_m1(item) ?? "").length > 0, `missing description: ${item.path}`);
    }
    for (const [path, display, stored] of [
      ["daemon.idleMs", "900", 900_000], ["daemon.idleRepollMs", "30", 30_000],
      ["ocr.pageMaxWaitMs", "120", 120_000], ["ocr.tier1PatienceMs", "90", 90_000],
      ["ocr.backoffBaseMs", "2", 2_000], ["ocr.backoffCapMs", "60", 60_000],
      ["browserHealth.monitorTickMs", "30", 30_000], ["browser.closeProofMs", "15", 15_000],
    ] as const) {
      const item = performanceLeaf(path);
      assert_m1.equal(settingInput_m1(item), display);
      assert_m1.equal(valueFromSettingInput_m1(item, display), stored);
      assert_m1.ok(draftError_m1(item, { kind: "set", raw: "0.0001" }));
    }
  });
});
}
