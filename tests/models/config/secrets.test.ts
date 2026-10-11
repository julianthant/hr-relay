
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
HOST_PRIMARY_DISPLAY_ENV,
type HostPrimaryDisplayObservation
} from "../../../src/models/config/host-display.js";
import { hostAwareResolutionEnvironment } from "../../../src/models/config/secrets.js";
const DETECTED: HostPrimaryDisplayObservation = { state: "detected", screenWidth: 1512, screenHeight: 982, source: "system_profiler" };

describe("host display default", () => {

  it("hands compositions the SAME environment object with the host display established in it", () => {
    const env: NodeJS.ProcessEnv = { UNRELATED: "kept" };
    const resolved = hostAwareResolutionEnvironment(() => DETECTED, env);
    assert.equal(resolved, env);
    assert.equal(resolved[HOST_PRIMARY_DISPLAY_ENV], "1512x982");
    assert.equal(resolved.UNRELATED, "kept");
  });
});
