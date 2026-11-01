import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { z } from "zod";
import type { JSONSchema } from "zod/v4/core";
import { ConfigSchema, PROVIDER_CAPABILITY_CONFIG_KEYS, SettingsOverrideSchema } from "../../../src/models/config/schema.js";
import { ProtectedValueSchemas } from "../../../src/models/config/protected-settings.js";
import { SECRET_SPECS } from "../../../src/models/config/secrets.js";
import { RUNTIME_DEPENDENCY_REGISTRY } from "../../../src/models/runtime/runtime-dependencies.js";
import { MIGRATED_SETTINGS_ENVIRONMENT_KEYS, RETIRED_TEST_TARGET_ENVIRONMENT_KEYS, SETTINGS_CATALOG, SettingsCatalogRowSchema, SettingsCatalogSchema, settingsCatalogRow, ordinarySettingsObject } from "../../../src/models/config/catalog.js";
import { gitVisibleFiles, REPO_ROOT, repoRelative } from "../support/helpers/guard-files.js";

interface ReaderCatalogRow {
  readonly key: string;
  readonly sourceClass: string;
  readonly defaultKind: string;
  readonly restartScope: string;
  readonly sensitivity: string;
  readonly consumers: readonly Readonly<{ module: string }>[];
}

type ReaderInventory = ReadonlyMap<string, ReadonlySet<string>>;

interface ReaderRule {
  readonly declaration: string;
  readonly keys: readonly string[];
}

