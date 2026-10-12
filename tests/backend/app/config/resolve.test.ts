import { hostConfigFacts } from "../../../../src/models/config/host-display.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import {
HOST_PRIMARY_DISPLAY_ENV
} from "../../../../src/models/config/host-display.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const CLOCK = manualClock(new Date("2026-09-03T18:00:00.000Z"));

describe("host display default", () => {
  it("resolves the published host display as the `display` DEFAULT, beneath a Settings override", () => {
    const env = { [HOST_PRIMARY_DISPLAY_ENV]: "1512x982" };
    const detected = resolveConfigWithProvenance({}, hostConfigFacts(env), CLOCK);
    assert.deepEqual(detected.config.display, { screenWidth: 1512, screenHeight: 982 });
    assert.equal(detected.provenance["display.screenWidth"], "default");
    assert.equal(detected.provenance["display.screenHeight"], "default");

    const overridden = resolveConfigWithProvenance({ display: { screenWidth: 1440, screenHeight: 900 } }, hostConfigFacts(env), CLOCK);
    assert.deepEqual(overridden.config.display, { screenWidth: 1440, screenHeight: 900 });
    assert.equal(overridden.provenance["display.screenWidth"], "settings");
    assert.equal(overridden.provenance["display.screenHeight"], "settings");

    assert.notEqual(detected.fingerprint, resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).fingerprint,
      "the host default is part of the config fingerprint, exactly like every other default");
  });
});
