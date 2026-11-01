import assert from "node:assert/strict";
import type { Page } from "playwright";
import { describe,it } from "vitest";
import { createUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/interpreter.js";
import {
UCPATH_PERSON_ORG_DISPLAYED_EID,
UCPATH_PERSON_ORG_EID_INPUT,
parseUcpathPersonOrgEid
} from "../../../../../src/models/ui/ucpath-person-org.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";

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

  it("enforces element states immediately and uses the one verified display locator", async () => {
    const events: string[] = [];
    const driver = createUcpathPersonOrgDriver(() => undefined, recordingPage(events), systemClock, {
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
});
