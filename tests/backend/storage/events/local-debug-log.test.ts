import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { appendProfileSelectionChange, importLocalDebugLog, readLocalDebugLog } from "../../../../src/backend/storage/events/local-debug-log.js";
import { ProfileSelectionChangeSchema } from "../../../../src/models/profiles/profile.js";
import { debugTimelineFixture as fixture } from "../../../support/helpers/backend/debug-timeline-fixture.js";
const AT = new Date("2026-10-10T12:00:00.000Z");

it("keeps closed, value-free profile transition evidence when the local spool transfers into SQLite", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-profile-log-"));
  try {
    const change = { reason: "profile-logout-requested" as const, oldGeneration: 8, newGeneration: 9 };
    for (const phase of ["started", "settled"] as const) appendProfileSelectionChange({ stateRoot: root, now: AT, phase, ...change });
    const local = readLocalDebugLog(root); assert.equal(local.state, "present");
    if (local.state !== "present") throw new Error("profile transition evidence required");
    assert.equal(local.records.length, 2);
    for (const record of local.records) {
      assert.equal(record.payload.kind, "debug"); if (record.payload.kind !== "debug") throw new Error("debug evidence required");
      assert.equal(record.payload.event.code, "PROFILE_SELECTION_CHANGED");
      assert.ok(record.payload.event.message);
      const parsed = ProfileSelectionChangeSchema.parse(JSON.parse(record.payload.event.message));
      assert.deepEqual(parsed, { ...change, caller: "src/backend/profiles/profile-session.ts:logOut" });
      assert.equal(ProfileSelectionChangeSchema.safeParse({ ...parsed, profileId: "private-value" }).success, false);
      assert.equal(ProfileSelectionChangeSchema.safeParse({ ...parsed, reason: "unknown" }).success, false);
      assert.equal(ProfileSelectionChangeSchema.safeParse({ ...parsed, caller: "src/backend/profiles/profile-session.ts:activate" }).success, false);
    }
    const { records, repository } = fixture(), get = repository.get.bind(repository);
    repository.get = () => undefined;
    assert.throws(() => importLocalDebugLog(root, repository), /verification-failed/u);
    assert.equal(existsSync(join(root, "logs/boot.jsonl")), true);
    repository.get = get;
    assert.equal(importLocalDebugLog(root, repository), 2);
    assert.equal(records.length, 2);
    assert.equal(existsSync(join(root, "logs/boot.jsonl")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
