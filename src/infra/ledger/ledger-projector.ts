/**
 * Ref write-safety §6 — the ordered, actor-attributed ledger projector.
 *
 * Executors never append `ledger/`. Beat ⑦ leaves an unsequenced
 * `ledger-entry` outbox row inside the atomic write-commit transaction; this
 * module is the only writer of `<stateRoot>/ledger/<system>-<date>.jsonl`.
 *
 * The order of durable facts is fixed, and it is what makes every crash window
 * repairable:
 *
 *   1. take the `(system, date)` lease (SQLite, CAS on the exact generation);
 *   2. reconcile the file against authority — STOP on any disagreement;
 *   3. assign the next `seq` and store the exact line digest (SQLite);
 *   4. append that one line and `fsync` (disk);
 *   5. mark the projection appended and the outbox projected (SQLite).
 *
 * A crash between 3 and 4 leaves an `assigned` row whose line is fully
 * determined by the stored outbox payload plus its stored `seq`, so recovery
 * re-derives the SAME bytes and compares the digest. A crash between 4 and 5
 * leaves a line on disk whose digest matches an `assigned` row, so recovery
 * skips the append and only marks it. Nothing is invented, rewritten, or
 * skipped past: duplicate, gap, out-of-order, malformed-tail, and digest
 * mismatch each STOP the partition and report degraded health.
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import {
  BrowserSystemIdSchema,
  DateOnlySchema,
  LedgerProjectorIdSchema,
} from "../../domain/ids.js";
import { LedgerEntrySchema, type LedgerEntry } from "../../domain/ledger.js";
import {
  LedgerPartitionKeySchema,
  LedgerProjectionReportSchema,
  deriveLedgerLineDigest,
  ledgerLineText,
  ledgerPartitionOfInstant,
  type LedgerDegradedReason,
  type LedgerPartitionKey,
  type LedgerProjectionRecord,
  type LedgerProjectionReport,
} from "../../domain/ledger-projection.js";
import type { AtomicOutboxRecord } from "../../domain/outbox.js";
import type { AuthorityDatabase } from "../sqlite/authority-database.js";

const LEDGER_DIRECTORY = "ledger";
const LEDGER_FILE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{4}-\d{2}-\d{2})\.jsonl$/;

export const LedgerProjectorOptionsSchema = z.strictObject({
  stateRoot: z.string().min(1),
  projectorId: LedgerProjectorIdSchema,
  leaseMs: z.number().int().positive(),
});

/**
 * `.tracker/ledger/` (ref dashboard-surfaces §2.1). Deliberately NOT reachable from
 * `pruneEventStreams`, which can only see `spans/` and `notes/`: the ledger's
 * retention floor is "forever" (D86), and a prune path that could name this
 * directory would be a way to delete proof of a real HR transaction.
 */
export function ledgerDirectory(stateRoot: string): string {
  return join(stateRoot, LEDGER_DIRECTORY);
}

export function ledgerFileName(system: string, date: string): string {
  const key = LedgerPartitionKeySchema.parse({ system, date });
  return `${key.system}-${key.date}.jsonl`;
}

export function ledgerFilePath(stateRoot: string, system: string, date: string): string {
  return join(ledgerDirectory(stateRoot), ledgerFileName(system, date));
}

export const LedgerFilePartitionSchema = z.strictObject({
  system: BrowserSystemIdSchema,
  date: DateOnlySchema,
  path: z.string().min(1),
});

/**
 * Every ledger file on disk. A file that does not match
 * `<system>-<date>.jsonl` is a corruption of an owned directory and fails loud
 * rather than being skipped — skipping it would exclude filed transactions
 * from every reconciliation that follows.
 */
export function listLedgerFiles(stateRoot: string): readonly z.infer<typeof LedgerFilePartitionSchema>[] {
  const directory = ledgerDirectory(stateRoot);
  if (!existsSync(directory)) return [];
  const partitions: z.infer<typeof LedgerFilePartitionSchema>[] = [];
  for (const name of readdirSync(directory)) {
    const match = LEDGER_FILE_PATTERN.exec(name);
    if (match === null) {
      throw new Error(`ledger/ contains ${name}, which is not a <system>-<date>.jsonl partition file; refusing to enumerate around it`);
    }
    partitions.push(LedgerFilePartitionSchema.parse({
      system: match[1],
      date: match[2],
      path: join(directory, name),
    }));
  }
  return Object.freeze(partitions.sort((a, b) => (
    a.date === b.date ? a.system.localeCompare(b.system) : a.date.localeCompare(b.date)
  )));
}

