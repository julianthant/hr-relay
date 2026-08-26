import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import {
  readTestTargetRegistry,
  resolveSeparationsKualiFinalizationTestTarget,
  TEST_TARGET_REGISTRY,
  type TestTargetManifestView,
} from "../../../src/control/test-target-registry.js";
import { REPO_ROOT } from "./helpers/guard-files.js";

const MANIFEST_PATH = "tests/scenario/workflows/separations-kuali-finalization/dry-run.scenario.ts";

function namedProperty(object: ts.ObjectLiteralExpression, name: string): ts.Expression {
  const matches = object.properties.filter((property): property is ts.PropertyAssignment =>
    ts.isPropertyAssignment(property)
    && ((ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) && property.name.text === name));
  const only = matches[0];
  if (matches.length !== 1 || only === undefined) {
    throw new Error(`${MANIFEST_PATH} must declare exactly one ${name} property in the inspected object`);
  }
  return only.initializer;
}

function stringLiteral(expression: ts.Expression, name: string): string {
  if (!ts.isStringLiteralLike(expression)) {
    throw new Error(`${MANIFEST_PATH} ${name} must be a direct string literal`);
  }
  return expression.text;
}

/**
 * T1b manifests may not be imported by a Vitest-collected file. Inspect the
 * declaration as source data so this guard can still check registry parity.
 */
function manifestView(): TestTargetManifestView {
  const source = ts.createSourceFile(
    MANIFEST_PATH,
    readFileSync(join(REPO_ROOT, MANIFEST_PATH), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let manifest: ts.ObjectLiteralExpression | undefined;
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "MANIFEST"
      && node.initializer !== undefined
      && ts.isObjectLiteralExpression(node.initializer)) {
      manifest = node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (manifest === undefined) throw new Error(`${MANIFEST_PATH} has no direct MANIFEST object declaration`);

  const workflow = stringLiteral(namedProperty(manifest, "workflow"), "workflow");
  const casesExpression = namedProperty(manifest, "cases");
  if (!ts.isArrayLiteralExpression(casesExpression)) {
    throw new Error(`${MANIFEST_PATH} cases must be a direct array literal`);
  }
  const cases = casesExpression.elements.map((element, index) => {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error(`${MANIFEST_PATH} case ${String(index)} must be a direct object literal`);
    }
    return {
      subjectLabel: stringLiteral(namedProperty(element, "subjectLabel"), `case ${String(index)} subjectLabel`),
      subjectKind: stringLiteral(namedProperty(element, "subjectKind"), `case ${String(index)} subjectKind`),
    };
  });
  return { workflow, cases };
}

describe("test target registry architecture", () => {
  it("registers every dry-run manifest label with the same workflow and kind", () => {
    const manifest = manifestView();
    const registry = readTestTargetRegistry(REPO_ROOT, [manifest]);
    const registered = registry.targets.map(({ label }) => label).sort();
    const declared = manifest.cases.map(({ subjectLabel }) => subjectLabel).sort();
    assert.deepEqual(registered, declared);
  });

  it("keeps the ordinary finalization canary unavailable before 2026-08-28", () => {
    const canary = TEST_TARGET_REGISTRY.targets.find(({ label }) => label === "finalization-canary");
    assert.deepEqual(canary?.availability, {
      state: "unknown",
      lastObserved: "2026-08-19",
      reason: "Doc 4537 was open when observed, but its UCPath termination cannot be filed before 2026-08-28 and no real finalization transaction number exists yet.",
    });
  });

  it("blocks every currently declared label before consulting a live EID", () => {
    const resolutions = TEST_TARGET_REGISTRY.targets.map(({ label }) =>
      resolveSeparationsKualiFinalizationTestTarget(TEST_TARGET_REGISTRY, label, {
        HRAUTO_TEST_SUBJECT_SEPARATIONS_KUALI_FINALIZATION_CANARY_EID: "MUST_NOT_BE_READ",
      }));
    assert.equal(resolutions.every(({ state }) => state === "blocked"), true);
  });

  it("keeps EID-bearing canonical leaves out of every public config entry", () => {
    const publicKeys = TEST_TARGET_REGISTRY.targets.flatMap(({ publicInput }) => Object.keys(publicInput));
    assert.equal(publicKeys.includes("emplId"), false);
    assert.equal(publicKeys.includes("documentEid"), false);
  });

  it("exports a recursively frozen committed registry", () => {
    assert.equal(Object.isFrozen(TEST_TARGET_REGISTRY), true);
    assert.equal(Object.isFrozen(TEST_TARGET_REGISTRY.targets), true);
    assert.equal(TEST_TARGET_REGISTRY.targets.every((target) =>
      Object.isFrozen(target) && Object.isFrozen(target.publicInput)), true);
  });
});
