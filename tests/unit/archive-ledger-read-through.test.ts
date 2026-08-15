/**
 * The archive's ledger READ-THROUGH (`docs/findings/archive.md`, "Write-ledger
 * action and confirmation number").
 *
 * D179's rule is that the ledger is never archived, so the archived record
 * names `(system, date, sequence)` and copies nothing. These cases pin both
 * halves of what that costs and buys: a pointer resolves against whatever the
 * live ledger holds NOW, and every way it can fail to resolve is a row with a
 * name on it rather than a row that quietly vanishes. The list of what a run
 * filed is the one list an operator must never see silently short.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { createLedgerReadThrough } from "../../src/infra/ledger/ledger-read-through.js";
import {
  LEDGER_PRESENTATION_DECLARATIONS,
  LedgerLinePointerSchema,
  resolveLedgerLine,
  type LedgerLinePointer,
} from "../../src/domain/archive/ledger-resolution.js";
import { deriveIdempotencyKeyDigest } from "../../src/domain/write-safety.js";
import { HASH_A, HASH_B, UUID_4 } from "./fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function stateRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "hrauto-ledger-read-"));
  roots.push(root);
  mkdirSync(join(root, "ledger"), { recursive: true });
  return root;
}

const KEY = "kuali:doc-4489:timekeeper-annotation";

/** The pointer, through its own schema — `sequence` is a branded non-negative. */
function at(system: string, date: string, sequence: number): LedgerLinePointer {
  return LedgerLinePointerSchema.parse({ system, date, sequence });
}

function entryPayload(overrides: Record<string, unknown> = {}) {
  return {
    workflowId: "kuali-timekeeper-annotation",
    itemId: UUID_4,
    system: "kuali",
    idempotencyKey: KEY,
    idempotencyKeyDigest: deriveIdempotencyKeyDigest("kuali", KEY),
    writeIntentId: "aa11bb22-0001-4000-8000-aa11bb220001",
    intentGeneration: 1,
    proof: { schemaHash: HASH_A, value: { readBack: "TK-2026" } },
    completionKind: "save-verify",
    proofSource: "normal-output",
    bindingProofDigest: HASH_B,
    subject: { state: "absent" },
    runId: "aa11bb22-0002-4000-8000-aa11bb220002",
    traceId: "kt-090400-aa11",
    attempt: 1,
    operator: "local-operator",
    instance: "prod",
    configFingerprint: HASH_B,
    dryRun: false,
    fencedAt: "2026-08-04T17:00:00.000Z",
    confirmedAt: "2026-08-04T17:00:16.000Z",
    externalOccurredAt: { state: "absent" },
    ...overrides,
  };
}

