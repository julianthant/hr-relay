import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { FrontendBootstrapWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { ServerClockWireSchema } from "../../../src/models/dashboard/bootstrap.js";
import { runtimeTimeZone } from "../../../src/rules/time/clock.js";

{

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const NOW = "2026-07-31T17:00:00.000Z";

const WORKFLOW_PRIMITIVE = {
  id: "onboarding",
  code: "on",
  label: "Onboarding",
  categoryId: "onboarding",
  descriptorFingerprint: HASH_A,
  availability: { state: "available" },
  role: { kind: "standalone" },

  start: {
    summary: "Look one person up in UCPath and CRM.",
    enqueue: "reject-active",


    version: 7,

    spreadsheetIntake: true,
    inputRun: {
      placeholder: "Enter EIDs or names, semicolon-separated",
      parser: {
        split: { kind: "delimited", delimiters: [";", "\n"] },
        rules: [{ when: { kind: "otherwise" }, emit: "query" }],
      },
    },
    steps: [
      {
        key: "identity",
        label: "Identity",
        includedByDefault: true,
        control: { state: "required", reason: "Identity is required." },
      },
      {
        key: "crm-dates",
        label: "CRM Dates",
        includedByDefault: false,
        control: { state: "selectable", inputField: "includeCrmDates" },
      },
    ],
  },
};

const BOOTSTRAP = {
  wireVersion: 1,
  appVersion: "1.0.0",
  descriptorHash: HASH_A,
  settingsSchemaHash: HASH_B,
  protectedSchemaHash: HASH_A,
  projectionGeneration: 1,
  actor: { id: "local-operator", label: "Local operator" },
  serverClock: { now: NOW, zone: "America/Los_Angeles" },
  storage: { authority: "healthy", backup: "current", checkedAt: NOW },
  workflows: [WORKFLOW_PRIMITIVE],
  systemInstances: [{ system: "ucpath", prod: "available", test: { state: "unavailable", code: "not-configured", reason: "test URL not configured" } }],
  settingsSections: [{ id: "general", label: "General", revision: 1 }],
  featureAvailability: [{ feature: "ocr", availability: { state: "available" } }],
};

describe("dashboard wire primitives", () => {

  it("refuses a served chunk harness whose composition is not in the same document", () => {
    const composition = {
      ...WORKFLOW_PRIMITIVE,
      id: "separations",
      code: "se",
      label: "Separations",
      role: { kind: "composition" },
    };
    const harness = {
      ...WORKFLOW_PRIMITIVE,
      id: "separations-kuali-read",
      code: "sk",
      label: "Separations — Kuali read",
      role: { kind: "chunk-harness", of: "separations", step: "kuali-extraction" },
    };

    assert.equal(
      FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, workflows: [composition, harness] }).success,
      true,
    );

    const dangling = FrontendBootstrapWireSchema.safeParse({ ...BOOTSTRAP, workflows: [harness] });
    assert.equal(dangling.success, false);
    assert.match(
      JSON.stringify(dangling.error?.issues ?? []),
      /separations-kuali-read is served as a chunk harness of separations/,
    );

    assert.equal(
      FrontendBootstrapWireSchema.safeParse({
        ...BOOTSTRAP,
        workflows: [{ ...composition, role: { kind: "standalone" } }, harness],
      }).success,
      false,
    );


    assert.equal(
      FrontendBootstrapWireSchema.safeParse({
        ...BOOTSTRAP,
        workflows: [{ ...WORKFLOW_PRIMITIVE, role: { kind: "sub-workflow" } }],
      }).success,
      false,
    );
    assert.equal(
      FrontendBootstrapWireSchema.safeParse({
        ...BOOTSTRAP,
        workflows: [{ ...WORKFLOW_PRIMITIVE, role: { kind: "standalone", of: "separations" } }],
      }).success,
      false,
    );
  });
});
}

{

describe("Activity volume range policy and boundary skeleton", () => {

  it("shares the runtime's resolved IANA zone with the bootstrap clock contract", () => {
    const timeZone = runtimeTimeZone();
    assert.equal(timeZone, new Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(ServerClockWireSchema.safeParse({ now: "2026-09-26T06:30:00.000Z", zone: timeZone }).success, true);
    assert.equal(ServerClockWireSchema.safeParse({ now: "2026-09-26T06:30:00.000Z", zone: "Mars/Olympus" }).success, false);
  });
});
}
