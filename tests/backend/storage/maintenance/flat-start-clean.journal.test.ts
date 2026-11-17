import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { flatStartCleanAfter, FlatStartCleanIntentSchema, type FlatStartCleanEvent, type FlatStartCleanIntent } from "../../../../src/backend/storage/maintenance/flat-start-clean.js";

const message = (run: () => unknown): unknown => {
  try { return run(); } catch (error) { return error instanceof Error ? error.message : error; }
};
const digest = (digit: string) => digit.repeat(64);
const flat = (progress: Pick<FlatStartCleanIntent, "phase" | "cursor" | "pending"> & { result?: string }) => FlatStartCleanIntentSchema.parse({
  schemaVersion: 2, kind: "flat-start-clean", installationId: randomUUID(), operationId: randomUUID(), sourceDigest: digest("1"),
  backup: { backupPath: "/backup.json", backupDigest: digest("2") }, credentialLayout: "flat-plaintext", pepperDigest: digest("3"),
  timing: { launchTimeoutMs: 5000, closeProofMs: 3000 }, phase: progress.phase, cursor: progress.cursor, pending: progress.pending,
  ...(progress.result === undefined ? {} : { result: { registryDigest: progress.result } }) });
const summary = (intent: FlatStartCleanIntent) => `${intent.phase} ${String(intent.cursor)}${intent.pending ? " pending" : ""}${intent.result === undefined ? "" : ` ${intent.result.registryDigest.slice(0, 1)}`}`;

it("flat start-clean: every progress and event pair erases one member at a time, then publishes, and nothing rolls back", () => {
  const planLength = 2;
  const states = {
    "erasing 0": flat({ phase: "erasing", cursor: 0, pending: false }),
    "erasing 0 pending": flat({ phase: "erasing", cursor: 0, pending: true }),
    "erasing 1": flat({ phase: "erasing", cursor: 1, pending: false }),
    "erasing 1 pending": flat({ phase: "erasing", cursor: 1, pending: true }),
    "erasing 2": flat({ phase: "erasing", cursor: 2, pending: false }),
    "publishing 2": flat({ phase: "publishing", cursor: 2, pending: false }),
    "complete 2 d": flat({ phase: "complete", cursor: 2, pending: false, result: digest("d") }),
  };
  const events: Record<string, FlatStartCleanEvent> = {
    "begin-member": { type: "begin-member" }, "member-deleted": { type: "member-deleted" }, "all-deleted": { type: "all-deleted" },
    "published d": { type: "published", registryDigest: digest("d") }, "published e": { type: "published", registryDigest: digest("e") },
  };
  const refused = "flat-start-clean-transition-refused";
  const expected: Record<keyof typeof states, Record<keyof typeof events, string>> = {
    "erasing 0": { "begin-member": "erasing 0 pending", "member-deleted": refused, "all-deleted": refused, "published d": refused, "published e": refused },
    "erasing 0 pending": { "begin-member": "erasing 0 pending", "member-deleted": "erasing 1", "all-deleted": refused, "published d": refused, "published e": refused },
    "erasing 1": { "begin-member": "erasing 1 pending", "member-deleted": refused, "all-deleted": refused, "published d": refused, "published e": refused },
    "erasing 1 pending": { "begin-member": "erasing 1 pending", "member-deleted": "erasing 2", "all-deleted": refused, "published d": refused, "published e": refused },
    "erasing 2": { "begin-member": refused, "member-deleted": refused, "all-deleted": "publishing 2", "published d": refused, "published e": refused },
    "publishing 2": { "begin-member": refused, "member-deleted": refused, "all-deleted": "publishing 2", "published d": "complete 2 d", "published e": "complete 2 e" },
    "complete 2 d": { "begin-member": refused, "member-deleted": refused, "all-deleted": "complete 2 d", "published d": "complete 2 d", "published e": "flat-start-clean-result-changed" },
  };
  for (const [state, intent] of Object.entries(states) as [keyof typeof states, FlatStartCleanIntent][]) {
    for (const [name, event] of Object.entries(events)) {
      const after = message(() => summary(flatStartCleanAfter(intent, event, planLength)));
      assert.equal(after, expected[state][name], `${state} + ${name}`);
    }
  }
  for (const event of Object.values(events)) {
    assert.equal(message(() => flatStartCleanAfter(flat({ phase: "erasing", cursor: 3, pending: false }), event, planLength)), "flat-start-clean-cursor-invalid");
  }
});

it("flat start-clean: only the erasing phase may carry a pending member", () => {
  assert.equal(flat({ phase: "erasing", cursor: 0, pending: true }).pending, true);
  for (const phase of ["publishing", "complete"] as const) {
    assert.throws(() => flat({ phase, cursor: 2, pending: true, ...(phase === "complete" ? { result: digest("d") } : {}) }));
  }
});
