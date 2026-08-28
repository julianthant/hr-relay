import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { createSpanJsonlWriter } from "../../src/infra/events/span-jsonl-writer.js";
import { reconcileSpanAuthority } from "../../src/infra/sqlite/storage-doctor.js";
import {
  HASH_A,
  HASH_B,
  NOW,
  UUID_1,
  UUID_2,
  UUID_3,
  UUID_4,
  UUID_5,
  UUID_6,
} from "./fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-span-authority-"));
  roots.push(root);
  return root;
}

function writeRunRoot(root: string, runId: string, itemId: string, traceId: string): void {
  createSpanJsonlWriter({ stateRoot: root, clock: manualClock(new Date(NOW)), pid: 4242 }).emit({
    t: "run.queued",
    kind: "run",
    ts: NOW,
    workflow: "person-lookup",
    runId,
    attempt: 1,
    traceId,
    spanPath: traceId,
    itemId,
    shape: "single",
    priority: "interactive",
    dryRun: true,
    actorId: "local-operator",
    title: "Redacted test run",
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    resolvedInstance: { ucpath: "test" },
    configFingerprint: HASH_B,
    configSnapshotId: UUID_6,
  });
}

describe("storage doctor span/authority reconciliation", () => {
  it("names current, archived, missing-span, and unaccounted identities without substituting one for another", () => {
    const root = stateRoot();
    writeRunRoot(root, UUID_1, UUID_4, "pl-120000-0000");
    writeRunRoot(root, UUID_2, UUID_5, "pl-120001-0000");
    writeRunRoot(root, UUID_3, UUID_6, "pl-120002-0000");

    const report = reconcileSpanAuthority(root, {
      currentRunIds: [UUID_1, UUID_2, UUID_4],
      archivedRunIds: [UUID_2],
      malformedRecords: [],
    });

    assert.deepEqual(report, {
      state: "complete",
      counts: { current: 1, archived: 1, missingSpan: 1, unaccounted: 1 },
      findings: [
        { kind: "archived", runId: UUID_2 },
        { kind: "missing-span", runId: UUID_4 },
        { kind: "unaccounted", runId: UUID_3 },
      ],
    });
  });
});
