/**
 * The Duo Autopilot signature counter (D243).
 *
 * This rule lives in the vendored extension, which every browser session is a
 * hard dependency on (`assertDuoAutopilotReady` refuses to launch without it),
 * and it is the whole of the "browser-profile wedge" recorded as an operational
 * finding in separations §9.17 item 5 and §9.20 item 6 and root-caused in §9.21.
 *
 * A WebAuthn server rejects an assertion whose counter does not ADVANCE past
 * what it has already observed, and Duo answers a rejection with a terminal
 * screen that never clears. Duo's counter is per CREDENTIAL; the extension's
 * copy is per BROWSER PROFILE; this runtime runs one profile per
 * `(worker, system, instance, config fingerprint)`. So the counter is a shared
 * resource written by writers that cannot see each other, and the only rule
 * that survives that is one every writer can compute identically from a source
 * they share. Wall-clock seconds is such a source; `stored + 1` is not.
 *
 * The cross-profile case below is the regression: it FAILS under `stored + 1`
 * and it is the exact production shape, not a corner.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { nextSignCount } from "../../duo-autopilot/src/sign-count.js";

/** The live values from §9.21's forced-counter reproduction, kept verbatim. */
const DUO_OBSERVED = 1_787_192_063;
const FORCED_BEHIND = 1_787_191_000;

describe("duo autopilot sign counter", () => {
  it("presents wall clock when the stored counter has fallen behind it", () => {
    // §9.21: this exact gap (1 063) burned the whole 60 s acquisition bound
    // live, on a profile that had logged in at ~19 s a minute earlier.
    assert.equal(nextSignCount(FORCED_BEHIND, DUO_OBSERVED), DUO_OBSERVED);
    assert.notEqual(nextSignCount(FORCED_BEHIND, DUO_OBSERVED), FORCED_BEHIND + 1);
  });

  it("still advances when two ceremonies land inside the same second", () => {
    assert.equal(nextSignCount(DUO_OBSERVED, DUO_OBSERVED), DUO_OBSERVED + 1);
  });

  it("never lowers a stored counter that is already ahead of the clock", () => {
    // A counter is a claim about what a server has already seen. A clock that
    // moved backwards (NTP correction, a suspended laptop) must never be able
    // to re-present a value Duo has observed — that is the cloned-key signal.
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
    // THE regression. One credential, one Duo, two profiles that never see each
    // other's storage — a cold profile created later, and a warm one that was
    // cold-stamped earlier and keeps being used. Under `stored + 1` the warm
    // profile is permanently behind by however much wall clock elapsed between
    // the two cold stamps, and every one of its logins is refused; the only
    // operator exit was deleting the profile directory (§9.17, §9.20).
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
    // Under `stored + 1` the warm profile now presents 1003, 1004, 1005 …
    // against an observed 1201 — refused, forever, with no way back.
    ceremony("warm", 1_210);
    ceremony("cold", 1_220);
    ceremony("warm", 1_230);

    assert.deepEqual(refused, [], "every ceremony must advance the shared server-side counter");
  });
});
