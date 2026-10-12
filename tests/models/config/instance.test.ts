import { hostConfigFacts } from "../../../src/models/config/host-display.js";

import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../src/backend/app/config/resolve.js";
import { listSystemEntryHosts,resolveSystemEntryUrl } from "../../../src/models/config/instance.js";
import { manualClock } from "../../../src/rules/time/clock.js";

const CLOCK = manualClock(new Date("2026-08-26T00:00:00.000Z"));
const KUALI_PROD = "https://ucsd.kualibuild.com/build/space/5e47518b90adda9474c14adb";

describe("settings facts — system hosts", () => {

  it("refuses an old test target even when it matched production", () => {
    const config = resolveConfigWithProvenance({
      urls: { kuali: { test: { entry: KUALI_PROD } } },
    }, hostConfigFacts({}), CLOCK).config;
    assert.deepEqual(
      listSystemEntryHosts(config).find(({ system }) => system === "kuali")?.test,
      { state: "not-provisioned" },
    );
    assert.throws(
      () => resolveSystemEntryUrl(config, "kuali", "test", "settings-facts.test"),
      /retired test instance/,
    );
  });
});
