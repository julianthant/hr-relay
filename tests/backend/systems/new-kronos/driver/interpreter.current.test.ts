import assert from "node:assert/strict";
import type { Page } from "playwright";
import { describe, it } from "vitest";
import { createNewKronosTimecardDriver } from "../../../../../src/backend/systems/new-kronos/driver/interpreter.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";

describe("New Kronos current session effects", () => {
  it("does not submit through a retained frame after the query fill revokes the session", async () => {
    let current = true;
    const events: string[] = [];
    const getByRole = (_role: string, options: { name: string }) => ({
      count: async () => options.name === "Employee Search Close" ? 0 : 1,
      click: async () => { events.push(`click:${options.name}`); },
      fill: async () => { events.push("fill"); current = false; },
    });
    const page = { getByRole, frameLocator: () => ({ getByRole }) } as unknown as Page;
    const driver = createNewKronosTimecardDriver(() => {
      if (!current) throw new Error("session revoked");
    }, page, systemClock);

    await assert.rejects(driver.searchEmployee({ employeeId: "10800000", searchTimeoutMs: 1000 }), /session revoked/u);
    assert.deepEqual(events, ["click:Employee Search", "fill"]);
  });
});
