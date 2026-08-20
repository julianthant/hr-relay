import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import type { Page } from "playwright";
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
import { assertSafeUiCatalogFresh, buildSafeUiCatalog } from "../../src/stores/ucpath/driver/catalog.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../src/stores/ucpath/driver/fake.js";
import { systemClock } from "../../src/domain/clock.js";
import { createUcpathPersonOrgDriver } from "../../src/stores/ucpath/driver/interpreter.js";
import { UCPATH_UI_REGISTRY, auditUcpathUiRegistry } from "../../src/stores/ucpath/driver/ui-registry.js";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

function recordingPage(events: string[]): Page {
  function locator(label: string): {
    or(other: unknown): unknown;
    waitFor(): Promise<void>;
    fill(value: string): Promise<void>;
    textContent(): Promise<string>;
  } {
    return {
      or() {
        events.push(`or:${label}`);
        return locator(`${label}|fallback`);
      },
      async waitFor() {
        events.push(`wait:${label}`);
      },
      async fill(value) {
        events.push(`fill:${label}:${value}`);
      },
      async textContent() {
        events.push(`read:${label}`);
        return "10800000";
      },
    };
  }
  return {
    frameLocator(selector: string) {
      events.push(`frame:${selector}`);
      return {
        getByRole(_role: string, options: { name?: string }) {
          const label = `role:${options.name ?? "unnamed"}`;
          events.push(`locate:${label}`);
          return locator(label);
        },
        locator(selectorValue: string) {
          events.push(`locate:${selectorValue}`);
          return locator(selectorValue);
        },
      };
    },
  } as unknown as Page;
}

describe("semantic UI registry", () => {
  it("resolves every UCPath semantic dependency without collisions", () => {
    assert.deepEqual(auditUcpathUiRegistry(), []);
    assert.equal(UCPATH_UI_REGISTRY.system, "ucpath");
    // 14 Person Org (2026-08-02) + 2 SS Smart HR receipt (2026-08-04)
    // + 14 Smart HR termination (2026-08-14, D206).
    assert.equal(UCPATH_UI_REGISTRY.elements.length, 30);
    // 4 + the termination family's three: the wizard, the pending sweep, and
    // the SS Smart HR search filter.
    assert.equal(UCPATH_UI_REGISTRY.scenarios.length, 7);
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
    // 51 ucpath + 13 crm + 33 kuali + 23 new-kronos. UCPath gained 23 facts
    // with the Smart HR termination family: 4 screens, 14 elements, 5 states.
    // Kuali gained 2 with chunk 5a's finalization write: the staged page state
    // the fence binds to, and the Transaction Number completion observation.
    // It gained no ELEMENT — every control it writes is already a read element.
    // **D261 added SIX**: the Action-List screen, its search box, its GO button,
    // its anchored document link, the list's ready state, and the matched
    // document-number observation the resolve read binds its subject to.
    assert.equal(catalog.entries.length, 120);
    assert.doesNotMatch(
      serialized,
      /#main_target_win0|PERSON_NPC_VW_EMPLID|Empl ID|legacyKey|locator|selector|capturedValue|valueType|timeoutMs/,
    );
    // The receipt family's PeopleSoft field ids are recipes, so they are
    // server-private for exactly the same reason the Person Org ones are.
    assert.doesNotMatch(serialized, /UC_SS_TRANSACT_UC_TRANSACT_ID|UC_SS_TRANSACT_APPR_STATUS/);
  });

  it("enforces element states immediately and uses the one verified display locator", async () => {
    const events: string[] = [];
    const driver = createUcpathPersonOrgDriver(recordingPage(events), systemClock, {
      searchPersonOrg: () => Promise.reject(new Error("semantic search is outside this primitive-driver test")),
      readJobSummary: () => Promise.reject(new Error("the semantic job-summary read is outside this primitive-driver test")),
    });
    await driver.fill(UCPATH_PERSON_ORG_EID_INPUT, parseUcpathPersonOrgEid("10800000"));
    assert.equal(events.findIndex((event) => event.startsWith("wait:"))
      < events.findIndex((event) => event.startsWith("fill:")), true);

    events.length = 0;
    assert.equal(await driver.read(UCPATH_PERSON_ORG_DISPLAYED_EID), "10800000");
    assert.deepEqual(events.filter((event) => event.startsWith("locate:")), [
      "locate:#PERSON_NPC_VW_EMPLID",
      "locate:table[id^=\"tdgbrPER_ASGN_EMP_VW$\"]",
      "locate:#PERSON_NPC_VW_EMPLID",
    ]);
    assert.equal(events.findIndex((event) => event.startsWith("wait:"))
      < events.findIndex((event) => event.startsWith("read:")), true);
  });

  it("fails selector search freshness checks on a stale generated catalog", () => {
    const generated = UiCatalogSchema.parse(
      JSON.parse(readFileSync(resolve(REPO_ROOT, "generated/ui-catalog.json"), "utf8")),
    );
    assert.doesNotThrow(() => assertSafeUiCatalogFresh(generated));
    const stale = structuredClone(generated);
    stale.entries.pop();
    assert.throws(() => assertSafeUiCatalogFresh(stale), /generated UI catalog is stale/);
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
      if (manifest.evidenceKind === "live-read-only") {
        assert.deepEqual(manifest.rejectedCandidates?.map(({ legacyKey, matchedCount }) => ({
          legacyKey,
          matchedCount,
        })), [
          { legacyKey: "personOrgSummary.emplIdInput()", matchedCount: 0 },
          { legacyKey: "personOrgSummary.nameInput()", matchedCount: 0 },
        ]);
        assert.deepEqual(manifest.paginationProofs?.map((proof) => ({
          context: proof.context,
          initialState: proof.initialState,
          finalState: proof.finalState,
          renderedBefore: proof.renderedBefore,
          renderedAfter: proof.renderedAfter,
        })), [
          {
            context: "search-results",
            initialState: "enabled-view-all",
            finalState: "view-n",
            renderedBefore: 100,
            renderedAfter: 300,
          },
          {
            context: "search-results",
            initialState: "disabled-view-all",
            finalState: "disabled-view-all",
            renderedBefore: 27,
            renderedAfter: 27,
          },
          {
            context: "employment-instances",
            initialState: "enabled-view-all",
            finalState: "view-n",
            renderedBefore: 1,
            renderedAfter: 10,
          },
        ]);
      }
    }
  });
});
