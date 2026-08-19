/**
 * Reading ONE ledger line back by its `(system, date, sequence)` pointer.
 *
 * This is the only reader the archive uses, and it is deliberately narrow: it
 * opens a partition, finds the named sequence, and answers with the entry or
 * with the reason there is none. It NEVER writes, never appends, never
 * renumbers and never prunes — doc 03 §2.1 D21's ledger exemption is a
 * property of this directory, and a "repair" here would rewrite the record of
 * what was really filed against a live HR system.
 *
 * A line is looked up by its own `seq` rather than by line index. The
 * projector maintains the two as equal and stops the partition when they
 * disagree, so reading by index would be reading a DERIVED equality as if it
 * were the identity — and an archive whose pointers silently followed a
 * renumbering would be citing different transactions than it was written to
 * cite. When the line found at the index carries a different sequence, that is
 * reported as a mismatch rather than being resolved from the neighbourhood.
 *
 * The SAME reader answers the Activity report's write-ledger block (D236). It
 * is a second question over one corpus — "resolve these exact pointers" and
 * "fold everything confirmed in this window" — and it is deliberately not a
 * second module: two readers of an append-only audit file would be two parse
 * disciplines, and the one that was wrong would be wrong about what was filed
 * into a real HR system.
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import {
  resolveLedgerLine,
  unresolvedLedgerLine,
  type LedgerLinePointer,
  type ResolvedLedgerLineWire,
} from "../../domain/archive/ledger-resolution.js";
import { localDatePart } from "../../domain/clock.js";
import {
  ActivityLedgerBlockSchema,
  type ActivityLedgerBlock,
} from "../../domain/dashboard/activity.js";
import { LedgerEntrySchema } from "../../domain/ledger.js";
import { ledgerFilePath, listLedgerFiles } from "./ledger-projector.js";

export interface LedgerReadThrough {
  /** Resolve every pointer, in the order given. Never reorders, never drops. */
  resolve(pointers: readonly LedgerLinePointer[]): readonly ResolvedLedgerLineWire[];
  /**
   * The Activity report's write-ledger block over `[from, to]` inclusive
   * (D236) — what was actually filed, folded by `(system, instance)`.
   *
   * The window closes on the entry's own `confirmedAt`, read through the SAME
   * `localDatePart` the report's day axis uses. A partition FILE name is a UTC
   * date, so it decides only which files are opened — widened by one day at
   * each end, which covers every real offset — and never the verdict: a write
   * confirmed at 17:00 local on the window's last day can sit in the next day's
   * partition, and letting the file name decide would drop a real HR
   * transaction out of the report because of a timezone.
   */
  foldActivityRange(from: string, to: string): ActivityLedgerBlock;
}

