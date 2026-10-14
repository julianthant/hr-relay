import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createActivitySnapshotSigner, ActivitySnapshotError } from "../../../../src/backend/runs/queries/activity-selection.js";
import { ActivityPopulationError } from "../../../../src/backend/runs/queries/activity-population.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const schema = z.strictObject({ expiresAt: z.iso.datetime(), digest: z.string() });
describe("Analytics population signing", () => {
  it("authenticates the exact identity and refuses foreign keys, malformed values and expiry", () => {
    const clock = manualClock(new Date("2026-10-01T12:00:00Z"));
    const signer = createActivitySnapshotSigner(schema, "ap1", clock);
    const identity = { expiresAt: "2026-10-01T12:15:00Z", digest: "population-and-report" };
    const token = signer.encode(identity);
    expect(signer.decode(token)).toEqual(identity);
    for (const value of [undefined, null, "", `${token}x`, token.replace("ap1", "as1"), "ap1.a.b"]) expect(() => signer.decode(value)).toThrow(ActivitySnapshotError);
    expect(() => createActivitySnapshotSigner(schema, "ap1", clock).decode(token)).toThrow("activity-snapshot-invalid-or-expired");
    const parts = token.split(".");
    parts[1] = Buffer.from(JSON.stringify({ ...identity, digest: "different" })).toString("base64url");
    expect(() => signer.decode(parts.join("."))).toThrow(ActivitySnapshotError);
    clock.advanceWall(15 * 60_000);
    expect(() => signer.decode(token)).toThrow("activity-snapshot-invalid-or-expired");
  });
  it("gives owned refusals a named code and fixed text", () => {
    const error = new ActivityPopulationError("activity-population-content-mismatch");
    expect(error.name).toBe("ActivityPopulationError");
    expect(error.code).toBe("activity-population-content-mismatch");
    expect(error.message).toBe("The selected Analytics population has changed. Select the period again.");
  });
});
