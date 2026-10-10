import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import type { Page } from "playwright";
import { UiVerificationEvidenceManifestSchema } from "../../../../../../src/models/ui/contracts.js";
import {
  UCPATH_PERSON_ORG_DETAIL_READY,
  UCPATH_PERSON_ORG_DETAIL_SCREEN,
  UCPATH_PERSON_ORG_DISPLAYED_EID,
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_SEARCH_READY,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
  parseUcpathPersonOrgEid,
} from "../../../../../../src/models/ui/ucpath-person-org.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../../src/backend/systems/ucpath/driver/fake.js";
import { systemClock } from "../../../../../../src/rules/time/clock.js";
import { createUcpathPersonOrgDriver } from "../../../../../../src/backend/systems/ucpath/driver/interpreter.js";
import { UCPATH_UI_REGISTRY, auditUcpathUiRegistry } from "../../../../../../src/backend/systems/ucpath/driver/ui-registry.js";
import { buildUiTaskLinks } from "../../../../../../src/backend/systems/ui-task-links.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../../..");

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

  it("keeps both fixture and live evidence sanitized and write-free", () => {
    for (const path of [
      "docs/rebuild/evidence/selectors/ucpath/person-org.fixture.json",
      "docs/rebuild/evidence/selectors/ucpath/person-org.live.json",
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
