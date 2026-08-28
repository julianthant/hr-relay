import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { createSpanJsonlWriter } from "../../src/infra/events/span-jsonl-writer.js";
import {
  reconcileSpanAuthority,
  summarizeSpanAuthorityReconciliation,
} from "../../src/infra/sqlite/storage-doctor.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
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
import { QUEUED_RUN } from "./fixtures/phase1f-run-fixtures.js";
import {
  ARCHIVED_RUN,
  VERSION_BUMP_APPLICATION,
  VERSION_PLAN_ROW,
} from "./fixtures/archive-fixtures.js";
import { DAY, makeWorld, queuedEventOf, uuidOf } from "./server/helpers/dashboard-harness.js";

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
    assert.deepEqual(summarizeSpanAuthorityReconciliation(report), {
      state: "degraded",
      summary: "span/authority identities include 1 missing-span and 1 unaccounted run(s)",
    });
    assert.equal(summarizeSpanAuthorityReconciliation({
      state: "complete",
      counts: { current: 1, archived: 1, missingSpan: 0, unaccounted: 0 },
      findings: [{ kind: "archived", runId: UUID_2 }],
    }).state, "healthy");
  });

  it("returns malformed-span without inventing missing-span findings around unreadable evidence", () => {
    const root = stateRoot();
    mkdirSync(join(root, "spans"));
    writeFileSync(join(root, "spans", "person-lookup-2026-08-28.jsonl"), "{not-json}\n");

    assert.deepEqual(reconcileSpanAuthority(root, {
      currentRunIds: [UUID_1],
      archivedRunIds: [],
      malformedRecords: [],
    }), {
      state: "malformed",
      findings: [{
        kind: "malformed-span",
        fileName: "person-lookup-2026-08-28.jsonl",
        lineNumber: 1,
        detail: "span line is not valid JSON",
      }],
    });
  });

  it("does not count a task-only span as a reconciled current run root", () => {
    const root = stateRoot();
    createSpanJsonlWriter({ stateRoot: root, clock: manualClock(new Date(NOW)), pid: 4242 }).emit({
      t: "span.started",
      kind: "task",
      ts: NOW,
      workflow: "person-lookup",
      runId: UUID_1,
      attempt: 1,
      traceId: "pl-120000-0000",
      spanPath: "pl-120000-0000/searching#1",
      parentSpanPath: "pl-120000-0000",
      name: "searching",
    });

    assert.deepEqual(reconcileSpanAuthority(root, {
      currentRunIds: [UUID_1],
      archivedRunIds: [],
      malformedRecords: [],
    }), {
      state: "complete",
      counts: { current: 0, archived: 0, missingSpan: 1, unaccounted: 0 },
      findings: [{ kind: "missing-span", runId: UUID_1 }],
    });
  });

  it("names a malformed authority row instead of selecting or omitting it", () => {
    const root = stateRoot();
    const authorityPath = join(root, "state.db");
    const authority = AuthorityDatabase.open(
      { path: authorityPath, busyTimeoutMs: 500, migrationOwner: "span-authority-test" },
      manualClock(new Date(NOW)),
    );
    authority.authority.runs.enqueue(QUEUED_RUN);
    authority.close();
    const raw = new DatabaseSync(authorityPath);
    try {
      raw.prepare("UPDATE tasks SET record_json = '{}' WHERE record_key = ?").run(QUEUED_RUN.envelope.runId);
    } finally {
      raw.close();
    }

    const inventory = AuthorityDatabase.inspectRunIdentitiesReadOnly(authorityPath, 500);
    assert.deepEqual(inventory.currentRunIds, []);
    assert.deepEqual(inventory.malformedRecords, [{
      source: "current",
      recordKey: QUEUED_RUN.envelope.runId,
      detail: `tasks record ${QUEUED_RUN.envelope.runId} failed its strict authority schema`,
    }]);
  });

  it("reconciles an exact archived authority identity as archived, not missing or unaccounted", () => {
    const root = stateRoot();
    const authorityPath = join(root, "state.db");
    const authority = AuthorityDatabase.open(
      { path: authorityPath, busyTimeoutMs: 500, migrationOwner: "archived-span-authority-test" },
      manualClock(new Date(NOW)),
    );
    authority.withAuthorityTransaction((repositories) => {
      repositories.runs.enqueue(QUEUED_RUN);
      repositories.versionPlans.insert(VERSION_PLAN_ROW);
      repositories.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
      repositories.archivedRuns.insert(ARCHIVED_RUN);
    });
    authority.close();
    writeRunRoot(root, ARCHIVED_RUN.runId, QUEUED_RUN.envelope.itemId, QUEUED_RUN.envelope.traceId);

    const report = reconcileSpanAuthority(
      root,
      AuthorityDatabase.inspectRunIdentitiesReadOnly(authorityPath, 500),
    );
    assert.deepEqual(report, {
      state: "complete",
      counts: { current: 0, archived: 1, missingSpan: 0, unaccounted: 0 },
      findings: [{ kind: "archived", runId: ARCHIVED_RUN.runId }],
    });
  });

  it("preserves the queue projection's exact refusal for a span-only run", () => {
    const world = makeWorld();
    try {
      queuedEventOf(world, { seed: 91 });
      world.authority.records.delete(uuidOf(91));
      assert.throws(
        () => world.projection.buildDashboardDayWire(DAY),
        (error: unknown) => error instanceof Error
          && error.message === `run ${uuidOf(91)} exists in the span stream but not in authority; the projection refuses to render an unaccounted run`,
      );
    } finally {
      world.dispose();
    }
  });
});
