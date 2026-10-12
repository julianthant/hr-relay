import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { vi } from "vitest";
import { EditableSettingsWireSchema } from "../../../src/models/dashboard/settings-editor.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../parity/helpers/fixture-settings.js";
import { fixtureSettingsDocument } from "../../support/fixtures/dashboard/fixture-settings.js";
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach } from "vitest";
import { EditableSettingsLeafWireSchema } from "../../../src/models/dashboard/settings-editor.js";

{

describe("complete Settings catalog projection", () => {
  for (const mutation of ["missing", "duplicate", "classification", "wrong-section", "wrong-type", "wrong-control", "wrong-current-year", "legacy-readback"] as const) {
    it(`rejects ${mutation} payloads`, () => {
      const document = fixtureSettingsDocument();
      const general = document.sections.find(section => section.id === "general");
      const label = general?.leaves.find(leaf => leaf.path === "actor.label");
      assert.ok(general && label);
      switch (mutation) {
        case "missing": general.leaves.splice(general.leaves.indexOf(label), 1); break;
        case "duplicate": general.leaves.push(label); break;
        case "classification": document.catalog[0].sourceClass = "ordinary-settings"; break;
        case "wrong-section": document.sections.find(section => section.id === "paths")?.leaves.push(general.leaves.shift()!); break;
        case "wrong-type": label.effectiveValue = 42; break;
        case "wrong-control": label.control = { input: "number", minimum: 0 }; break;
        case "wrong-current-year": {
          const annual = document.sections.flatMap(section => section.leaves).find(leaf => leaf.path.startsWith("annualDates."));
          assert.ok(annual); annual.path = "annualDates.FY2028.jobEndDate"; break;
        }
        case "legacy-readback": {
          assert.equal(document.protectedSettings.state, "available");
          if (document.protectedSettings.state !== "available") throw new Error("fixture unavailable");
          Reflect.set(document.protectedSettings.readback.entries, "personLookupCanaryEid", { present: false }); break;
        }
      }
      assert.equal(EditableSettingsWireSchema.safeParse(document).success, false);
    });
  }
});
}

{

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const DOCUMENT = FIXTURE_EDITABLE_SETTINGS;
let root: Root | undefined;
let host: HTMLElement | undefined;

const _afterEachFixture0 = () => {
  if (root !== undefined) act(() => { root?.unmount(); });
  host?.remove();
  vi.useRealTimers();
  root = undefined;
  host = undefined;
};

describe("editable Settings surface", () => {
afterEach(_afterEachFixture0);

  it("refuses a malformed server settings inventory instead of retyping, relocating, or contradicting its runtime identity", () => {
    const textLeafWithNumberPath = {
      ...DOCUMENT.sections[0]?.leaves[0],
      path: "ocr.pageConcurrency",
    };
    assert.equal(EditableSettingsLeafWireSchema.safeParse(textLeafWithNumberPath).success, false);

    const relocated = structuredClone(DOCUMENT);
    const general = relocated.sections.find((candidate) => candidate.id === "general");
    const paths = relocated.sections.find((candidate) => candidate.id === "paths");
    if (general === undefined || paths === undefined) throw new Error("test document omitted text settings sections");
    [general.leaves[0], paths.leaves[0]] = [paths.leaves[0], general.leaves[0]];
    assert.equal(EditableSettingsWireSchema.safeParse(relocated).success, false);

    const wrongPersisted = { ...structuredClone(DOCUMENT), revision: 2 };
    assert.equal(EditableSettingsWireSchema.safeParse(wrongPersisted).success, false);

    const wrongActive = { ...structuredClone(DOCUMENT), activeConfigFingerprint: "d".repeat(64) };
    assert.equal(EditableSettingsWireSchema.safeParse(wrongActive).success, false);

    const defaultWithPersistedValue = {
      ...DOCUMENT.sections[0]?.leaves[0],
      settingsValue: "unexpected persisted value",
    };
    assert.equal(EditableSettingsLeafWireSchema.safeParse(defaultWithPersistedValue).success, false);
    assert.equal(EditableSettingsLeafWireSchema.safeParse({
      ...DOCUMENT.sections[0]?.leaves[0],
      source: "settings",
    }).success, false, "settings provenance must carry its persisted value");

    const duplicateSection = structuredClone(DOCUMENT);
    const pathsSection = duplicateSection.sections.find((candidate) => candidate.id === "paths");
    if (pathsSection === undefined) throw new Error("test document omitted paths section");
    pathsSection.id = "general";
    const duplicateSectionResult = EditableSettingsWireSchema.safeParse(duplicateSection);
    assert.equal(duplicateSectionResult.success, false);
    if (duplicateSectionResult.success) throw new Error("duplicate section id parsed as a settings document");
    assert.ok(duplicateSectionResult.error.issues.some((issue) => issue.message.includes("repeats section general")));
  });
});
}
