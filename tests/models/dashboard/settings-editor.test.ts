import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0,vi } from "vitest";
import { EditableSettingsWireSchema as EditableSettingsWireSchema_m0 } from "../../../src/models/dashboard/settings-editor.js";
import { FIXTURE_EDITABLE_SETTINGS as FIXTURE_EDITABLE_SETTINGS_m1 } from "../../parity/helpers/fixture-settings.js";
import { fixtureSettingsDocument as fixtureSettingsDocument_m0 } from "../../support/fixtures/dashboard/fixture-settings.js";
// @vitest-environment jsdom
import assert_m1 from "node:assert/strict";
import { act as act_m1 } from "react";
import { type Root as Root_m1 } from "react-dom/client";
import { afterEach as afterEach_m1,describe as describe_m1,it as it_m1 } from "vitest";
import {
EditableSettingsLeafWireSchema as EditableSettingsLeafWireSchema_m1,
EditableSettingsWireSchema as EditableSettingsWireSchema_m1
} from "../../../src/models/dashboard/settings-editor.js";


{

describe_m0("complete Settings catalog projection", () => {
  for (const mutation of ["missing", "duplicate", "classification", "wrong-section", "wrong-type", "wrong-control", "wrong-current-year", "legacy-readback"] as const) {
    it_m0(`rejects ${mutation} payloads`, () => {
      const document = fixtureSettingsDocument_m0();
      const general = document.sections.find(section => section.id === "general");
      const label = general?.leaves.find(leaf => leaf.path === "actor.label");
      assert_m0.ok(general && label);
      switch (mutation) {
        case "missing": general.leaves.splice(general.leaves.indexOf(label), 1); break;
        case "duplicate": general.leaves.push(label); break;
        case "classification": document.catalog[0].sourceClass = "ordinary-settings"; break;
        case "wrong-section": document.sections.find(section => section.id === "paths")?.leaves.push(general.leaves.shift()!); break;
        case "wrong-type": label.effectiveValue = 42; break;
        case "wrong-control": label.control = { input: "number", minimum: 0 }; break;
        case "wrong-current-year": {
          const annual = document.sections.flatMap(section => section.leaves).find(leaf => leaf.path.startsWith("annualDates."));
          assert_m0.ok(annual); annual.path = "annualDates.FY2028.jobEndDate"; break;
        }
        case "legacy-readback": {
          assert_m0.equal(document.protectedSettings.state, "available");
          if (document.protectedSettings.state !== "available") throw new Error("fixture unavailable");
          Reflect.set(document.protectedSettings.readback.entries, "personLookupCanaryEid", { present: false }); break;
        }
      }
      assert_m0.equal(EditableSettingsWireSchema_m0.safeParse(document).success, false);
    });
  }
});
}

{


Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const DOCUMENT = FIXTURE_EDITABLE_SETTINGS_m1;
let root: Root_m1 | undefined;
let host: HTMLElement | undefined;

const _afterEachFixture0 = () => {
  if (root !== undefined) act_m1(() => { root?.unmount(); });
  host?.remove();
  vi.useRealTimers();
  root = undefined;
  host = undefined;
};

describe_m1("editable Settings surface", () => {
afterEach_m1(_afterEachFixture0);

  it_m1("refuses a malformed server settings inventory instead of retyping, relocating, or contradicting its runtime identity", () => {
    const textLeafWithNumberPath = {
      ...DOCUMENT.sections[0]?.leaves[0],
      path: "ocr.pageConcurrency",
    };
    assert_m1.equal(EditableSettingsLeafWireSchema_m1.safeParse(textLeafWithNumberPath).success, false);

    const relocated = structuredClone(DOCUMENT);
    const general = relocated.sections.find((candidate) => candidate.id === "general");
    const paths = relocated.sections.find((candidate) => candidate.id === "paths");
    if (general === undefined || paths === undefined) throw new Error("test document omitted text settings sections");
    [general.leaves[0], paths.leaves[0]] = [paths.leaves[0], general.leaves[0]];
    assert_m1.equal(EditableSettingsWireSchema_m1.safeParse(relocated).success, false);

    const wrongPersisted = { ...structuredClone(DOCUMENT), revision: 2 };
    assert_m1.equal(EditableSettingsWireSchema_m1.safeParse(wrongPersisted).success, false);

    const wrongActive = { ...structuredClone(DOCUMENT), activeConfigFingerprint: "d".repeat(64) };
    assert_m1.equal(EditableSettingsWireSchema_m1.safeParse(wrongActive).success, false);

    const defaultWithPersistedValue = {
      ...DOCUMENT.sections[0]?.leaves[0],
      settingsValue: "unexpected persisted value",
    };
    assert_m1.equal(EditableSettingsLeafWireSchema_m1.safeParse(defaultWithPersistedValue).success, false);
    assert_m1.equal(EditableSettingsLeafWireSchema_m1.safeParse({
      ...DOCUMENT.sections[0]?.leaves[0],
      source: "settings",
    }).success, false, "settings provenance must carry its persisted value");

    const duplicateSection = structuredClone(DOCUMENT);
    const pathsSection = duplicateSection.sections.find((candidate) => candidate.id === "paths");
    if (pathsSection === undefined) throw new Error("test document omitted paths section");
    pathsSection.id = "general";
    const duplicateSectionResult = EditableSettingsWireSchema_m1.safeParse(duplicateSection);
    assert_m1.equal(duplicateSectionResult.success, false);
    if (duplicateSectionResult.success) throw new Error("duplicate section id parsed as a settings document");
    assert_m1.ok(duplicateSectionResult.error.issues.some((issue) => issue.message.includes("repeats section general")));
  });
});
}
