import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { requireSecretFile } from "../../../../src/models/config/secrets.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

describe("closed secret access", () => {

  it("does not accept an arbitrary secret-file path", () => {

    const resolved = resolveConfigWithProvenance({}, hostConfigFacts({}), manualClock(new Date("2026-08-10T12:00:00-07:00"))).config;
    const config = {
      ...resolved,
      paths: { ...resolved.paths, duoCredential: "/nonexistent-rebuild-secret-root/duo-webauthn.json" },
    };
    assert.equal(requireSecretFile.length, 2);
    assert.throws(() => requireSecretFile("duoWebauthnCredential", config), /registered rebuild credential path/);
  });
});
