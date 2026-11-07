import assert from "node:assert/strict";
import type { Page } from "playwright";
import { describe, it } from "vitest";
import { withBrowserActionNotes, type BrowserAction } from "../../../../../src/backend/systems/browser-shared/action-notes.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { createCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/interpreter.js";

describe("CRM current session effects", () => {
  it("does not read the new page when navigation revokes the session", async () => {
    let current = true;
    let reads = 0;
    const page = {
      goto: async () => { current = false; return null; },
      url: () => { reads++; return "https://act-crm.my.site.com/hr/ONB_SearchOnboardings?q=10800000"; },
    } as unknown as Page;
    const driver = createCrmOnboardingDriver(() => {
      if (!current) throw new Error("session revoked");
    }, page);

    const stalePublications: BrowserAction[] = [];
    const captured: BrowserAction[] = [];
    await assert.rejects(withBrowserActionNotes(systemClock,
      () => driver.searchOnboardingRecords({ eid: "10800000" }),
      actions => { captured.push(...actions); },
      action => { if (!current) stalePublications.push(action); }), /session revoked/u);
    assert.equal(reads, 0);
    assert.deepEqual(stalePublications, []);
    assert.deepEqual(captured.map(action => action.kind), ["typed", "clicked"]);
  });

  it("publishes completed navigation and read notes while the session remains current", async () => {
    let url = "";
    const heading = {
      first: () => heading,
      waitFor: async () => undefined,
      count: async () => 1,
    };
    const page = {
      goto: async (destination: string) => { url = destination; return null; },
      url: () => url,
      getByRole: () => heading,
      locator: () => ({ count: async () => 0 }),
    } as unknown as Page;
    const published: BrowserAction[] = [];
    const driver = createCrmOnboardingDriver(() => undefined, page);
    const result = await withBrowserActionNotes(systemClock,
      () => driver.searchOnboardingRecords({ eid: "10800000" }),
      () => undefined,
      action => { published.push(action); });

    assert.deepEqual(result, []);
    assert.equal(published.filter(action => action.kind === "opened" && action.targetId === "crm.onboarding.search").length, 2);
    assert.equal(published.some(action => action.kind === "read" && action.targetId === "crm.onboarding.restored-results"), true);
  });
});
