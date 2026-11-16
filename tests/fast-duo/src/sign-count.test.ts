
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { nextSignCount } from "../../../fast-duo/src/sign-count.js";

const DUO_OBSERVED = 1_787_192_063;
const FORCED_BEHIND = 1_787_191_000;

describe("fast-duo sign counter", () => {
  it("presents wall clock when the stored counter has fallen behind it", () => {
    assert.equal(nextSignCount(FORCED_BEHIND, DUO_OBSERVED), DUO_OBSERVED);
    assert.notEqual(nextSignCount(FORCED_BEHIND, DUO_OBSERVED), FORCED_BEHIND + 1);
  });

  it("still advances when two ceremonies land inside the same second", () => {
    assert.equal(nextSignCount(DUO_OBSERVED, DUO_OBSERVED), DUO_OBSERVED + 1);
  });

  it("never lowers a stored counter that is already ahead of the clock", () => {
    // A backward wall clock must not repeat a counter already presented to the server.
    assert.equal(nextSignCount(DUO_OBSERVED + 5_000, DUO_OBSERVED), DUO_OBSERVED + 5_001);
  });

  it("floors garbage at one rather than presenting NaN or a negative", () => {
    const junkValues: readonly (readonly [string, unknown])[] = [
      ["undefined", undefined],
      ["null", null],
      ["empty string", ""],
      ["non-numeric string", "abc"],
      ["NaN", Number.NaN],
      ["negative", -17],
      ["an object", {}],
    ];
    for (const [label, junk] of junkValues) {
      const presented = nextSignCount(junk, 0);
      assert.ok(Number.isInteger(presented) && presented > 0, `${label} presented ${String(presented)}`);
    }
    assert.equal(nextSignCount(undefined, DUO_OBSERVED), DUO_OBSERVED);
  });

  it("keeps two profiles sharing one credential monotonic against one server", () => {

    let duoObserved = 0;
    const refused: string[] = [];
    const profiles = {
      // warm: cold-stamped at t=1000 and used every 10 seconds thereafter
      warm: { stored: 1_000 },
      // cold: created at t=1200, so its import stamp is `now`
      cold: { stored: 0 },
    };
    const ceremony = (name: "warm" | "cold", nowSec: number): void => {
      const profile = profiles[name];
      const presented = nextSignCount(profile.stored, nowSec);
      profile.stored = presented;
      if (presented <= duoObserved) {
        refused.push(`${name}@${String(nowSec)} presented ${String(presented)} <= observed ${String(duoObserved)}`);
        return;
      }
      duoObserved = presented;
    };

    ceremony("warm", 1_000);
    ceremony("warm", 1_010);
    profiles.cold.stored = 1_200; // the auto-import stamp on a fresh profile
    ceremony("cold", 1_200);
    ceremony("warm", 1_210);
    ceremony("cold", 1_220);
    ceremony("warm", 1_230);

    assert.deepEqual(refused, [], "every ceremony must advance the shared server-side counter");
  });
});
