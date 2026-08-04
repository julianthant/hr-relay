/**
 * Doc 09 §6's mechanical arms: one ordered projector, idempotent by outbox id,
 * loud on every disagreement, and a `ledger/` directory that NO cleanup path
 * can reach. Every arm is executed against a violating fixture so a dead arm
 * cannot stand in for enforcement.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import { EVENT_STREAMS } from "../../../src/infra/events/jsonl-streams.js";
import {
  LedgerDegradedReasonSchema,
  LedgerPartitionKeySchema,
  LedgerProjectionReportSchema,
  deriveLedgerLineDigest,
  ledgerPartitionOfInstant,
} from "../../../src/domain/ledger-projection.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/index.js";
import {
  createLedgerProjector,
  ledgerFilePath,
  ledgerLineForOutbox,
} from "../../../src/infra/ledger/index.js";
import { NOW } from "../fixtures/phase1c-contract-fixtures.js";
import { ledgerCommitFixture } from "../fixtures/ledger-projection-fixtures.js";
import { gitVisibleFiles, REPO_ROOT } from "./helpers/guard-files.js";

const LEDGER_OWNER_ROOT = "src/infra/ledger/";
const DELETION_PRIMITIVES = /\b(?:unlinkSync|unlink|rmSync|rmdirSync|rmdir|truncateSync|ftruncateSync|rimraf)\s*\(/;
const LEDGER_REFERENCE = /ledgerDirectory\s*\(|ledgerFilePath\s*\(|ledgerFileName\s*\(|["'`]ledger["'`]|\/ledger\//;

export interface ScannedSource {
  readonly path: string;
  readonly content: string;
}

/**
 * D86 gave `spans/` and `notes/` a 30-day prune and gave `ledger/` a retention
 * floor of FOREVER. A module that can both name the ledger and delete a file is
 * a route from "clean up the tracker" to "erase proof that a real HR
 * transaction was filed", so the two capabilities may never meet outside the
 * projector's own directory — and the projector itself deletes nothing.
 */
export function ledgerPruneReachabilityViolations(sources: readonly ScannedSource[]): readonly string[] {
  const violations: string[] = [];
  for (const source of sources) {
    const namesLedger = LEDGER_REFERENCE.test(source.content);
    const deletes = DELETION_PRIMITIVES.test(source.content);
    if (source.path.startsWith(LEDGER_OWNER_ROOT)) {
      if (deletes) violations.push(`${source.path}: the ledger owner module may not call a deletion primitive`);
      continue;
    }
    if (namesLedger && deletes) {
      violations.push(`${source.path}: a cleanup path can reach ledger/, which is never pruned (D86)`);
    }
  }
  return violations;
}

/**
 * Executors never append the ledger; exactly one module does (doc 09 §6). A
 * second appender would be a second sequence authority.
 */
