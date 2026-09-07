/**
 * D236 — the Activity report's write-ledger block, folded through the ONE
 * ledger read-through.
 *
 * The block is the report's second authority (ref dashboard-surfaces §10.1's carve-out), so
 * everything asserted here is about the ledger being read as an AUDIT corpus
 * rather than as a projection of runs:
 *
 * - the window closes on the entry's own `confirmedAt`, never on the partition
 *   file's UTC name — a write confirmed late in the local day lands in the next
 *   UTC partition, and letting the file name decide would drop a real HR
 *   transaction out of the report over a timezone;
 * - a line the fold cannot READ throws by name rather than being skipped,
 *   because skipping it silently subtracts a filed transaction from the count
 *   of what was filed;
 * - an empty corpus answers with an empty block, which is the honest fact the
 *   surface's "nothing was filed" empty state renders.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { localDatePart } from "../../src/domain/clock.js";
import { deriveIdempotencyKeyDigest } from "../../src/domain/write-safety.js";
import { ledgerDirectory, ledgerFilePath } from "../../src/infra/ledger/ledger-projector.js";
import { createLedgerReadThrough } from "../../src/infra/ledger/ledger-read-through.js";
import { IDEMPOTENCY_KEY, LEDGER_PAYLOAD } from "../fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-ledger-fold-"));
  roots.push(root);
  mkdirSync(ledgerDirectory(root), { recursive: true });
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** The UTC calendar `<system>-<date>.jsonl` names partitions on. */
function shiftUtcDate(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

function entryLine(
  seq: number,
  overrides: Readonly<{ system?: string; instance?: "prod" | "test"; confirmedAt?: string }> = {},
): string {
  const system = overrides.system ?? "ucpath";
  return `${JSON.stringify({
    outboxId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    seq,
    payload: {
      ...LEDGER_PAYLOAD,
      system,
      // The digest is bound to `(system, key)`, so overriding the system must
      // re-derive it or the entry is refused before the fold ever sees it.
      idempotencyKeyDigest: deriveIdempotencyKeyDigest(system, IDEMPOTENCY_KEY),
      instance: overrides.instance ?? "prod",
      ...(overrides.confirmedAt === undefined ? {} : { confirmedAt: overrides.confirmedAt }),
    },
  })}\n`;
}

function writePartition(root: string, system: string, date: string, lines: readonly string[]): void {
  writeFileSync(ledgerFilePath(root, system, date), lines.join(""), "utf8");
}

/** The instant every fixture entry below confirms at, and its LOCAL day. */
const CONFIRMED_AT = "2026-08-03T18:30:00.000Z";
const DAY = localDatePart(new Date(CONFIRMED_AT));

describe("the Activity report's write-ledger fold (D236)", () => {
  it("answers an empty block over a state root that has filed nothing", () => {
    const root = stateRoot();
    assert.deepEqual(createLedgerReadThrough(root).foldActivityRange(DAY, DAY), { systems: [] });
  });

  it("folds by (system, instance) and orders by entries, then by system id", () => {
    const root = stateRoot();
    writePartition(root, "ucpath", shiftUtcDate(DAY, 0), [
      entryLine(0, { confirmedAt: CONFIRMED_AT }),
      entryLine(1, { confirmedAt: CONFIRMED_AT }),
      entryLine(2, { instance: "test", confirmedAt: CONFIRMED_AT }),
    ]);
    writePartition(root, "kuali", shiftUtcDate(DAY, 0), [
      entryLine(0, { system: "kuali", confirmedAt: CONFIRMED_AT }),
    ]);
    writePartition(root, "crm", shiftUtcDate(DAY, 0), [
      entryLine(0, { system: "crm", instance: "test", confirmedAt: CONFIRMED_AT }),
    ]);

    assert.deepEqual(createLedgerReadThrough(root).foldActivityRange(DAY, DAY), {
      systems: [
        { system: "ucpath", entries: 3, prod: 2, test: 1 },
        // The tie is broken by system id, so the block's order is TOTAL: a
        // report re-run over the same corpus cannot reshuffle its own rows.
        { system: "crm", entries: 1, prod: 0, test: 1 },
        { system: "kuali", entries: 1, prod: 1, test: 0 },
      ],
    });
  });

  it("places an entry by its own confirmation, not by the partition file it lives in", () => {
    const root = stateRoot();
    // A write confirmed late in the local day lands in the NEXT UTC partition —
    // exactly what a negative offset produces. The fold must still report it in
    // the local day the operator asked about.
    writePartition(root, "ucpath", shiftUtcDate(DAY, 1), [entryLine(0, { confirmedAt: CONFIRMED_AT })]);
    assert.deepEqual(createLedgerReadThrough(root).foldActivityRange(DAY, DAY), {
      systems: [{ system: "ucpath", entries: 1, prod: 1, test: 0 }],
    });
  });

  it("excludes an entry whose confirmation falls outside the window even in a partition it opened", () => {
    const root = stateRoot();
    const outside = "2026-08-06T18:30:00.000Z";
    writePartition(root, "ucpath", shiftUtcDate(DAY, 1), [
      entryLine(0, { confirmedAt: CONFIRMED_AT }),
      entryLine(1, { confirmedAt: outside }),
    ]);
    assert.deepEqual(createLedgerReadThrough(root).foldActivityRange(DAY, DAY), {
      systems: [{ system: "ucpath", entries: 1, prod: 1, test: 0 }],
    });
    // …and the same corpus over a window that covers both reports both.
    assert.deepEqual(
      createLedgerReadThrough(root).foldActivityRange(DAY, localDatePart(new Date(outside))),
      { systems: [{ system: "ucpath", entries: 2, prod: 2, test: 0 }] },
    );
  });

  it("refuses a line it cannot read rather than folding around it", () => {
    const root = stateRoot();
    writePartition(root, "ucpath", shiftUtcDate(DAY, 0), [
      entryLine(0, { confirmedAt: CONFIRMED_AT }),
      "{not json\n",
    ]);
    assert.throws(
      () => createLedgerReadThrough(root).foldActivityRange(DAY, DAY),
      /line 2 is not JSON.*cannot read/su,
    );
  });

  it("refuses a line whose shape is not a ledger entry", () => {
    const root = stateRoot();
    writePartition(root, "ucpath", shiftUtcDate(DAY, 0), [`${JSON.stringify({ seq: 0 })}\n`]);
    assert.throws(
      () => createLedgerReadThrough(root).foldActivityRange(DAY, DAY),
      /line 1 is not a ledger entry/su,
    );
  });

  it("refuses a partition holding another system's entry", () => {
    const root = stateRoot();
    writePartition(root, "ucpath", shiftUtcDate(DAY, 0), [
      entryLine(0, { system: "kuali", confirmedAt: CONFIRMED_AT }),
    ]);
    assert.throws(
      () => createLedgerReadThrough(root).foldActivityRange(DAY, DAY),
      /carries system kuali/su,
    );
  });

  it("refuses a window that ends before it starts", () => {
    const root = stateRoot();
    assert.throws(
      () => createLedgerReadThrough(root).foldActivityRange("2026-08-05", "2026-08-01"),
      /ends before it starts/u,
    );
  });
});