function productionDeclarations(): ReadonlyMap<string, readonly string[]> {
  const modulesByDeclaration = new Map<string, Set<string>>();
  for (const relative of gitVisibleFiles(["src"]).filter((path) => /\.tsx?$/u.test(path))) {
    const absolute = resolve(REPO_ROOT, relative);
    const source = ts.createSourceFile(
      absolute,
      readFileSync(absolute, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      relative.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    function add(name: ts.BindingName | ts.DeclarationName | undefined): void {
      if (name === undefined || !ts.isIdentifier(name)) return;
      const modules = modulesByDeclaration.get(name.text) ?? new Set<string>();
      modules.add(repoRelative(absolute));
      modulesByDeclaration.set(name.text, modules);
    }
    function visit(node: ts.Node): void {
      if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isVariableDeclaration(node)) {
        add(node.name);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return new Map([...modulesByDeclaration].map(([name, modules]) => [name, [...modules].sort()]));
}


function readerRules(rows: readonly ReaderCatalogRow[]): readonly ReaderRule[] {
  const ordinaryComposition = rows.filter((row) =>
    (row.sourceClass === "ordinary-settings" && !row.key.startsWith("providers."))
    || (row.sourceClass === "runtime-isolation" && row.sensitivity === "ordinary")
    || row.sourceClass === "derived-host"
  ).map(({ key }) => key);
  // Runtime-path defaults and provider accessors have their own direct source
  // owners below; the resolver's structural Config pass is not double-counted.
  const settingsReadback = rows.filter((row) =>
    (row.sourceClass === "ordinary-settings" && row.defaultKind !== "runtime-path")
    || (row.sourceClass === "runtime-isolation" && row.defaultKind === "contract")
  ).map(({ key }) => key);

  const protectedReadback = rows.filter((row) =>
    row.sourceClass === "protected-store"
  ).map(({ key }) => key);
  const dependencySecretNames = RUNTIME_DEPENDENCY_REGISTRY.dependencies
    .flatMap(({ secretNames }) => secretNames ?? []);

  return [
    { declaration: "resolveConfigWithProvenance", keys: ordinaryComposition },
    { declaration: "createSettingsRuntimeReader", keys: settingsReadback },
    { declaration: "createProtectedSettingsRuntimeReader", keys: protectedReadback },
    { declaration: "defaultRuntimePaths", keys: rows.filter(({ defaultKind }) => defaultKind === "runtime-path").map(({ key }) => key) },
    { declaration: "providerInvocationConfig", keys: Object.values(PROVIDER_CAPABILITY_CONFIG_KEYS).map((key) => `providers.${key}`) },
    { declaration: "optionalSecret", keys: SECRET_SPECS.map(({ name }) => name) },
    { declaration: "RUNTIME_DEPENDENCY_REGISTRY", keys: dependencySecretNames },
    { declaration: "establishHostPrimaryDisplay", keys: rows.filter(({ sourceClass }) => sourceClass === "derived-host").map(({ key }) => key) },
  ];
}

function deriveSettingsReaderInventory(rows: readonly ReaderCatalogRow[]): ReaderInventory {
  const declarations = productionDeclarations();
  const readers = new Map<string, Set<string>>();
  for (const rule of readerRules(rows)) {
    const modules = declarations.get(rule.declaration) ?? [];
    if (modules.length !== 1) {
      throw new Error(`settings reader declaration ${rule.declaration} resolved ${String(modules.length)} production modules`);
    }
    const module = modules[0];
    if (module === undefined) throw new Error(`settings reader declaration ${rule.declaration} has no module`);
    for (const key of rule.keys) {
      const keyReaders = readers.get(key) ?? new Set<string>();
      keyReaders.add(module);
      readers.set(key, keyReaders);
    }
  }
  return readers;
}

function readerInventoryViolations(rows: readonly ReaderCatalogRow[], readers: ReaderInventory): readonly string[] {
  const violations: string[] = [];
  const declared = new Map(rows.map((row) => [row.key, new Set(row.consumers.map(({ module }) => module))]));
  for (const row of rows) {
    const actual = readers.get(row.key) ?? new Set<string>();
    for (const module of declared.get(row.key) ?? []) {
      if (!actual.has(module)) violations.push(`${row.key}: catalog consumer ${module} has no reader evidence`);
    }
  }
  for (const [key, modules] of readers) {
    for (const module of modules) {
      if (!declared.get(key)?.has(module)) violations.push(`${key}: source reader ${module} is missing from consumers`);
    }
  }
  return violations.sort();
}

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

describe("settings catalog", () => {
  it("covers every schema leaf and every secret family in both directions", () => {
    const leaves = schemaLeaves(z.toJSONSchema(ConfigSchema));
    assert.deepEqual(coverageViolations(leaves), []);
    assert.deepEqual(coverageViolations([...leaves, "uncatalogued.setting"]), ["uncatalogued.setting"]);
    assert.deepEqual(coverageViolations(leaves.filter((leaf) => leaf !== "actor.label")), ["actor.label"]);
    const external = SECRET_SPECS
      .map((spec) => spec.name);
    assert.deepEqual(SETTINGS_CATALOG.filter((row) => !["ordinary-settings", "runtime-isolation", "derived-host"].includes(row.sourceClass))
      .map((row) => row.key).filter((key) => key !== "activityPersonPseudonym").sort(),
    external.sort());
    assert.deepEqual(SETTINGS_CATALOG.filter((row) => row.sourceClass === "protected-store")
      .map((row) => row.key).sort(), Object.keys(ProtectedValueSchemas).sort());
  });

  it("generates exactly ordinary document members with no protected leaf", () => {
    const ordinary = schemaLeaves(z.toJSONSchema(SettingsOverrideSchema)).filter((leaf) => !leaf.includes(".test."));
    const expected = schemaLeaves(z.toJSONSchema(ConfigSchema)).filter((leaf) =>
      SETTINGS_CATALOG.some((row) => row.sourceClass === "ordinary-settings"
        && (leaf === row.key || leaf.startsWith(`${row.key}.`))));
    assert.deepEqual(ordinary.sort(), expected.sort());
    assert.equal(ordinary.includes("operator.timekeeperName"), false);
    assert.equal(SettingsOverrideSchema.safeParse({ operator: { timekeeperName: "synthetic-name" } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ paths: { stateRoot: "/tmp/foreign-root" } }).success, false);
    assert.equal(SettingsOverrideSchema.safeParse({ urls: { kuali: { prod: { entry: "https://example.invalid" } } } }).success, true);
    assert.equal(SettingsOverrideSchema.safeParse({ urls: { kuali: { test: { entry: "https://example.invalid" } } } }).success, true);
    assert.throws(() => ordinarySettingsObject("actor", z.strictObject({ id: z.string() })), /actor.label is missing/u);
  });
  it("pins the 63-row closed registry and refuses a missing or duplicated row", () => {
    assert.equal(SETTINGS_CATALOG.length, 63);
    assert.deepEqual(Object.fromEntries([
      "ordinary-settings", "protected-store", "derived-host", "runtime-isolation",
    ].map((sourceClass) => [sourceClass, SETTINGS_CATALOG.filter((row) => row.sourceClass === sourceClass).length])), {
      "ordinary-settings": 54,
      "protected-store": 5,
      "derived-host": 1,
      "runtime-isolation": 3,
    });
    assert.equal(SettingsCatalogSchema.safeParse(SETTINGS_CATALOG.slice(1)).success, false);
    assert.equal(SettingsCatalogSchema.safeParse([...SETTINGS_CATALOG.slice(1), SETTINGS_CATALOG[1]]).success, false);
    assert.equal(SettingsCatalogRowSchema.safeParse({ ...SETTINGS_CATALOG[0], key: "unregistered.leaf" }).success, false);
    assert.throws(() => settingsCatalogRow("unregistered.leaf"), /settings catalog has no key unregistered.leaf/u);
    assertRecursivelyFrozen(SETTINGS_CATALOG);
  });

  it("refuses every protected, provider and observed value in the ordinary document", () => {
    const protectedRows = SETTINGS_CATALOG.filter((row) => row.sourceClass === "protected-store");
    assert.equal(protectedRows.length, 5);
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

  it("matches the production settings-source reader inventory in both directions", () => {
    const readers = deriveSettingsReaderInventory(SETTINGS_CATALOG);
    assert.deepEqual(readerInventoryViolations(SETTINGS_CATALOG, readers), []);

    const dropped = SETTINGS_CATALOG.map((row) => row.key === "actor.label"
      ? { ...row, consumers: row.consumers.filter(({ module }) => module !== "src/backend/app/config/resolve.ts") }
      : row);
    assert.deepEqual(readerInventoryViolations(dropped, readers), [
      "actor.label: source reader src/backend/app/config/resolve.ts is missing from consumers",
    ]);
  });

  it("assigns protected credentials next-use and refuses canary environment keys", () => {
    for (const name of ["ucpathUserId", "ucpathPassword", "timekeeperName", "sharepointOnboardingRosterUrl", "activityPersonPseudonym"]) {
      assert.equal(settingsCatalogRow(name).restartScope, "next-use", name);
    }
    for (const name of ["separationsKualiFinalizationCanaryDocumentNumber", "personLookupCanaryEid"]) {
      assert.throws(() => settingsCatalogRow(name), new RegExp(`settings catalog has no key ${name}`, "u"));
    }
    assert.equal(SETTINGS_CATALOG.some((row) => row.restartScope === "next-start"), false);
    assert.deepEqual([...RETIRED_TEST_TARGET_ENVIRONMENT_KEYS], [
      "HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_DOCUMENT_NUMBER",
      "HRAUTO_TEST_SUBJECT_PERSON_LOOKUP_CANARY_EID",
    ]);
    for (const key of RETIRED_TEST_TARGET_ENVIRONMENT_KEYS) {
      assert.equal(MIGRATED_SETTINGS_ENVIRONMENT_KEYS.includes(key), true, key);
      assert.equal(SETTINGS_CATALOG.some((row) => row.currentSource.some((source) => source.kind === "env" && (source.name as string) === key)), false, key);
    }
    for (const row of SETTINGS_CATALOG.filter((row) => row.sourceClass === "ordinary-settings")) {
      assert.equal(row.restartScope, "generation", row.key);
    }
    assert.equal(settingsCatalogRow("display").restartScope, "process");
  });
});
