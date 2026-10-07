/** Stopped, one-time import of the released presentation file. No runtime writer. */
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { createHash } from "node:crypto";
import { ExplorerEditApplyRequestSchema, ExplorerOverrideDocumentSchema, ExplorerWorkflowOverrideSchema } from "../../../models/dashboard/explorer.js";
import { ExplorerOverrideImportSourceSchema, type ExplorerOverrideImportSource } from "../../../models/dashboard/explorer-override.js";
import { applyExplorerPresentationChanges, explorerEditCommandFingerprint } from "../../../models/dashboard/explorer-override.js";
import { assertExplorerOverrideEvidence } from "./explorer-overrides.js";
import { requireDatabaseSourcePath } from "./recovery-admission.js";

const IdentitySchema = z.strictObject({ device: z.number(), inode: z.number(), size: z.number().int().nonnegative(), modified: z.number(), changed: z.number() });
export interface ExplorerOverrideSourceSnapshot {
  readonly source: ExplorerOverrideImportSource;
  readonly identity: z.infer<typeof IdentitySchema> | null;
}

function present(path: string): boolean {
  try { lstatSync(path); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

export function readExplorerOverrideSource(stateRoot: string): ExplorerOverrideSourceSnapshot {
  const path = join(stateRoot, "explorer-overrides.json");
  requireDatabaseSourcePath(path);
  for (const suffix of [".claim", ".claim.pending", ".pending"]) {
    if (present(`${path}${suffix}`)) throw new Error("explorer-override-pending: recover the Explorer edit with the original compatible release before storage upgrade");
  }
  if (!present(path)) return { source: { state: "absent" }, identity: null };
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.nlink !== 1) throw new Error("explorer-override-source-integrity");
    const bytes = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    const identity = (stat: typeof before) => IdentitySchema.parse({ device: stat.dev, inode: stat.ino, size: stat.size, modified: stat.mtimeMs, changed: stat.ctimeMs });
    if (canonicalJsonStringify(identity(before)) !== canonicalJsonStringify(identity(after))) throw new Error("explorer-override-source-changed");
    // Fatal decoding prevents replacement characters from normalizing corrupt source bytes.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { identity: identity(after), source: ExplorerOverrideImportSourceSchema.parse({
      state: "present", sha256: createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.byteLength,
      document: ExplorerOverrideDocumentSchema.parse(JSON.parse(text)),
    }) };
  } finally { closeSync(descriptor); }
}

export function assertExplorerOverrideSourceUnchanged(stateRoot: string, expected: ExplorerOverrideSourceSnapshot): void {
  if (canonicalJsonStringify(readExplorerOverrideSource(stateRoot)) !== canonicalJsonStringify(expected)) throw new Error("explorer-override-source-changed: re-plan storage upgrade");
}

/** Reconstruct every successful presentation transition from immutable envelopes.
 * Missing files, skipped revisions and unrelated carried values are conflicts. */
export function proveExplorerOverrideSource(database: DatabaseSync, snapshot: ExplorerOverrideSourceSnapshot): void {
  const records = database.prepare("SELECT record_json FROM commands WHERE family='explorer' ORDER BY record_key").all()
    .map(row => ExplorerEditApplyRequestSchema.parse(JSON.parse(z.strictObject({ record_json: z.string() }).parse(row).record_json)))
    .sort((left, right) => left.target.workflowId.localeCompare(right.target.workflowId) || left.target.expectedOverrideRevision - right.target.expectedOverrideRevision);
  const reconstructed = new Map<string, z.infer<typeof ExplorerWorkflowOverrideSchema>>();
  for (const command of records) {
    const previous = reconstructed.get(command.target.workflowId);
    if (command.target.expectedOverrideRevision !== (previous?.revision ?? 0)) throw new Error("explorer-override-source-revision-conflict");
    const presentation = applyExplorerPresentationChanges(previous?.presentation ?? {}, command);
    const override = ExplorerWorkflowOverrideSchema.parse({ overrideVersion: 1,
      workflowId: command.target.workflowId, descriptorVersion: command.target.expectedVersion,
      contractFingerprint: command.target.contractFingerprint, revision: command.target.expectedOverrideRevision + 1,
      appliedCommandId: command.commandId, commandFingerprint: explorerEditCommandFingerprint(command), presentation });
    assertExplorerOverrideEvidence(database, override);
    reconstructed.set(override.workflowId, override);
  }
  const source = snapshot.source.state === "absent" ? [] : snapshot.source.document.workflows;
  const sorted = [...source].sort((left, right) => left.workflowId.localeCompare(right.workflowId));
  if (canonicalJsonStringify([...reconstructed.values()]) !== canonicalJsonStringify(sorted)) throw new Error("explorer-override-source-command-conflict: restore the matching file and command authority with the original compatible release");
}

export function importExplorerOverrides(database: DatabaseSync, snapshot: ExplorerOverrideSourceSnapshot): void {
  if (!database.isTransaction) throw new Error("explorer-override-conversion-requires-transaction");
  proveExplorerOverrideSource(database, snapshot);
  if (snapshot.source.state === "absent") return;
  for (const record of snapshot.source.document.workflows) {
    database.prepare("INSERT INTO explorer_overrides(record_key,revision,command_id,record_json) VALUES (?,?,?,?)")
      .run(record.workflowId, record.revision, record.appliedCommandId, canonicalJsonStringify(record));
  }
}
