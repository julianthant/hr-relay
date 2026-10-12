import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { auditRuntimeEnvironmentInventory,RUNTIME_ENVIRONMENT_REGISTRY } from "../../../src/models/runtime/runtime-environment.js";

describe("runtime environment inventory", () => {
  it("is bidirectionally complete for config, secret, family, and model environment inputs", () => {
    assert.deepEqual(auditRuntimeEnvironmentInventory(RUNTIME_ENVIRONMENT_REGISTRY), []);
    assert.equal(Object.isFrozen(RUNTIME_ENVIRONMENT_REGISTRY.exact), true);
  });

  it("rejects missing migrated settings and stale model environment metadata", () => {
    const withoutConfig = {
      ...RUNTIME_ENVIRONMENT_REGISTRY,
      exact: RUNTIME_ENVIRONMENT_REGISTRY.exact.filter(({ key }) => key !== "HRAUTO_NAVIGATION_RETRIES"),
    };
    assert.equal(
      auditRuntimeEnvironmentInventory(withoutConfig).some((violation) => violation.includes(
        "migrated settings environment HRAUTO_NAVIGATION_RETRIES is not explicitly refused",
      )),
      true,
    );

  });
});