function resolveOne(stateRoot: string, pointer: LedgerLinePointer): ResolvedLedgerLineWire {
  const path = ledgerFilePath(stateRoot, pointer.system, pointer.date);
  if (!existsSync(path)) {
    return unresolvedLedgerLine(
      pointer,
      "partition-missing",
      `${pointer.system}-${pointer.date}.jsonl does not exist under this state root; the ledger is never `
      + "pruned, so a missing partition means this record was archived from a different state root",
    );
  }
  const text = readFileSync(path, "utf8");
  const lines = text === "" ? [] : text.replace(/\n$/u, "").split("\n");
  const line = lines[pointer.sequence];
  if (line === undefined || line === "") {
    return unresolvedLedgerLine(
      pointer,
      "sequence-missing",
      `${pointer.system}-${pointer.date}.jsonl holds ${String(lines.length)} lines and this record points at `
      + `sequence ${String(pointer.sequence)}`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(line);
  } catch (error) {
    return unresolvedLedgerLine(
      pointer,
      "line-malformed",
      `${pointer.system}-${pointer.date}.jsonl line ${String(pointer.sequence + 1)} is not JSON: `
      + (error instanceof Error ? error.message : String(error)),
    );
  }
  const parsed = LedgerEntrySchema.safeParse(json);
  if (!parsed.success) {
    return unresolvedLedgerLine(
      pointer,
      "line-malformed",
      `${pointer.system}-${pointer.date}.jsonl line ${String(pointer.sequence + 1)} is not a ledger entry: `
      + parsed.error.message,
    );
  }
  if (parsed.data.seq !== pointer.sequence) {
    // Reading the neighbourhood for the "real" line is the tempting repair and
    // is exactly what must not happen: a pointer that followed a renumbering
    // would cite a different transaction than the archive was written to cite.
    return unresolvedLedgerLine(
      pointer,
      "sequence-mismatch",
      `${pointer.system}-${pointer.date}.jsonl line ${String(pointer.sequence + 1)} carries sequence `
      + `${String(parsed.data.seq)}; this partition disagrees with the pointer and is not searched around`,
    );
  }
  return resolveLedgerLine(pointer, parsed.data.payload);
}

/** `date` plus `days`, on the UTC calendar the partition file names use. */
function shiftPartitionDate(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * Fold every ledger line whose confirmation falls in `[from, to]`.
 *
 * A line this fold cannot READ throws, naming the file and the line. The
 * pointer path above answers an unreadable line with a reason because it is
 * resolving ONE citation and the surface can say "this one could not be read";
 * a fold has no such column. Skipping the line would silently subtract a real
 * HR transaction from the count of what was filed, which is the same defect
 * `listLedgerFiles` already refuses one level up when it meets a file it cannot
 * name.
 */
function foldActivity(stateRoot: string, fromInput: string, toInput: string): ActivityLedgerBlock {
  const from = z.iso.date().parse(fromInput);
  const to = z.iso.date().parse(toInput);
  if (from > to) {
    throw new Error(`a write-ledger fold over ${from}..${to} ends before it starts`);
  }
  const earliestFile = shiftPartitionDate(from, -1);
  const latestFile = shiftPartitionDate(to, 1);
  const totals = new Map<string, { system: string; entries: number; prod: number; test: number }>();
  for (const partition of listLedgerFiles(stateRoot)) {
    if (partition.date < earliestFile || partition.date > latestFile) continue;
    const text = readFileSync(partition.path, "utf8");
    const lines = text === "" ? [] : text.replace(/\n$/u, "").split("\n");
    for (const [index, line] of lines.entries()) {
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch (error) {
        throw new Error(
          `ledger/${partition.system}-${partition.date}.jsonl line ${String(index + 1)} is not JSON: `
          + (error instanceof Error ? error.message : String(error))
          + "; refusing to fold a write ledger with a line it cannot read",
          { cause: error },
        );
      }
      const parsed = LedgerEntrySchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(
          `ledger/${partition.system}-${partition.date}.jsonl line ${String(index + 1)} is not a ledger `
          + `entry: ${parsed.error.message}; refusing to fold a write ledger with a line it cannot read`,
        );
      }
      const { payload } = parsed.data;
      if (payload.system !== partition.system) {
        throw new Error(
          `ledger/${partition.system}-${partition.date}.jsonl line ${String(index + 1)} carries system `
          + `${payload.system}; a partition holding another system's entry is not folded around`,
        );
      }
      const day = localDatePart(new Date(payload.confirmedAt));
      if (day < from || day > to) continue;
      const row = totals.get(payload.system) ?? { system: payload.system, entries: 0, prod: 0, test: 0 };
      row.entries += 1;
      if (payload.instance === "prod") row.prod += 1;
      else row.test += 1;
      totals.set(payload.system, row);
    }
  }
  return ActivityLedgerBlockSchema.parse({
    systems: [...totals.values()].sort((left, right) => (
      right.entries - left.entries || left.system.localeCompare(right.system)
    )),
  });
}

/**
 * The archive's ledger read-through, over a state root.
 *
 * Partitions are read once per call and reused across the pointers that share
 * one, because an archived run's lines usually sit in the same `(system, day)`
 * file and re-reading it per pointer would be one file open per row.
 */
export function createLedgerReadThrough(stateRootInput: unknown): LedgerReadThrough {
  const stateRoot = z.string().min(1).parse(stateRootInput);
  return Object.freeze({
    resolve(pointers: readonly LedgerLinePointer[]): readonly ResolvedLedgerLineWire[] {
      return Object.freeze(pointers.map((pointer) => resolveOne(stateRoot, pointer)));
    },
    foldActivityRange(from: string, to: string): ActivityLedgerBlock {
      return foldActivity(stateRoot, from, to);
    },
  });
}