export function ledgerSoleWriterViolations(sources: readonly ScannedSource[]): readonly string[] {
  const appends = /\bappendFileSync\s*\(|\bappendFile\s*\(|openSync\s*\([^)]*["'`]a["'`]/;
  return sources
    .filter((source) => !source.path.startsWith(LEDGER_OWNER_ROOT))
    .filter((source) => LEDGER_REFERENCE.test(source.content) && appends.test(source.content))
    .map((source) => `${source.path}: only ${LEDGER_OWNER_ROOT} may append the ledger`);
}

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-ledger-guard-"));
  roots.push(root);
  return root;
}

function open(root: string): AuthorityDatabase {
  const database = AuthorityDatabase.open(
    { path: join(root, "state.sqlite"), busyTimeoutMs: 250, migrationOwner: "ledger-guard" },
    manualClock(new Date(NOW)),
  );
  databases.push(database);
  return database;
}

function cleanup(): void {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
}

function productionSources(): readonly ScannedSource[] {
  return gitVisibleFiles(["src"])
    .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
    .map((path) => ({ path, content: readFileSync(join(REPO_ROOT, path), "utf8") }));
}

describe("ledger projector", () => {
  it("keeps every cleanup path structurally unable to reach ledger/", () => {
    assert.deepEqual(ledgerPruneReachabilityViolations(productionSources()), []);
    // The prune is blind to the ledger by construction, not by convention.
    assert.deepEqual([...EVENT_STREAMS], ["spans", "notes"]);
    const streams = readFileSync(join(REPO_ROOT, "src/infra/events/jsonl-streams.ts"), "utf8");
    assert.equal(LEDGER_REFERENCE.test(streams.replaceAll(/^\s*\*.*$|\/\*[\s\S]*?\*\//gm, "")), false);

    const violating: readonly ScannedSource[] = [
      {
        path: "src/services/cleanup/sweep.ts",
        content: "import { unlinkSync } from 'node:fs';\nexport const sweep = (root: string) => unlinkSync(`${root}/ledger/ucpath-2026-07-31.jsonl`);\n",
      },
      {
        path: "src/core/retention.ts",
        content: "import { ledgerDirectory } from '../infra/ledger/index.js';\nexport const purge = (root: string) => rmSync(ledgerDirectory(root), { recursive: true });\n",
      },
      {
        path: "src/infra/ledger/compactor.ts",
        content: "import { rmSync } from 'node:fs';\nexport const compact = (path: string) => rmSync(path);\n",
      },
    ];
    for (const source of violating) {
      assert.equal(
        ledgerPruneReachabilityViolations([source]).length,
        1,
        `${source.path} bypassed the never-pruned arm`,
      );
    }
    const allowed: readonly ScannedSource[] = [
      {
        path: "src/infra/events/jsonl-streams.ts",
        content: "import { unlinkSync } from 'node:fs';\nexport const prune = (path: string) => unlinkSync(`${path}/spans/onboarding-2026-07-31.jsonl`);\n",
      },
      {
        path: "src/infra/ledger/ledger-projector.ts",
        content: "export const ledgerDirectory = (root: string) => `${root}/ledger`;\n",
      },
    ];
    assert.deepEqual(ledgerPruneReachabilityViolations(allowed), []);
  });

  it("keeps the ledger to one appender", () => {
    assert.deepEqual(ledgerSoleWriterViolations(productionSources()), []);
    assert.equal(
      ledgerSoleWriterViolations([{
        path: "src/core/write-sequencer.ts",
        content: "import { appendFileSync } from 'node:fs';\nexport const emit = (root: string, line: string) => appendFileSync(`${root}/ledger/ucpath.jsonl`, line);\n",
      }]).length,
      1,
    );
  });

  it("derives one line and one digest per (outbox, sequence), with a separated hash", () => {
    const fixture = ledgerCommitFixture(0);
    const root = newRoot();
    try {
      const database = open(root);
      database.authority.writeIntents.fenceAttempt({ intent: fixture.intent, attempt: fixture.attempt });
      database.commitWriteAttempt(fixture.commit);
      const outbox = database.authority.ledgerProjection.getOutbox(fixture.outboxId);
      assert.notEqual(outbox, undefined);
      if (outbox === undefined) return;

      const line = ledgerLineForOutbox(outbox, 0);
      assert.equal(ledgerLineForOutbox(outbox, 0), line, "line derivation is not deterministic");
      assert.notEqual(ledgerLineForOutbox(outbox, 1), line, "sequence is not part of the projected line");
      assert.equal(line.includes("\n"), false);
      assert.equal(deriveLedgerLineDigest(line), deriveLedgerLineDigest(line));
      assert.notEqual(deriveLedgerLineDigest(line), deriveLedgerLineDigest(`${line} `));
      // A domain separator, so a ledger line digest can never collide with a
      // fingerprint derived over the same bytes for another purpose.
      assert.notEqual(deriveLedgerLineDigest(line), deriveLedgerLineDigest(`hrauto:ledger-line:v1 ${line}`));
      // The partition comes from the entry, never from wall-clock now.
      assert.equal(ledgerPartitionOfInstant(fixture.confirmedAt), "2026-07-31");
      assert.equal(ledgerPartitionOfInstant("2026-08-01T00:30:00.000+02:00"), "2026-07-31");
    } finally {
      cleanup();
    }
  });

  it("is idempotent by outbox id and refuses a second sequence or a conflicting line", () => {
    const root = newRoot();
    try {
      const database = open(root);
      const fixture = ledgerCommitFixture(0);
      database.authority.writeIntents.fenceAttempt({ intent: fixture.intent, attempt: fixture.attempt });
      database.commitWriteAttempt(fixture.commit);
      const repository = database.authority.ledgerProjection;
      const lease = repository.acquireLease({
        system: "ucpath", date: "2026-07-31", projectorId: "guard-a", now: NOW, expiresAt: "2026-07-31T17:30:00.000Z",
      });
      assert.equal(lease.state, "acquired");
      if (lease.state !== "acquired") return;
      const outbox = repository.getOutbox(fixture.outboxId);
      if (outbox === undefined) throw new Error("guard fixture lost its outbox");
      const digest = deriveLedgerLineDigest(ledgerLineForOutbox(outbox, 0));
      const request = {
        system: "ucpath",
        date: "2026-07-31",
        projectorId: "guard-a",
        leaseGeneration: lease.partition.leaseGeneration,
        outboxId: fixture.outboxId,
        lineDigest: digest,
        assignedAt: NOW,
      };
      const first = repository.assignSequence(request);
      assert.equal(first.seq, 0);
      assert.deepEqual(repository.assignSequence(request), first, "assignment is not idempotent by outbox id");
      assert.equal(repository.getPartition("ucpath", "2026-07-31")?.nextSeq, 1, "a repeat assignment burned a sequence");
      assert.throws(
        () => repository.assignSequence({ ...request, lineDigest: "b".repeat(64) }),
        /already assigned sequence/,
      );
      // A projector that no longer holds the lease cannot advance anything.
      assert.throws(
        () => repository.assignSequence({ ...request, projectorId: "guard-b", outboxId: fixture.outboxId }),
        /is not leased to/,
      );
      const { assignedAt: _assignedAt, ...appendBase } = request;
      assert.throws(
        () => repository.markAppended({ ...appendBase, appendedAt: NOW, projectorId: "guard-b" }),
        /is not leased to/,
      );
    } finally {
      cleanup();
    }
  });

  it("degrades read-only when a partition sequence is not dense", () => {
    const root = newRoot();
    try {
      const path = join(root, "state.sqlite");
      const database = open(root);
      for (const index of [0, 1]) {
        const fixture = ledgerCommitFixture(index);
        database.authority.writeIntents.fenceAttempt({ intent: fixture.intent, attempt: fixture.attempt });
        database.commitWriteAttempt(fixture.commit);
      }
      const report = createLedgerProjector(database, manualClock(new Date(NOW)), {
        stateRoot: root, projectorId: "guard-a", leaseMs: 30_000,
      }).project(LedgerPartitionKeySchema.parse({ system: "ucpath", date: "2026-07-31" }));
      assert.equal(report.state, "projected");
      assert.equal(readFileSync(ledgerFilePath(root, "ucpath", "2026-07-31"), "utf8").split("\n").filter(Boolean).length, 2);
      database.close();
      databases.splice(databases.indexOf(database), 1);

      const raw = new DatabaseSync(path);
      raw.prepare("UPDATE ledger_partitions SET next_seq = 5, record_json = json_set(record_json, '$.nextSeq', 5), version = version + 1 WHERE record_key = ?")
        .run("ucpath:2026-07-31");
      raw.close();
      assert.throws(
        () => AuthorityDatabase.inspectExistingReadOnly(path),
        /ledger-partition-sequence-is-dense/,
      );
    } finally {
      cleanup();
    }
  });

  it("keeps degraded health a closed, non-continuable outcome", () => {
    assert.deepEqual([...LedgerDegradedReasonSchema.options].sort(), [
      "duplicate-outbox",
      "duplicate-sequence",
      "line-digest-mismatch",
      "malformed-tail",
      "missing-outbox-payload",
      "sequence-authority-mismatch",
      "sequence-gap",
      "sequence-out-of-order",
      "unrecorded-line",
    ]);
    const partition = { system: "ucpath" as const, date: "2026-07-31" };
    assert.equal(LedgerProjectionReportSchema.safeParse({
      state: "degraded", partition, reason: "looks-fine", detail: "continued anyway",
    }).success, false);
    assert.equal(LedgerProjectionReportSchema.safeParse({
      state: "degraded", partition, reason: "sequence-gap",
    }).success, false, "a degraded report must name what disagreed");
    assert.equal(LedgerProjectionReportSchema.safeParse({
      state: "projected", partition, appended: [], repaired: [], remarked: [], nextSeq: 0, reason: "sequence-gap",
    }).success, false, "a projected report cannot smuggle a degraded reason");
  });

  it("registers this guard file under its inventory name", () => {
    assert.equal(relative(REPO_ROOT, import.meta.filename).replaceAll("\\", "/"),
      "tests/unit/architecture/ledger-projector.test.ts");
  });
});
