import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { UCPATH_UI_REGISTRY,auditUcpathUiRegistry } from "../../../../../src/backend/systems/ucpath/driver/ui-registry.js";
import { buildUiTaskLinks } from "../../../../../src/backend/systems/ui-task-links.js";

describe("semantic UI registry", () => {
  it("resolves every UCPath semantic dependency without collisions", () => {
    assert.deepEqual(auditUcpathUiRegistry(), []);
    assert.equal(UCPATH_UI_REGISTRY.system, "ucpath");

    assert.equal(UCPATH_UI_REGISTRY.elements.length, 30);
    // 4 + the termination family's three: the wizard, the pending sweep, and
    // the SS Smart HR search filter.
    assert.equal(UCPATH_UI_REGISTRY.scenarios.length, 7);
  });

  it("publishes only semantic facts, with no private recipe or captured value", () => {
    const published = buildUiTaskLinks().filter(({ system }) => system === "ucpath");
    const elements = published.filter(({ kind }) => kind === "element");
    const serialized = JSON.stringify(published);
    assert.equal(elements.length, 30);
    assert.deepEqual(
      elements.map(({ id }) => id).sort(),
      UCPATH_UI_REGISTRY.elements.map(({ id }) => id).sort(),
      "the semantic index must preserve the exact UCPath element membership",
    );
    assert.ok(published.length > elements.length, "screens, states, and observations remain published too");
    assert.deepEqual(
      [...new Set(published.flatMap((entry) => Object.keys(entry)))].sort(),
      ["id", "kind", "label", "sourceLink", "system", "taskUses", "verification"],
      "the public semantic entry shape excludes implementation recipes and captured values",
    );
    assert.doesNotMatch(
      serialized,
      /#main_target_win0|PERSON_NPC_VW_EMPLID|legacyKey|locator|selector|capturedValue|valueType|timeoutMs/,
    );
    assert.doesNotMatch(serialized, /UC_SS_TRANSACT_UC_TRANSACT_ID|UC_SS_TRANSACT_APPR_STATUS/);
  });
});
