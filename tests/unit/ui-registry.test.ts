import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import { UiCatalogSchema, UiVerificationEvidenceManifestSchema } from "../../src/domain/ui/contracts.js";
import {
  UCPATH_PERSON_ORG_DETAIL_READY,
  UCPATH_PERSON_ORG_DETAIL_SCREEN,
  UCPATH_PERSON_ORG_DISPLAYED_EID,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_SEARCH_READY,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
  parseUcpathPersonOrgEid,
} from "../../src/domain/ui/ucpath-person-org.js";
import { buildSafeUiCatalog } from "../../src/stores/ucpath/driver/catalog.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../src/stores/ucpath/driver/fake.js";
import { UCPATH_UI_REGISTRY, auditUcpathUiRegistry } from "../../src/stores/ucpath/driver/ui-registry.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

describe("semantic UI registry", () => {
  it("resolves every Person Org semantic dependency without collisions", () => {
    assert.deepEqual(auditUcpathUiRegistry(), []);
    assert.equal(UCPATH_UI_REGISTRY.system, "ucpath");
    assert.equal(UCPATH_UI_REGISTRY.elements.length, 2);
    assert.equal(UCPATH_UI_REGISTRY.scenarios.length, 2);
  });

  it("runs the deterministic read-only Person Org scenario through typed ids", async () => {
    const driver = createDeterministicUcpathPersonOrgDriver();
    const eid = parseUcpathPersonOrgEid("10800000");
    await driver.goto(UCPATH_PERSON_ORG_SEARCH_SCREEN);
    await driver.waitFor(UCPATH_PERSON_ORG_SEARCH_READY);
    await driver.fill(UCPATH_PERSON_ORG_EID_INPUT, eid);
    await driver.goto(UCPATH_PERSON_ORG_DETAIL_SCREEN);
    await driver.waitFor(UCPATH_PERSON_ORG_DETAIL_READY);
    assert.equal(await driver.read(UCPATH_PERSON_ORG_DISPLAYED_EID), eid);
  });

  it("fails loud when the deterministic observation lacks state or subject", async () => {
    const driver = createDeterministicUcpathPersonOrgDriver();
    await assert.rejects(
      driver.read(UCPATH_PERSON_ORG_DISPLAYED_EID),
      /requires the detail screen/,
    );
    await driver.goto(UCPATH_PERSON_ORG_DETAIL_SCREEN);
    await assert.rejects(
      driver.read(UCPATH_PERSON_ORG_DISPLAYED_EID),
      /requires a prior canonical EID fill/,
    );
  });

  it("publishes a schema-valid catalog with no private recipe or captured value", () => {
    const catalog = UiCatalogSchema.parse(buildSafeUiCatalog());
    const serialized = JSON.stringify(catalog);
    assert.equal(catalog.entries.length, 7);
    assert.doesNotMatch(
      serialized,
      /#main_target_win0|PERSON_NPC_VW_EMPLID|Empl ID|legacyKey|locator|selector|capturedValue|valueType|timeoutMs/,
    );
  });

  it("keeps both fixture and live evidence sanitized and write-free", () => {
    for (const path of [
      "evidence/ui/ucpath/person-org.fixture.json",
      "evidence/ui/ucpath/person-org.live.json",
    ]) {
      const manifest = UiVerificationEvidenceManifestSchema.parse(
        JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8")),
      );
      assert.equal(manifest.externalWriteAttempted, false);
      assert.equal(manifest.sanitized, true);
      assert.equal(manifest.assertions.every(({ capturedValue }) => capturedValue === false), true);
    }
  });
});
