import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, it } from "vitest";
import { GENERATED_BUILD_MANIFEST } from "../../../src/domain/workflow/generated-build-manifest.js";
import {
  readTestTargetRegistry,
  resolveSeparationsKualiFinalizationTestTarget,
  TEST_TARGET_REGISTRY,
  type TestTargetManifestView,
} from "../../../src/control/test-target-registry.js";
import { REPO_ROOT } from "./helpers/guard-files.js";

const MANIFEST_PATH = "tests/scenario/workflows/separations-kuali-finalization/dry-run.scenario.ts";
const PHASE_DOC_PATH = "docs/rebuild/03b-finish-separations.md";
/** The one order-8 status line that names the mapped inventory in prose. */
const INVENTORY_LINE_MARKER = "the subject/canary inventory mapped live and dated";

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

/**
 * The doc side of the registry pin. Doc 03b no longer carries the table — it
 * carries ONE status line naming every Kuali document this migration mapped,
 * and `config/test-subjects.json` must hold exactly that set, in both
 * directions. A document that quietly leaves either side is the drift the
 * registry exists to prevent (§9.16 recorded two canaries evaporating).
 */
function documentNumbersNamedByPhaseDoc(): readonly string[] {
  const lines = readFileSync(join(REPO_ROOT, PHASE_DOC_PATH), "utf8").split("\n");
  const matches = lines.filter((line) => line.includes(INVENTORY_LINE_MARKER));
  const only = matches[0];
  if (matches.length !== 1 || only === undefined) {
    throw new Error(`${PHASE_DOC_PATH} must name the mapped canary inventory on exactly one line`);
  }
  const numbers = only.match(/\b4\d{3}\b/g);
  if (numbers === null) {
    throw new Error(`${PHASE_DOC_PATH} inventory line names no Kuali document number`);
  }
  return [...new Set(numbers)].sort();
}

function documentNumbersRegisteredInConfig(): readonly string[] {
  const numbers = TEST_TARGET_REGISTRY.targets.flatMap((target) => {
    if (target.workflow === "separations") {
      return target.publicInput.document.state === "present"
        ? [target.publicInput.document.documentNumber]
        : [];
    }
    const declared = target.publicInput.documentNumber;
    return declared === undefined ? [] : [declared];
  });
  return [...new Set(numbers)].sort();
}

describe("test target registry architecture", () => {
  it("registers every dry-run manifest label with the same workflow and kind, and admits no other unmapped label but a separations chain entry", () => {
    const manifest = manifestView();
    const registry = readTestTargetRegistry(REPO_ROOT, [manifest]);
    const manifestLabels = new Set(manifest.cases.map(({ subjectLabel }) => subjectLabel));
    const registered = new Set(registry.targets.map(({ label }) => label));
    for (const { subjectLabel } of manifest.cases) {
      assert.equal(registered.has(subjectLabel), true, `manifest label ${subjectLabel} is unregistered`);
    }
    assert.equal(manifest.cases.length > 0, true);

    // The other direction: a registry label with no manifest case must belong
    // to the separations chain (which has no dry-run manifest of its own) —
    // an orphaned finalization entry with no manifest case must fail here.
    const unmatched = registry.targets.filter((target) => !manifestLabels.has(target.label));
    for (const target of unmatched) {
      assert.equal(
        target.workflow,
        "separations",
        `registry label ${target.label} has no manifest case and is not a separations chain entry`,
      );
    }
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
    const resolutions = TEST_TARGET_REGISTRY.targets
      .filter(({ workflow }) => workflow === "separations-kuali-finalization")
      .map(({ label }) =>
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

  it("registers exactly the Kuali documents doc 03b's inventory line names", () => {
    assert.deepEqual(documentNumbersRegisteredInConfig(), documentNumbersNamedByPhaseDoc());
  });

  it("gives every entry an owning workflow the build manifest actually built", () => {
    const built = new Set(GENERATED_BUILD_MANIFEST.workflows.map(({ id }) => id));
    for (const { label, workflow } of TEST_TARGET_REGISTRY.targets) {
      assert.equal(built.has(workflow), true, `test target ${label} names unbuilt workflow ${workflow}`);
    }
  });

  it("pins every separations chain subject to doc 03b's kind and availability", () => {
    const rows = TEST_TARGET_REGISTRY.targets
      .filter((target) => target.workflow === "separations")
      .map((target) => ({
        label: target.label,
        kind: target.kind,
        state: target.availability.state,
        lastObserved: target.availability.lastObserved,
        document: target.publicInput.document.state === "present"
          ? target.publicInput.document.documentNumber
          : "none",
      }))
      .sort((left, right) => left.label.localeCompare(right.label));
    assert.deepEqual(rows, [
      {
        label: "separations-controlled-commit-candidate",
        kind: "controlled-commit-candidate",
        state: "gone",
        lastObserved: "2026-08-14",
        document: "4524",
      },
      {
        label: "separations-dry-run-subject",
        kind: "full-chain-dry-run",
        state: "available",
        lastObserved: "2026-08-20",
        document: "4502",
      },
      {
        label: "separations-future-dated",
        kind: "future-dated",
        state: "available",
        lastObserved: "2026-08-19",
        document: "4495",
      },
      {
        label: "separations-pending-termination",
        kind: "pending-termination",
        state: "unknown",
        lastObserved: "2026-08-19",
        document: "none",
      },
    ]);
  });

  it("refuses to resolve a label owned by another workflow instead of guessing", () => {
    const chain = TEST_TARGET_REGISTRY.targets.find(({ workflow }) => workflow === "separations");
    if (chain === undefined) throw new Error("the registry must carry at least one separations chain subject");
    assert.throws(
      () => resolveSeparationsKualiFinalizationTestTarget(TEST_TARGET_REGISTRY, chain.label, {}),
      /belongs to workflow separations, not separations-kuali-finalization/,
    );
  });

  it("gives every entry the purpose the registry exists to record", () => {
    for (const { label, purpose } of TEST_TARGET_REGISTRY.targets) {
      assert.equal(purpose.length > 0, true, `test target ${label} records no purpose`);
    }
  });
});
