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
 */
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import {
  resolveLedgerLine,
  unresolvedLedgerLine,
  type LedgerLinePointer,
  type ResolvedLedgerLineWire,
} from "../../domain/archive/ledger-resolution.js";
import { LedgerEntrySchema } from "../../domain/ledger.js";
import { ledgerFilePath } from "./ledger-projector.js";

export interface LedgerReadThrough {
  /** Resolve every pointer, in the order given. Never reorders, never drops. */
  resolve(pointers: readonly LedgerLinePointer[]): readonly ResolvedLedgerLineWire[];
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
  });
}
