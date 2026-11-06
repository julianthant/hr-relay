import assert from "node:assert/strict";
import { it } from "vitest";
import { deriveBulkChildCommand, deriveBulkChildCommandId } from "../../../src/rules/commands/command-groups.js";
import { deriveStableUuid } from "../../../src/rules/identity/identifiers.js";
import { BulkRunCommandRequestSchema } from "../../../src/rules/commands/commands.js";

it("preserves released child IDs and UUID variants with browser-safe hashing", () => {
  assert.equal(deriveBulkChildCommandId("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"), "82815f00-9c60-51c7-8bd5-06779727d335");
  const variants = new Set<string>();
  for (const bulk of ["11111111-1111-4111-8111-111111111111", "café", "a\0b", "日本語", ...Array.from({ length: 32 }, (_, i) => String(i))]) {
    const run = "22222222-2222-4222-8222-222222222222";
    const id = deriveBulkChildCommandId(bulk, run);
    assert.equal(id, deriveStableUuid("hrauto:bulk-run-child-command:v1", `${bulk}\0${run}`));
    assert.equal(id[14], "5"); variants.add(id[19]);
  }
  assert.deepEqual([...variants].sort(), ["8", "9", "a", "b"]);
});

it("derives the complete child envelope without changing provenance or target version", () => {
  const bulk = BulkRunCommandRequestSchema.parse({ commandId: "11111111-1111-4111-8111-111111111111",
    bulkCommandId: "11111111-1111-4111-8111-111111111111", requestedAt: "2026-08-03T12:00:00.000Z",
    requestedBy: "local-operator", source: "dashboard", reason: "Operator review", family: "run", type: "cancel", mode: "best-effort",
    targets: [{ runId: "22222222-2222-4222-8222-222222222222", expectedVersion: 3 }] });
  const child = deriveBulkChildCommand(bulk, bulk.targets[0]);
  assert.deepEqual(child, { commandId: deriveBulkChildCommandId(bulk.bulkCommandId, bulk.targets[0].runId),
    requestedAt: bulk.requestedAt, requestedBy: bulk.requestedBy, source: bulk.source, reason: bulk.reason,
    family: "run", type: "cancel", target: bulk.targets[0] });
});