const LedgerFileStateSchema = z.strictObject({
  lines: z.array(z.string()),
  /** A file whose last byte is not a newline, or which holds a blank line, was torn. */
  torn: z.boolean(),
});

function readLedgerFileState(path: string): z.infer<typeof LedgerFileStateSchema> {
  if (!existsSync(path)) return LedgerFileStateSchema.parse({ lines: [], torn: false });
  const text = readFileSync(path, "utf8");
  if (text === "") return LedgerFileStateSchema.parse({ lines: [], torn: false });
  if (!text.endsWith("\n")) return LedgerFileStateSchema.parse({ lines: [], torn: true });
  const lines = text.slice(0, -1).split("\n");
  return LedgerFileStateSchema.parse({ lines, torn: lines.some((line) => line === "") });
}

/**
 * "This line is not a ledger entry" has to be DATA so the projector can report
 * the degraded reason rather than crashing the sweep; the closed union makes a
 * malformed line impossible to mistake for a parsed entry.
 */
const ParsedLedgerLine = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("entry"), entry: LedgerEntrySchema }),
  z.strictObject({ state: z.literal("malformed"), reason: z.string().min(1) }),
]);

function parseLedgerLine(line: string): { state: "entry"; entry: LedgerEntry } | { state: "malformed"; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (error) {
    return ParsedLedgerLine.parse({
      state: "malformed",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  const parsed = LedgerEntrySchema.safeParse(json);
  return parsed.success
    ? ParsedLedgerLine.parse({ state: "entry", entry: parsed.data })
    : ParsedLedgerLine.parse({ state: "malformed", reason: parsed.error.message });
}

function appendLedgerLine(path: string, line: string): void {
  if (line.includes("\n")) {
    throw new Error(`refusing to append a multi-line ledger record to ${path}: JSONL is one line per filed transaction`);
  }
  mkdirSync(dirname(path), { recursive: true });
  const handle = openSync(path, "a");
  try {
    writeSync(handle, `${line}\n`);
    // The whole point of the ledger is surviving the crash that follows.
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

/** The exact bytes an outbox row projects at a given sequence. */
export function ledgerLineForOutbox(outbox: AtomicOutboxRecord, seq: number): string {
  if (outbox.payload.kind !== "ledger-entry") {
    throw new Error(`outbox ${outbox.outboxId} is not a ledger-entry row and projects no ledger line`);
  }
  return ledgerLineText({ outboxId: outbox.outboxId, seq, payload: outbox.payload.entry });
}

const DegradedSchema = z.strictObject({
  reason: LedgerProjectionReportSchema.options[2].shape.reason,
  detail: z.string().min(1),
});

export interface LedgerProjector {
  readonly projectorId: string;
  partitionsWithWork(): readonly LedgerPartitionKey[];
  project(partition: LedgerPartitionKey): LedgerProjectionReport;
  projectAll(): readonly LedgerProjectionReport[];
}

export function createLedgerProjector(
  database: AuthorityDatabase,
  clock: Clock,
  optionsInput: unknown,
): LedgerProjector {
  const options = LedgerProjectorOptionsSchema.parse(optionsInput);
  const repository = database.authority.ledgerProjection;

  const partitionOf = (outbox: AtomicOutboxRecord): LedgerPartitionKey => {
    if (outbox.payload.kind !== "ledger-entry") {
      throw new Error(`outbox ${outbox.outboxId} is not a ledger-entry row`);
    }
    return LedgerPartitionKeySchema.parse({
      system: outbox.payload.entry.system,
      date: ledgerPartitionOfInstant(outbox.payload.entry.confirmedAt),
    });
  };

  const degraded = (reason: LedgerDegradedReason, detail: string): z.infer<typeof DegradedSchema> =>
    DegradedSchema.parse({ reason, detail });

  /**
   * Compare the partition file against its assignment rows. Returns a degraded
   * reason if they disagree in ANY way, otherwise the assignments whose line is
   * still missing from disk.
   */
  const reconcile = (
    partition: LedgerPartitionKey,
    assignments: readonly LedgerProjectionRecord[],
  ): z.infer<typeof DegradedSchema> | { readonly missing: readonly LedgerProjectionRecord[] } => {
    const path = ledgerFilePath(options.stateRoot, partition.system, partition.date);
    const file = readLedgerFileState(path);
    if (file.torn) {
      return degraded("malformed-tail", `${path} ends mid-append or holds a blank line`);
    }
    const bySeq = new Map<number, LedgerProjectionRecord>();
    for (const assignment of assignments) bySeq.set(assignment.seq, assignment);
    if (bySeq.size !== assignments.length) {
      return degraded("duplicate-sequence", `${path} partition holds two assignments for one sequence`);
    }
    if (file.lines.length > assignments.length) {
      return degraded(
        "unrecorded-line",
        `${path} holds ${String(file.lines.length)} lines but authority recorded ${String(assignments.length)} assignments`,
      );
    }

    const seenOutboxIds = new Set<string>();
    for (const [index, line] of file.lines.entries()) {
      const parsed = parseLedgerLine(line);
      if (parsed.state === "malformed") {
        return degraded("malformed-tail", `${path} line ${String(index + 1)} is not a strict ledger entry: ${parsed.reason}`);
      }
      if (parsed.entry.seq !== index) {
        return parsed.entry.seq < index
          ? degraded("sequence-out-of-order", `${path} line ${String(index + 1)} carries sequence ${String(parsed.entry.seq)}`)
          : degraded("sequence-gap", `${path} jumps to sequence ${String(parsed.entry.seq)} at line ${String(index + 1)}`);
      }
      if (seenOutboxIds.has(parsed.entry.outboxId)) {
        return degraded("duplicate-outbox", `${path} projects outbox ${parsed.entry.outboxId} twice`);
      }
      seenOutboxIds.add(parsed.entry.outboxId);
      const assignment = bySeq.get(index);
      if (assignment === undefined) {
        return degraded("unrecorded-line", `${path} line ${String(index + 1)} has no assignment row`);
      }
      if (assignment.outboxId !== parsed.entry.outboxId) {
        return degraded(
          "sequence-out-of-order",
          `${path} sequence ${String(index)} projects ${parsed.entry.outboxId}, authority assigned it to ${assignment.outboxId}`,
        );
      }
      if (deriveLedgerLineDigest(line) !== assignment.lineDigest) {
        return degraded("line-digest-mismatch", `${path} line ${String(index + 1)} does not match its recorded digest`);
      }
    }

    // Everything on disk is accounted for. What remains are assignments whose
    // append never landed — the crash-between-3-and-4 window.
    const missing = assignments.filter(({ seq }) => seq >= file.lines.length);
    for (const assignment of missing) {
      if (assignment.lifecycle.state === "appended") {
        return degraded(
          "unrecorded-line",
          `${path} is missing sequence ${String(assignment.seq)}, which authority already recorded as appended`,
        );
      }
    }
    return { missing };
  };

  const project = (partitionInput: LedgerPartitionKey): LedgerProjectionReport => {
    const partition = LedgerPartitionKeySchema.parse(partitionInput);
    const startedAt = clock.now();
    const lease = repository.acquireLease({
      system: partition.system,
      date: partition.date,
      projectorId: options.projectorId,
      now: startedAt.toISOString(),
      expiresAt: new Date(startedAt.getTime() + options.leaseMs).toISOString(),
    });
    if (lease.state === "held") {
      if (lease.partition.lease.state !== "held") {
        throw new Error(`ledger partition ${partition.system}-${partition.date} reported a held lease with no holder`);
      }
      return LedgerProjectionReportSchema.parse({
        state: "lease-held",
        partition,
        holder: lease.partition.lease.holder,
        expiresAt: lease.partition.lease.expiresAt,
      });
    }
    const leaseGeneration = lease.partition.leaseGeneration;
    const path = ledgerFilePath(options.stateRoot, partition.system, partition.date);
    const confirm = (record: LedgerProjectionRecord, appendedAt: string): LedgerProjectionRecord =>
      repository.markAppended({
        system: partition.system,
        date: partition.date,
        projectorId: options.projectorId,
        leaseGeneration,
        outboxId: record.outboxId,
        lineDigest: record.lineDigest,
        appendedAt,
      });

    try {
      const reconciliation = reconcile(partition, repository.listProjections(partition.system, partition.date));
      if ("reason" in reconciliation) {
        return LedgerProjectionReportSchema.parse({ state: "degraded", partition, ...reconciliation });
      }

      const repaired: LedgerProjectionRecord[] = [];
      const remarked: string[] = [];

      // Beat-4 recovery: a sequence was assigned, the append never landed.
      for (const assignment of reconciliation.missing) {
        const outbox = repository.getOutbox(assignment.outboxId);
        if (outbox === undefined) {
          return LedgerProjectionReportSchema.parse({
            state: "degraded",
            partition,
            ...degraded(
              "missing-outbox-payload",
              `assignment for outbox ${assignment.outboxId} has no durable payload to re-derive its line from`,
            ),
          });
        }
        const line = ledgerLineForOutbox(outbox, assignment.seq);
        if (deriveLedgerLineDigest(line) !== assignment.lineDigest) {
          return LedgerProjectionReportSchema.parse({
            state: "degraded",
            partition,
            ...degraded(
              "line-digest-mismatch",
              `outbox ${assignment.outboxId} no longer re-derives the line recorded at sequence ${String(assignment.seq)}`,
            ),
          });
        }
        appendLedgerLine(path, line);
        repaired.push(confirm(assignment, clock.now().toISOString()));
      }

      // Beat-5 recovery: the line landed and the projection was marked, but the
      // outbox row was never flipped. `markAppended` is idempotent, so this
      // repairs the outbox without touching the line.
      for (const assignment of repository.listProjections(partition.system, partition.date)) {
        if (assignment.lifecycle.state !== "appended") continue;
        const outbox = repository.getOutbox(assignment.outboxId);
        if (outbox === undefined || outbox.projection.state === "projected") continue;
        confirm(assignment, assignment.lifecycle.appendedAt);
        remarked.push(assignment.outboxId);
      }

      const appended: LedgerProjectionRecord[] = [];
      for (const outbox of repository.listPendingOutbox()) {
        const target = partitionOf(outbox);
        if (target.system !== partition.system || target.date !== partition.date) continue;
        if (repository.getProjection(outbox.outboxId) !== undefined) continue;
        const current = repository.getPartition(partition.system, partition.date);
        if (current === undefined) throw new Error(`ledger partition for ${path} vanished while leased`);
        const line = ledgerLineForOutbox(outbox, current.nextSeq);
        const assignment = repository.assignSequence({
          system: partition.system,
          date: partition.date,
          projectorId: options.projectorId,
          leaseGeneration,
          outboxId: outbox.outboxId,
          lineDigest: deriveLedgerLineDigest(line),
          assignedAt: clock.now().toISOString(),
        });
        if (assignment.seq !== current.nextSeq) {
          throw new Error(`ledger partition for ${path} handed out sequence ${String(assignment.seq)} for a line built at ${String(current.nextSeq)}`);
        }
        appendLedgerLine(path, line);
        appended.push(confirm(assignment, clock.now().toISOString()));
      }

      const settled = repository.getPartition(partition.system, partition.date);
      if (settled === undefined) throw new Error(`ledger partition for ${path} vanished while leased`);
      return LedgerProjectionReportSchema.parse({
        state: "projected",
        partition,
        appended,
        repaired,
        remarked,
        nextSeq: settled.nextSeq,
      });
    } finally {
      repository.releaseLease({
        system: partition.system,
        date: partition.date,
        projectorId: options.projectorId,
        leaseGeneration,
        now: clock.now().toISOString(),
      });
    }
  };

  const partitionsWithWork = (): readonly LedgerPartitionKey[] => {
    const keys = new Map<string, LedgerPartitionKey>();
    const remember = (partition: LedgerPartitionKey): void => {
      keys.set(`${partition.system}:${partition.date}`, partition);
    };
    for (const outbox of repository.listPendingOutbox()) remember(partitionOf(outbox));
    for (const assignment of repository.listUnappendedProjections()) {
      remember(LedgerPartitionKeySchema.parse({ system: assignment.system, date: assignment.date }));
    }
    return Object.freeze([...keys.values()].sort((a, b) => (
      a.date === b.date ? a.system.localeCompare(b.system) : a.date.localeCompare(b.date)
    )));
  };

  return Object.freeze({
    projectorId: options.projectorId,
    partitionsWithWork,
    project,
    projectAll: () => Object.freeze(partitionsWithWork().map(project)),
  });
}
