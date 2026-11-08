import assert from "node:assert/strict";
import { it } from "vitest";
import { busyCustodyReason } from "../../../../src/backend/app/composition/storage-compose.js";

type Facts = Parameters<typeof busyCustodyReason>[0];

it("names busy custody kinds by count only, as a boot-log reason token", () => {
  const facts = {
    leases: [{ lifecycle: { state: "running" } }, { lifecycle: { state: "stopped" } }],
    browsers: [{ health: "open" }],
    duoLeases: [{ state: "released" }],
    exclusiveSessionLeases: [{ releasedAt: null }, { releasedAt: "2026-11-07T21:56:00.000Z" }],
    writeIntents: [{ status: "attempting" }, { status: "committed" }],
    controls: [{ auditedAt: undefined }],
  } as unknown as Facts;
  const reason = busyCustodyReason(facts);
  assert.equal(reason, "busy-leases-1-browsers-1-duo-0-sessions-1-writes-1-controls-1");
  assert.match(reason, /^[a-z0-9-]{1,128}$/u);
});
