import { openSync, closeSync, writeFileSync, fsyncSync, unlinkSync, fstatSync, lstatSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { TransactionHistorySelectionSchema, type TransactionHistory } from "../sqlite/transaction-history.js";

export const TransactionExportRequestSchema = TransactionHistorySelectionSchema.safeExtend({ output: z.string().min(1) });

/** The public presentation is frozen before opening the caller-owned output with O_EXCL. */
export function exportTransactions(history: TransactionHistory, input: unknown) {
  const request = TransactionExportRequestSchema.parse(input);
  const snapshot = history.query({ from: request.from, to: request.to, ...(request.system === undefined ? {} : { system: request.system }) });
  const rows = snapshot.rows.map(({ eventId, operationId, generation, runId, localDate, presentation }) =>
    ({ eventId, operationId, generation, runId, localDate, presentation }));
  const content = { version: 1, selection: snapshot.range, rows };
  const sourceDigest = sha256Hex(canonicalJsonStringify(content));
  const bytes = `${canonicalJsonStringify({ ...content, sourceDigest })}\n`;
  const output = resolve(request.output);
  const fd = openSync(output, "wx", 0o600);
  const owned = fstatSync(fd);
  try { writeFileSync(fd, bytes); fsyncSync(fd); }
  catch (error) {
    closeSync(fd);
    const named = lstatSync(output, { throwIfNoEntry: false });
    if (named !== undefined && named.dev === owned.dev && named.ino === owned.ino) unlinkSync(output);
    throw error;
  }
  closeSync(fd);
  const parent = openSync(dirname(output), "r");
  try { fsyncSync(parent); } finally { closeSync(parent); }
  return { output, sourceDigest, transactions: rows.length };
}

export function parseTransactionExportArgs(args: readonly string[]) {
  if (args.length === 1 && args[0] === "--help") return { kind: "help" as const };
  const values: { from?: string; to?: string; system?: string; output?: string } = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]; const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error("transaction-export-option-value-required");
    if (option !== "--from" && option !== "--to" && option !== "--system" && option !== "--output") throw new Error("transaction-export-option-unknown");
    const key = option.slice(2) as keyof typeof values;
    if (values[key] !== undefined) throw new Error("transaction-export-option-duplicate");
    values[key] = value;
  }
  return { kind: "export" as const, request: TransactionExportRequestSchema.parse(values) };
}
export const TRANSACTION_EXPORT_HELP = "storage transactions --from YYYY-MM-DD --to YYYY-MM-DD [--system SYSTEM] --output PATH\nWrites a deterministic JSON transaction report from one database snapshot; an existing output is refused.\n";