function writePartition(root: string, system: string, date: string, lines: readonly unknown[]): void {
  writeFileSync(
    join(root, "ledger", `${system}-${date}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
}

describe("resolving an archived run's ledger pointers", () => {
  it("reads the line back and names the system, the key and the instance", () => {
    const root = stateRoot();
    writePartition(root, "kuali", "2026-08-04", [
      { outboxId: "aa11bb22-0003-4000-8000-aa11bb220003", seq: 0, payload: entryPayload() },
    ]);

    const [line] = createLedgerReadThrough(root).resolve([
      at("kuali", "2026-08-04", 0),
    ]);
    assert.equal(line.state, "resolved");
    if (line.state !== "resolved") return;
    assert.equal(line.system, "kuali");
    assert.equal(line.instance, "prod");
    assert.equal(line.idempotencyKey, KEY);
    assert.equal(line.completionKind, "save-verify");
    assert.equal(line.confirmedAt, "2026-08-04T17:00:16.000Z");
    // The pointer rides back so a reader can see which line produced the row.
    assert.deepEqual({ ...line.pointer }, { system: "kuali", date: "2026-08-04", sequence: 0 });
  });

  it("reads sequence ZERO — the first line a system files on a day", () => {
    const root = stateRoot();
    writePartition(root, "kuali", "2026-08-04", [
      { outboxId: "aa11bb22-0003-4000-8000-aa11bb220003", seq: 0, payload: entryPayload() },
    ]);
    // The pointer schema declared `sequence` POSITIVE while nothing populated
    // it, which would have refused every first line of every partition.
    assert.equal(createLedgerReadThrough(root).resolve([at("kuali", "2026-08-04", 0)])[0].state, "resolved");
  });

  it("serves Action and Confirmation as reasoned absences until a contract declares them", () => {
    // Not an oversight: a ledger entry declares neither leaf, and its `proof`
    // is schema-bound to whichever commit contract wrote it, so reading a
    // field NAME out of it is the guess D204 bans on an HR record.
    assert.deepEqual([...LEDGER_PRESENTATION_DECLARATIONS], []);
    const resolved = resolveLedgerLine(
      at("kuali", "2026-08-04", 0),
      entryPayload(),
    );
    assert.equal(resolved.state, "resolved");
    if (resolved.state !== "resolved") return;
    assert.equal(resolved.action.state, "absent");
    assert.equal(resolved.confirmation.state, "absent");
    assert.match(resolved.action.state === "absent" ? resolved.action.reason : "", /no commit contract declares/);
  });

  it("names a MISSING partition rather than dropping the row", () => {
    const root = stateRoot();
    const [line] = createLedgerReadThrough(root).resolve([
      at("ucpath", "2026-08-04", 0),
    ]);
    assert.equal(line.state, "unresolved");
    if (line.state !== "unresolved") return;
    assert.equal(line.failure, "partition-missing");
    // The ledger is never pruned, so a missing partition is a real anomaly and
    // the reason says which one it is.
    assert.match(line.reason, /never pruned/);
  });

  it("names a sequence past the end of the partition", () => {
    const root = stateRoot();
    writePartition(root, "kuali", "2026-08-04", [
      { outboxId: "aa11bb22-0003-4000-8000-aa11bb220003", seq: 0, payload: entryPayload() },
    ]);
    const [line] = createLedgerReadThrough(root).resolve([
      at("kuali", "2026-08-04", 7),
    ]);
    assert.equal(line.state, "unresolved");
    assert.equal(line.state === "unresolved" ? line.failure : "", "sequence-missing");
  });

  it("names a malformed line instead of parsing past it", () => {
    const root = stateRoot();
    writeFileSync(join(root, "ledger", "kuali-2026-08-04.jsonl"), "{not json\n", "utf8");
    const [line] = createLedgerReadThrough(root).resolve([
      at("kuali", "2026-08-04", 0),
    ]);
    assert.equal(line.state, "unresolved");
    // Doc 09 §6 forbids projecting past ledger corruption; reading past it on
    // a trust surface is the same act with a friendlier face.
    assert.equal(line.state === "unresolved" ? line.failure : "", "line-malformed");
  });

  it("refuses a line whose own sequence disagrees with the pointer", () => {
    const root = stateRoot();
    writePartition(root, "kuali", "2026-08-04", [
      { outboxId: "aa11bb22-0003-4000-8000-aa11bb220003", seq: 4, payload: entryPayload() },
    ]);
    const [line] = createLedgerReadThrough(root).resolve([
      at("kuali", "2026-08-04", 0),
    ]);
    assert.equal(line.state, "unresolved");
    if (line.state !== "unresolved") return;
    assert.equal(line.failure, "sequence-mismatch");
    // Searching the neighbourhood for the "real" line is the tempting repair:
    // a pointer that followed a renumbering would cite a different
    // transaction than the archive was written to cite.
    assert.match(line.reason, /not searched around/);
  });

  it("keeps every pointer, in order, resolved or not", () => {
    const root = stateRoot();
    writePartition(root, "kuali", "2026-08-04", [
      { outboxId: "aa11bb22-0003-4000-8000-aa11bb220003", seq: 0, payload: entryPayload() },
      { outboxId: "aa11bb22-0004-4000-8000-aa11bb220004", seq: 1, payload: entryPayload({ instance: "test" }) },
    ]);
    const resolved = createLedgerReadThrough(root).resolve([
      at("kuali", "2026-08-04", 1),
      at("ucpath", "2026-08-04", 0),
      at("kuali", "2026-08-04", 0),
    ]);
    assert.deepEqual(resolved.map((line) => line.state), ["resolved", "unresolved", "resolved"]);
    assert.equal(resolved[0].state === "resolved" ? resolved[0].instance : "", "test");
  });
});
