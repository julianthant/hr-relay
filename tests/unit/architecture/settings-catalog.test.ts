import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "vitest";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";
import { ConfigSchema, SettingsOverrideSchema } from "../../../src/domain/config/schema.js";
import { ProtectedValueSchemas } from "../../../src/domain/config/protected-settings.js";
import { SECRET_FAMILY_SPECS, SECRET_FILE_SPECS, SECRET_SPECS, TEST_TARGET_SECRET_SPECS } from "../../../src/domain/secrets.js";
import {
  SETTINGS_CATALOG,
  SettingsCatalogRowSchema,
  SettingsCatalogSchema,
  settingsCatalogRow,
  ordinarySettingsObject,
} from "../../../src/domain/config/catalog.js";

function schemaLeaves(schema: JSONSchema.JSONSchema | boolean, prefix = ""): string[] {
  if (typeof schema === "boolean") throw new Error(`unexpected boolean schema at ${prefix}`);
  if (schema.type !== "object") return [prefix];
  const leaves = Object.entries(schema.properties ?? {}).flatMap(([key, child]) =>
    schemaLeaves(child, prefix === "" ? key : `${prefix}.${key}`));
  if (typeof schema.additionalProperties === "object") {
    leaves.push(...schemaLeaves(schema.additionalProperties, `${prefix}.*`));
  }
  return leaves;
}

function coverageViolations(leaves: readonly string[]): readonly string[] {
  const rows = SETTINGS_CATALOG.filter((row) => row.sourceClass === "ordinary-settings"
    || (row.sourceClass === "runtime-isolation" && row.editability === "deployment"));
  const matches = (key: string, leaf: string) => leaf === key || leaf.startsWith(`${key}.`);
  return [
    ...leaves.filter((leaf) => rows.filter((row) => matches(row.key, leaf)).length !== 1),
    ...rows.filter((row) => !leaves.some((leaf) => matches(row.key, leaf))).map((row) => row.key),
  ];
}

function assertRecursivelyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) assertRecursivelyFrozen(Reflect.get(value, key));
}

describe("D331 settings catalog", () => {
  it("P1 covers every schema leaf and every secret family in both directions", () => {
    const leaves = schemaLeaves(z.toJSONSchema(ConfigSchema));
    assert.deepEqual(coverageViolations(leaves), []);
    assert.deepEqual(coverageViolations([...leaves, "uncatalogued.setting"]), ["uncatalogued.setting"]);
    assert.deepEqual(coverageViolations(leaves.filter((leaf) => leaf !== "actor.label")), ["actor.label"]);
    const external = [...SECRET_SPECS, ...TEST_TARGET_SECRET_SPECS, ...SECRET_FAMILY_SPECS, ...SECRET_FILE_SPECS]
      .map((spec) => spec.name);
    assert.deepEqual(SETTINGS_CATALOG.filter((row) => !["ordinary-settings", "runtime-isolation", "derived-host"].includes(row.sourceClass))
      .map((row) => row.key).filter((key) => key !== "activityPersonPseudonym").sort(),
    external.filter((key) => key !== "duoWebauthnCredential").sort());
    assert.deepEqual(SETTINGS_CATALOG.filter((row) => row.sourceClass === "protected-store")
      .map((row) => row.key).sort(), Object.keys(ProtectedValueSchemas).sort());
  });

  it("P5/P8 generates exactly ordinary document members with no protected leaf", () => {
    const ordinary = schemaLeaves(z.toJSONSchema(SettingsOverrideSchema));
    const expected = schemaLeaves(z.toJSONSchema(ConfigSchema)).filter((leaf) =>
      SETTINGS_CATALOG.some((row) => row.sourceClass === "ordinary-settings"
        && (leaf === row.key || leaf.startsWith(`${row.key}.`))));
    assert.deepEqual(ordinary.sort(), expected.sort());
    assert.equal(ordinary.includes("operator.timekeeperName"), false);
    assert.equal(SettingsOverrideSchema.safeParse({ operator: { timekeeperName: "synthetic-name" } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ paths: { stateRoot: "/tmp/foreign-root" } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ urls: { kuali: { prod: { entry: "https://example.invalid" } } } }).success, false);
    assert.throws(() => ordinarySettingsObject("actor", z.strictObject({ id: z.string() })), /actor.label is missing/u);
  });
  it("P1 pins the 88-row closed registry and refuses a missing or duplicated row", () => {
    assert.equal(SETTINGS_CATALOG.length, 88);
    assert.deepEqual(Object.fromEntries([
      "ordinary-settings", "protected-store", "provider-env", "derived-host", "runtime-isolation",
    ].map((sourceClass) => [sourceClass, SETTINGS_CATALOG.filter((row) => row.sourceClass === sourceClass).length])), {
      "ordinary-settings": 59,
      "protected-store": 7,
      "provider-env": 5,
      "derived-host": 1,
      "runtime-isolation": 16,
    });
    assert.equal(SettingsCatalogSchema.safeParse(SETTINGS_CATALOG.slice(1)).success, false);
    assert.equal(SettingsCatalogSchema.safeParse([...SETTINGS_CATALOG.slice(1), SETTINGS_CATALOG[1]]).success, false);
    assert.equal(SettingsCatalogRowSchema.safeParse({ ...SETTINGS_CATALOG[0], key: "unregistered.leaf" }).success, false);
    assert.throws(() => settingsCatalogRow("unregistered.leaf"), /settings catalog has no key unregistered.leaf/u);
    assertRecursivelyFrozen(SETTINGS_CATALOG);
  });

  it("P2 refuses every protected, provider and observed value in the ordinary document", () => {
    const protectedRows = SETTINGS_CATALOG.filter((row) => row.sourceClass === "protected-store");
    assert.equal(protectedRows.length, 7);
    for (const row of SETTINGS_CATALOG.filter((row) => row.sensitivity !== "ordinary")) {
      const parsed = SettingsCatalogRowSchema.safeParse({ ...row, sourceClass: "ordinary-settings" });
      assert.equal(parsed.success, false, row.key);
      if (!parsed.success) assert.match(parsed.error.message, new RegExp(row.key));
    }
    assert.equal(SettingsCatalogRowSchema.safeParse({
      ...settingsCatalogRow("ucpathPassword"), editability: "deployment",
    }).success, false);
    assert.deepEqual(SETTINGS_CATALOG.filter((row) => row.sensitivity === "protected-secret"
      && row.sourceClass === "runtime-isolation").map((row) => row.key), ["duoWebauthnCredential"]);
  });

  it("P2 names only existing consumer modules", () => {
    for (const row of SETTINGS_CATALOG) {
      for (const consumer of row.consumers) {
        assert.equal(existsSync(consumer.module), true, `${row.key}: ${consumer.module}`);
      }
    }
  });

  it("P33 assigns protected credentials next-use and canaries next-start", () => {
    for (const name of ["ucpathUserId", "ucpathPassword", "timekeeperName", "sharepointOnboardingRosterUrl", "activityPersonPseudonym"]) {
      assert.equal(settingsCatalogRow(name).restartScope, "next-use", name);
    }
    for (const name of ["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]) {
      assert.equal(settingsCatalogRow(name).restartScope, "next-start", name);
    }
    for (const row of SETTINGS_CATALOG.filter((row) => row.sourceClass === "ordinary-settings")) {
      assert.equal(row.restartScope, "generation", row.key);
    }
    assert.equal(settingsCatalogRow("display").restartScope, "process");
  });
});
