import { hostConfigFacts } from "../../../src/models/config/host-display.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import {
HOST_PRIMARY_DISPLAY_ENV,
encodeHostPrimaryDisplay,
establishHostPrimaryDisplay,
hostDisplayDefault,
hostPrimaryDisplayEnvironment,
type HostPrimaryDisplayObservation,
} from "../../../src/models/config/host-display.js";
import { DEFAULT_DISPLAY } from "../../../src/models/config/schema.js";
import { manualClock } from "../../../src/rules/time/clock.js";

const CLOCK = manualClock(new Date("2026-09-03T18:00:00.000Z"));
const DETECTED: HostPrimaryDisplayObservation = { state: "detected", screenWidth: 1512, screenHeight: 982, source: "system_profiler" };
const NONE: HostPrimaryDisplayObservation = { state: "unavailable", reason: "no-display" };

describe("host display default", () => {

  it("falls back to the contract default only for an unpublished or displayless host, and refuses a malformed value", () => {
    assert.deepEqual(hostDisplayDefault({}), DEFAULT_DISPLAY);
    assert.deepEqual(hostDisplayDefault({ [HOST_PRIMARY_DISPLAY_ENV]: "none" }), DEFAULT_DISPLAY);
    assert.deepEqual(resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config.display, DEFAULT_DISPLAY);
    for (const bad of ["1512", "1512 x 982", "0x982", "1512x982x60", "auto", ""]) {
      if (bad === "") {
        // An empty publication is still a publication, and a malformed one.
        assert.throws(() => hostDisplayDefault({ [HOST_PRIMARY_DISPLAY_ENV]: bad }), /HRAUTO_HOST_PRIMARY_DISPLAY is not a host display value/u);
        continue;
      }
      assert.throws(
        () => resolveConfigWithProvenance({}, hostConfigFacts({ [HOST_PRIMARY_DISPLAY_ENV]: bad }), CLOCK),
        /HRAUTO_HOST_PRIMARY_DISPLAY is not a host display value; expected <width>x<height> or none/u,
        bad,
      );
    }
  });

  it("probes once and publishes; a parent's publication is kept verbatim and never re-probed", () => {
    let probes = 0;
    const probe = () => { probes += 1; return DETECTED; };
    const env: NodeJS.ProcessEnv = {};
    assert.equal(establishHostPrimaryDisplay(probe, env), "1512x982");
    assert.equal(env[HOST_PRIMARY_DISPLAY_ENV], "1512x982");
    assert.equal(establishHostPrimaryDisplay(probe, env), "1512x982");
    assert.equal(probes, 1);

    const inherited: NodeJS.ProcessEnv = { [HOST_PRIMARY_DISPLAY_ENV]: "2560x1440" };
    assert.equal(establishHostPrimaryDisplay(() => { throw new Error("a child must not re-probe"); }, inherited), "2560x1440");

    const headless: NodeJS.ProcessEnv = {};
    assert.equal(establishHostPrimaryDisplay(() => NONE, headless), "none");
    assert.equal(encodeHostPrimaryDisplay(NONE), "none");
    assert.throws(
      () => establishHostPrimaryDisplay(probe, { [HOST_PRIMARY_DISPLAY_ENV]: "wide" }),
      /HRAUTO_HOST_PRIMARY_DISPLAY is not a host display value/u,
    );
  });

  it("narrows an environment to the host display leaf for a defaults-only resolution", () => {
    assert.deepEqual(hostPrimaryDisplayEnvironment({ [HOST_PRIMARY_DISPLAY_ENV]: "1512x982", UCPATH_USER_ID: "x" }), { [HOST_PRIMARY_DISPLAY_ENV]: "1512x982" });
    assert.deepEqual(hostPrimaryDisplayEnvironment({ UCPATH_USER_ID: "x" }), {});
    const defaults = resolveConfigWithProvenance({}, hostConfigFacts(hostPrimaryDisplayEnvironment({ [HOST_PRIMARY_DISPLAY_ENV]: "1512x982" })), CLOCK);
    assert.deepEqual(defaults.config.display, { screenWidth: 1512, screenHeight: 982 });
  });
});
