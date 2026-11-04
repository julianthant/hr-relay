import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { auditRuntimeEnvironmentInventory,isRegisteredEnvironmentKey,RUNTIME_ENVIRONMENT_REGISTRY,RuntimeEnvironmentExactSpecSchema } from "../../../src/models/runtime/runtime-environment.js";

describe("runtime environment inventory", () => {
  it("is bidirectionally complete for config, secret, family, and model environment inputs", () => {
    assert.deepEqual(auditRuntimeEnvironmentInventory(RUNTIME_ENVIRONMENT_REGISTRY), []);
    assert.equal(Object.isFrozen(RUNTIME_ENVIRONMENT_REGISTRY.exact), true);
  });

  it("registers the canonical accessor for the picker's exact SystemRoot process mechanic", () => {
    assert.deepEqual(RUNTIME_ENVIRONMENT_REGISTRY.exact.find(spec => spec.key === "SystemRoot"), {
      key: "SystemRoot", classification: "non-secret-config", disposition: "active", channel: "process-mechanics",
      owner: "src/models/config/secrets.ts", documented: true,
    });
    assert.deepEqual(RUNTIME_ENVIRONMENT_REGISTRY.exactReaderOwners.find(reader => reader.key === "SystemRoot"),
      { key: "SystemRoot", paths: ["src/models/config/secrets.ts"] });
    assert.equal(isRegisteredEnvironmentKey("SystemRoot"), true);
  });

  it("rejects an unapproved active process mechanic even with the picker registration present", () => {
    const unknown = { ...RUNTIME_ENVIRONMENT_REGISTRY, exact: [...RUNTIME_ENVIRONMENT_REGISTRY.exact,
      { key: "UNAPPROVED_OS_ROOT", classification: "non-secret-config", disposition: "active", channel: "process-mechanics",
        owner: "src/models/config/secrets.ts", documented: false }] };
    assert.match(auditRuntimeEnvironmentInventory(unknown).join("\n"),
      /UNAPPROVED_OS_ROOT retains forbidden active process-mechanics environment ownership/u);
  });

  it.each([
    ["owner", { owner: "src/models/config/host-display.ts" }],
    ["channel", { channel: "config-default", owner: "src/models/config/host-display.ts" }],
    ["classification", { classification: "secret" }],
  ] as const)("refuses changes to the SystemRoot %s", (_label, mutation) => {
    const changed = { ...RUNTIME_ENVIRONMENT_REGISTRY, exact: RUNTIME_ENVIRONMENT_REGISTRY.exact.map(spec =>
      spec.key === "SystemRoot" ? { ...spec, ...mutation } : spec) };
    assert.match(auditRuntimeEnvironmentInventory(changed).join("\n"),
      /SystemRoot must retain the canonical accessor's non-secret process-mechanics ownership/u);
  });

  it("requires the exact canonical reader without additional production owners", () => {
    for (const paths of [["src/backend/transports/http/native-path-picker.ts"], ["src/models/config/host-display.ts"],
      ["src/models/config/secrets.ts", "src/models/config/host-display.ts"]]) {
      const changed = { ...RUNTIME_ENVIRONMENT_REGISTRY,
        exactReaderOwners: RUNTIME_ENVIRONMENT_REGISTRY.exactReaderOwners.map(reader =>
          reader.key === "SystemRoot" ? { ...reader, paths } : reader) };
      assert.match(auditRuntimeEnvironmentInventory(changed).join("\n"), /SystemRoot exact reader must be solely the canonical environment accessor/u);
    }
  });

  it("keeps mixed-case spelling closed to the exact SystemRoot key", () => {
    const spec = RUNTIME_ENVIRONMENT_REGISTRY.exact.find(candidate => candidate.key === "SystemRoot");
    assert.ok(spec);
    for (const key of ["Systemroot", "SystemRootExtra"]) {
      assert.equal(RuntimeEnvironmentExactSpecSchema.safeParse({ ...spec, key }).success, false);
      assert.equal(isRegisteredEnvironmentKey(key), false);
    }
  });

  it("refuses removal of the required SystemRoot registration", () => {
    const missing = { ...RUNTIME_ENVIRONMENT_REGISTRY,
      exact: RUNTIME_ENVIRONMENT_REGISTRY.exact.filter(spec => spec.key !== "SystemRoot"),
      exactReaderOwners: RUNTIME_ENVIRONMENT_REGISTRY.exactReaderOwners.filter(reader => reader.key !== "SystemRoot") };
    assert.match(auditRuntimeEnvironmentInventory(missing).join("\n"),
      /SystemRoot must retain the canonical accessor's non-secret process-mechanics ownership/u);
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
