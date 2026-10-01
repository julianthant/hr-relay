import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { BrowserSystemIdSchema } from "../../src/domain/ids.js";
import { browserStoreRegistry } from "../../src/backend/app/task-registry.js";
import { REPO_ROOT } from "./helpers/guard-files.js";

interface BrowserDeclarationView {
  readonly namespace: string;
  readonly driverSystem: string;
  readonly sessionSystem: string;
  readonly exclusive: boolean;
}

export function auditBrowserDeclarations(
  declarations: readonly BrowserDeclarationView[],
): readonly string[] {
  const issues: string[] = [];
  const expected = new Set<string>(BrowserSystemIdSchema.options);
  const seen = new Set<string>();
  for (const declaration of declarations) {
    if (!expected.has(declaration.namespace)) issues.push(`unknown browser store ${declaration.namespace}`);
    if (seen.has(declaration.namespace)) issues.push(`duplicate browser store ${declaration.namespace}`);
    seen.add(declaration.namespace);
    if (declaration.driverSystem !== declaration.namespace) {
      issues.push(`${declaration.namespace} driver mismatch ${declaration.driverSystem}`);
    }
    if (declaration.sessionSystem !== declaration.namespace) {
      issues.push(`${declaration.namespace} session mismatch ${declaration.sessionSystem}`);
    }
    if (declaration.exclusive !== (declaration.namespace === "onbase")) {
      issues.push(`${declaration.namespace} violates OnBase-only exclusivity`);
    }
  }
  for (const system of expected) {
    if (!seen.has(system)) issues.push(`missing browser store ${system}`);
  }
  return issues;
}

describe("task/store/session declaration boundaries", () => {
  it("declares every browser system exactly once with matching driver/session and OnBase exclusivity", () => {
    const declarations = browserStoreRegistry.stores.map((store) => {
      assert.equal(store.kind, "browser");
      return {
        namespace: store.namespace,
        driverSystem: store.kind === "browser" ? store.driver.system : "headless",
        sessionSystem: store.kind === "browser" ? store.session.system : "headless",
        exclusive: store.kind === "browser" && store.session.exclusive === true,
      };
    });
    assert.deepEqual(auditBrowserDeclarations(declarations), []);
    for (const system of BrowserSystemIdSchema.options) {
      for (const file of ["store.ts", "session.ts"]) {
        assert.ok(existsSync(resolve(REPO_ROOT, "src/backend/systems", system, file)), `${system}/${file}`);
      }
    }
  });

  it("pins typed effect/session and capability narrowing at the authoring boundary", () => {
    const fixture = readFileSync(resolve(REPO_ROOT, "tests/types/task-contracts.typecheck.ts"), "utf8");
    assert.match(fixture, /read task implementations cannot request transaction access/u);
    assert.match(fixture, /provider clients are narrowed to the declared capability/u);
    assert.match(fixture, /ctx\.driver\.goto\(UCPATH_PERSON_ORG_SEARCH_SCREEN\)/u);
    assert.match(fixture, /UCPath task cannot bind a CRM driver/u);
    assert.match(fixture, /concrete semantic driver cannot enter a different driver store/u);
    assert.match(fixture, /browser tasks require an explicit typed driver binding/u);
    assert.match(fixture, /service tasks do not receive a browser driver/u);
  });

  it("catches missing, mismatched, duplicate, and wrongly exclusive browser declarations", () => {
    const fixture: BrowserDeclarationView[] = BrowserSystemIdSchema.options
      .filter((system) => system !== "sharepoint")
      .map((system) => ({
        namespace: system,
        driverSystem: system === "crm" ? "ucpath" : system,
        sessionSystem: system,
        exclusive: system === "ucpath",
      }));
    fixture.push({ namespace: "crm", driverSystem: "crm", sessionSystem: "onbase", exclusive: false });
    const issues = auditBrowserDeclarations(fixture).join("\n");
    assert.match(issues, /missing browser store sharepoint/);
    assert.match(issues, /duplicate browser store crm/);
    assert.match(issues, /crm driver mismatch ucpath/);
    assert.match(issues, /crm session mismatch onbase/);
    assert.match(issues, /ucpath violates OnBase-only exclusivity/);
    assert.match(issues, /onbase violates OnBase-only exclusivity/);
  });
});
