// @vitest-environment jsdom
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import { appendProfileSelectionChange, readLocalDebugLog } from "../../../../src/backend/storage/events/local-debug-log.js";

it("records the installed package version for a native selection log called under jsdom", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-profile-log-jsdom-"));
  const version = z.object({ version: z.string().min(1) }).parse(JSON.parse(readFileSync(resolve(import.meta.dirname, "../../../../package.json"), "utf8"))).version;
  try {
    appendProfileSelectionChange({ stateRoot: root, now: new Date("2026-10-10T12:00:00.000Z"), phase: "settled",
      reason: "profile-activated", oldGeneration: 0, newGeneration: 1 });
    const local = readLocalDebugLog(root); assert.equal(local.state, "present");
    if (local.state !== "present") throw new Error("native selection log required");
    assert.equal(local.records.length, 1);
    const payload = local.records[0]?.payload;
    assert.ok(payload?.kind === "debug");
    assert.equal(payload.event.build, version);
    assert.equal(payload.event.code, "PROFILE_SELECTION_CHANGED");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
