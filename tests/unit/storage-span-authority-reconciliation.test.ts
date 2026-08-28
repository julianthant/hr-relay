import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { createSpanJsonlWriter } from "../../src/infra/events/span-jsonl-writer.js";
import {
  doctorAuthorityStorage,
  reconcileSpanAuthority,
  summarizeSpanAuthorityReconciliation,
} from "../../src/infra/sqlite/storage-doctor.js";
import {
  AuthorityDatabase,
  AuthorityRunIdentityReadError,
} from "../../src/infra/sqlite/authority-database.js";
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

function emitRunEvent(root: string, event: Readonly<Record<string, unknown>>): void {
  createSpanJsonlWriter({ stateRoot: root, clock: manualClock(new Date(NOW)), pid: 4242 }).emit(event);
}

function writeRunRoot(
  root: string,
  runId: string,
  itemId: string,
  traceId: string,
  options: Readonly<{ dryRun?: boolean; instance?: "prod" | "test" }> = {},
): void {
  emitRunEvent(root, {
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
    dryRun: options.dryRun ?? true,
    actorId: "local-operator",
    title: "Redacted test run",
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    resolvedInstance: { ucpath: options.instance ?? "test" },
    configFingerprint: HASH_B,
    configSnapshotId: UUID_6,
  });
}

function currentIdentity(runId: string, itemId: string, traceId: string) {
  return {
    source: "current" as const,
    runId,
    workflow: "person-lookup",
    itemId,
    traceId,
    attempt: 1,
    shape: "single" as const,
    priority: "interactive" as const,
    dryRun: true,
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    resolvedInstance: { ucpath: "test" as const },
    configFingerprint: HASH_B,
    configSnapshotId: UUID_6,
  };
}

function archivedIdentity(runId: string, itemId: string, traceId: string) {
  const { configSnapshotId: _configSnapshotId, ...identity } = currentIdentity(runId, itemId, traceId);
  return { ...identity, source: "archived" as const };
}

