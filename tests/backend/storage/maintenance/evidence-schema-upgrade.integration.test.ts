import { it, vi } from "vitest";
import { upgradeRetainedPredecessorEvidence } from "../../../support/helpers/backend/evidence-schema-upgrade-startup.js";

// Catch any fixture composition that accidentally falls back to elapsed system time.
vi.mock("../../../../src/rules/time/clock.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../../src/rules/time/clock.js")>();
  let elapsedMs = 0;
  return { ...actual, systemClock: { ...actual.systemClock, monotonicMs: () => elapsedMs += 51 } };
});
// Sign-up and sign-in verify at one cheaper scrypt cost; these files prove the evidence upgrade, not the password hash.
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scryptSync: (...[password, salt, length, options]: Parameters<typeof actual.scryptSync>) => actual.scryptSync(password, salt, length, { ...options, N: 2 ** 10 }) };
});

it("upgrades real retained predecessor Kuali evidence through startup, preserving every frozen row and a second startup", () => upgradeRetainedPredecessorEvidence(false));
