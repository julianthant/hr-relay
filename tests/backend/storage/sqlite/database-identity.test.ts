import { describe, expect, it } from "vitest";
import { authoritySourceDatabaseIdentity } from "../../../../src/backend/storage/sqlite/database-identity.js";

const binding = { installationId: "00000000-0000-4000-8000-000000000001", profileId: "00000000-0000-4000-8000-000000000002" };

describe("logical authority identity", () => {
  it("keeps the same immutable pair stable across directory and database generations", () => {
    const first = { kind: "profile" as const, binding, path: "/first/state.db", generation: 1 };
    const second = { kind: "profile" as const, binding: { ...binding }, path: "/second/state.db", generation: 99 };
    expect(authoritySourceDatabaseIdentity(first)).toMatch(/^[a-f0-9]{64}$/u);
    expect(authoritySourceDatabaseIdentity(first)).toBe(authoritySourceDatabaseIdentity(second));
  });

  it("separates both foreign installations and foreign people", () => {
    const identity = authoritySourceDatabaseIdentity({ kind: "profile", binding });
    const other = "00000000-0000-4000-8000-000000000003";
    expect(authoritySourceDatabaseIdentity({ kind: "profile", binding: { ...binding, installationId: other } })).not.toBe(identity);
    expect(authoritySourceDatabaseIdentity({ kind: "profile", binding: { ...binding, profileId: other } })).not.toBe(identity);
  });

  it("uses inspected predecessor content without inventing a profile identity", () => {
    const fingerprint = "a".repeat(64);
    expect(authoritySourceDatabaseIdentity({ kind: "unbound-predecessor", schemaVersion: 6, authorityContentFingerprint: fingerprint })).toBe(fingerprint);
    expect(() => authoritySourceDatabaseIdentity({ kind: "unbound-predecessor", schemaVersion: 6, authorityContentFingerprint: "invalid" })).toThrow();
  });
});
