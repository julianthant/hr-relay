import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { notificationDay } from "../../../src/dashboard/state/inbox-wiring-adapter.js";

const hostZone = process.env.TZ;
afterEach(() => { if (hostZone === undefined) delete process.env.TZ; else process.env.TZ = hostZone; });

it("groups Inbox notices by the Pacific day whatever the host zone", () => {
  // Pacific is UTC-8 in November: now is Nov 11 19:00; 08:30Z is Nov 11 00:30; 07:30Z is Nov 10 23:30.
  const now = "2026-11-12T03:00:00.000Z";
  for (const zone of ["Asia/Tokyo", "UTC", "Pacific/Auckland", "America/Los_Angeles"]) {
    process.env.TZ = zone;
    assert.equal(notificationDay("2026-11-11T23:00:00.000Z", now), "Today", zone);
    assert.equal(notificationDay("2026-11-11T08:30:00.000Z", now), "Today", zone);
    assert.equal(notificationDay("2026-11-11T07:30:00.000Z", now), "Yesterday", zone);
    assert.equal(notificationDay("2026-11-08T20:00:00.000Z", now), "Sunday", zone);
    assert.equal(notificationDay("2026-11-03T20:00:00.000Z", now), "November 3", zone);
  }
});