describe("storage doctor span/authority reconciliation", () => {
  it("names current, archived, missing-span, and unaccounted identities without substituting one for another", () => {
    const root = stateRoot();
    writeRunRoot(root, UUID_1, UUID_4, "pl-120000-0000");
    writeRunRoot(root, UUID_2, UUID_5, "pl-120001-0000");
    writeRunRoot(root, UUID_3, UUID_6, "pl-120002-0000");

    const report = reconcileSpanAuthority(root, {
      currentRuns: [
        currentIdentity(UUID_1, UUID_4, "pl-120000-0000"),
        currentIdentity(UUID_4, UUID_1, "pl-120003-0000"),
      ],
      archivedRuns: [archivedIdentity(UUID_2, UUID_5, "pl-120001-0000")],
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
      currentRuns: [currentIdentity(UUID_1, UUID_4, "pl-120000-0000")],
      archivedRuns: [],
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

  it("names conflicting duplicate run.queued roots as malformed instead of reconciling the run-id set", () => {
    const root = stateRoot();
    writeRunRoot(root, UUID_1, UUID_4, "pl-120000-0000");
    writeRunRoot(root, UUID_1, UUID_5, "pl-120000-0000");

    const report = reconcileSpanAuthority(root, {
      currentRuns: [currentIdentity(UUID_1, UUID_4, "pl-120000-0000")],
      archivedRuns: [],
      malformedRecords: [],
    });

    assert.equal(report.state, "malformed");
    if (report.state !== "malformed") return;
    assert.deepEqual(report.findings, [{
      kind: "malformed-span",
      fileName: "person-lookup-2026-07-31.jsonl",
      lineNumber: 2,
      detail: `run ${UUID_1} has conflicting duplicate run.queued roots`,
    }]);
    assert.equal(summarizeSpanAuthorityReconciliation(report).state, "degraded");
  });

  it("rejects a root whose immutable tuple conflicts with the exact current authority row", () => {
    const root = stateRoot();
    writeRunRoot(root, UUID_1, UUID_4, "pl-120000-0000");

    const report = reconcileSpanAuthority(root, {
      currentRuns: [currentIdentity(UUID_1, UUID_5, "pl-120000-0000")],
      archivedRuns: [],
      malformedRecords: [],
    });

    assert.equal(report.state, "malformed");
    if (report.state !== "malformed") return;
    assert.deepEqual(report.findings, [{
      kind: "malformed-span",
      fileName: "person-lookup-2026-07-31.jsonl",
      lineNumber: 1,
      detail: `run ${UUID_1} run.queued root does not match current authority fields: itemId`,
    }]);
  });

  it("compares resolved instance identity canonically rather than by object insertion order", () => {
    const root = stateRoot();
    emitRunEvent(root, {
      t: "run.queued",
      kind: "run",
      ts: NOW,
      workflow: "person-lookup",
      runId: UUID_1,
      attempt: 1,
      traceId: "pl-120000-0000",
      spanPath: "pl-120000-0000",
      itemId: UUID_4,
      shape: "single",
      priority: "interactive",
      dryRun: true,
      actorId: "local-operator",
      title: "Redacted test run",
      descriptorVersion: 1,
      contractFingerprint: HASH_A,
      resolvedInstance: { ucpath: "test", crm: "prod" },
      configFingerprint: HASH_B,
      configSnapshotId: UUID_6,
    });

    assert.deepEqual(reconcileSpanAuthority(root, {
      currentRuns: [{
        ...currentIdentity(UUID_1, UUID_4, "pl-120000-0000"),
        resolvedInstance: { crm: "prod", ucpath: "test" },
      }],
      archivedRuns: [],
      malformedRecords: [],
    }), {
      state: "complete",
      counts: { current: 1, archived: 0, missingSpan: 0, unaccounted: 0 },
      findings: [],
    });
  });

  it("names a non-increasing requeue attempt as malformed", () => {
    const root = stateRoot();
    writeRunRoot(root, UUID_1, UUID_4, "pl-120000-0000");
    emitRunEvent(root, {
      t: "run.requeued",
      ts: NOW,
      workflow: "person-lookup",
      runId: UUID_1,
      attempt: 1,
      traceId: "pl-120000-0000",
      spanPath: "pl-120000-0000",
      cause: "recovery",
      nextAttempt: 1,
    });

    const report = reconcileSpanAuthority(root, {
      currentRuns: [{ ...currentIdentity(UUID_1, UUID_4, "pl-120000-0000"), attempt: 1 }],
      archivedRuns: [],
      malformedRecords: [],
    });

    assert.equal(report.state, "malformed");
    if (report.state !== "malformed") return;
    assert.ok(report.findings.some((finding) => finding.kind === "malformed-span"
      && finding.detail === `run ${UUID_1} run.requeued does not advance to a strictly greater attempt`));
  });

  it("accepts a skipped attempt allocation when the exact authority attempt agrees", () => {
    const root = stateRoot();
    writeRunRoot(root, UUID_1, UUID_4, "pl-120000-0000");
    emitRunEvent(root, {
      t: "run.requeued",
      ts: NOW,
      workflow: "person-lookup",
      runId: UUID_1,
      attempt: 1,
      traceId: "pl-120000-0000",
      spanPath: "pl-120000-0000",
      cause: "recovery",
      nextAttempt: 3,
    });

    assert.deepEqual(reconcileSpanAuthority(root, {
      currentRuns: [{ ...currentIdentity(UUID_1, UUID_4, "pl-120000-0000"), attempt: 3 }],
      archivedRuns: [],
      malformedRecords: [],
    }), {
      state: "complete",
      counts: { current: 1, archived: 0, missingSpan: 0, unaccounted: 0 },
      findings: [],
    });
  });

  it.each([
    {
      caseName: "foreign workflow",
      event: {
        t: "run.claimed", ts: NOW, workflow: "ucpath-person-search", runId: UUID_1, attempt: 1,
        traceId: "pl-120000-0000", spanPath: "pl-120000-0000", workerId: "worker-1",
      },
      detail: `run ${UUID_1} run.claimed carries a foreign workflow identity`,
    },
    {
      caseName: "foreign trace and root path",
      event: {
        t: "run.claimed", ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
        traceId: "zz-120000-0000", spanPath: "zz-120000-0000", workerId: "worker-1",
      },
      detail: `run ${UUID_1} run.claimed carries a foreign trace identity`,
    },
    {
      caseName: "out-of-order attempt",
      event: {
        t: "run.claimed", ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 2,
        traceId: "pl-120000-0000", spanPath: "pl-120000-0000", workerId: "worker-1",
      },
      detail: `run ${UUID_1} run.claimed carries an out-of-order attempt`,
    },
    {
      caseName: "foreign task root",
      event: {
        t: "span.started", kind: "task", ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
        traceId: "pl-120000-0000", spanPath: "pl-120001-0000/searching#1",
        parentSpanPath: "pl-120001-0000", name: "searching",
      },
      detail: `run ${UUID_1} span.started task identity is not a child of the run root`,
    },
    {
      caseName: "task end before start",
      event: {
        t: "span.ended", kind: "task", ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
        traceId: "pl-120000-0000", spanPath: "pl-120000-0000/searching#1",
        parentSpanPath: "pl-120000-0000", outcome: "done",
      },
      detail: `run ${UUID_1} task span ends before its matching start`,
    },
  ])("names $caseName instead of accepting a matching run-id set", ({ event, detail }) => {
    const root = stateRoot();
    writeRunRoot(root, UUID_1, UUID_4, "pl-120000-0000");
    emitRunEvent(root, event);

    const report = reconcileSpanAuthority(root, {
      currentRuns: [currentIdentity(UUID_1, UUID_4, "pl-120000-0000")],
      archivedRuns: [],
      malformedRecords: [],
    });
    assert.equal(report.state, "malformed");
    if (report.state !== "malformed") return;
    assert.ok(report.findings.some((finding) => finding.kind === "malformed-span" && finding.detail === detail));
  });

  it("rejects a run.queued event whose span path is not its exact trace root", () => {
    const root = stateRoot();
    emitRunEvent(root, {
      t: "run.queued", kind: "run", ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
      traceId: "pl-120000-0000", spanPath: "pl-120000-0000/not-root", itemId: UUID_4,
      shape: "single", priority: "interactive", dryRun: true, actorId: "local-operator",
      title: "Redacted test run", descriptorVersion: 1, contractFingerprint: HASH_A,
      resolvedInstance: { ucpath: "test" }, configFingerprint: HASH_B, configSnapshotId: UUID_6,
    });

    const report = reconcileSpanAuthority(root, {
      currentRuns: [currentIdentity(UUID_1, UUID_4, "pl-120000-0000")],
      archivedRuns: [],
      malformedRecords: [],
    });
    assert.equal(report.state, "malformed");
    if (report.state !== "malformed") return;
    assert.equal(report.findings[0]?.kind, "malformed-span");
    assert.equal(report.findings[0]?.detail, `run ${UUID_1} run.queued root path does not equal its trace root`);
  });

  it("names a task event that precedes its run root as malformed ordering", () => {
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
      currentRuns: [currentIdentity(UUID_1, UUID_4, "pl-120000-0000")],
      archivedRuns: [],
      malformedRecords: [],
    }), {
      state: "malformed",
      findings: [{
        kind: "malformed-span",
        fileName: "person-lookup-2026-07-31.jsonl",
        lineNumber: 1,
        detail: `run ${UUID_1} span.started appears before its run.queued root`,
      }],
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

    assert.throws(
      () => AuthorityDatabase.inspectRunIdentitiesReadOnly(authorityPath, 500),
      (error: unknown) => error instanceof AuthorityRunIdentityReadError
        && error.source === "current"
        && error.recordKey === QUEUED_RUN.envelope.runId
        && error.detail === "tasks record failed its strict authority schema",
    );
  });

  it("projects a strict authority row read failure as named malformed authority", async () => {
    const root = stateRoot();
    const authorityPath = join(root, "state.db");
    const authority = AuthorityDatabase.open(
      { path: authorityPath, busyTimeoutMs: 500, migrationOwner: "span-authority-doctor-test" },
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

    const report = await doctorAuthorityStorage({
      authorityPath,
      spanRoot: root,
      backupDirectory: join(root, "backups"),
      maxBackupAgeMs: 60_000,
      busyTimeoutMs: 500,
    }, manualClock(new Date(NOW)));
    assert.deepEqual(report.spanAuthority, {
      state: "malformed",
      findings: [{
        kind: "malformed-authority",
        source: "current",
        recordKey: QUEUED_RUN.envelope.runId,
        detail: "tasks record failed its strict authority schema",
      }],
    });
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
    writeRunRoot(
      root,
      ARCHIVED_RUN.runId,
      QUEUED_RUN.envelope.itemId,
      QUEUED_RUN.envelope.traceId,
      { dryRun: false, instance: "prod" },
    );

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
