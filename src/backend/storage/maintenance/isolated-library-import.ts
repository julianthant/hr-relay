import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { applicationDataWorkspace } from "../../app/config/runtime-isolation.js";
import { ProfileDatabaseBindingSchema, type ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { encodeSavedWorkbook, type SavedWorkbook, type WorkbookOperation, type WorkbookType } from "../../../models/dashboard/workbooks.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { type AuthorityDatabase } from "../sqlite/authority-database.js";
import { inspectOpenDatabase } from "../sqlite/backup-inspection.js";
import { assertBackupInspection, parseBackupManifestFile, verifyBackupBytesAtPath } from "../sqlite/backup-service.js";
import { authoritySourceDatabaseIdentity } from "../sqlite/database-identity.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../sqlite/migrations.js";
import { withReadonlyAuthoritySnapshot } from "../sqlite/readonly-authority-snapshot.js";
import { createWorkbookLibraryRepository, INITIAL_WORKBOOK_TYPE } from "../sqlite/workbook-library-repository.js";

export const IsolatedLibraryImportRequestSchema = z.strictObject({
  source: z.strictObject({ manifestPath: z.string().min(1), binding: ProfileDatabaseBindingSchema }),
  destination: ProfileDatabaseBindingSchema,
});

const IMPORT_OPERATION_PREFIX = "relay-isolated-import:";

export type IsolatedLibraryImportReport = Readonly<{
  created: number;
  refreshed: number;
  unchanged: number;
  /** Imported entries that were edited, removed or acted on in the copy; they keep their local state. */
  keptLocal: number;
  createdTypes: number;
  skippedWorkflowOutputs: number;
  sourceBackup: Readonly<{ backupFileName: string; sha256: string; authorityGeneration: number }>;
}>;

export class IsolatedLibraryImportRefusedError extends Error {
  readonly code = "ISOLATED_LIBRARY_IMPORT_REFUSED";
  constructor(readonly reason: string, options?: ErrorOptions) {
    super(`isolated-library-import-refused: ${reason}`, options);
    this.name = "IsolatedLibraryImportRefusedError";
  }
}

type SourceLibrary = Readonly<{
  types: readonly WorkbookType[];
  workbooks: readonly Readonly<{ record: SavedWorkbook; typeId: string }>[];
  skippedWorkflowOutputs: number;
}>;

const sameBinding = (left: ProfileDatabaseBinding, right: ProfileDatabaseBinding) =>
  left.installationId === right.installationId && left.profileId === right.profileId;

function inside(root: string, path: string): boolean {
  const offset = relative(resolve(root), resolve(path));
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

/** Reads the verified backup's local library through a read-only snapshot; the backup file itself is never opened. */
async function readVerifiedSourceLibrary(manifestPath: string, expected: ProfileDatabaseBinding) {
  const manifest = parseBackupManifestFile(manifestPath);
  if (manifest.installationId !== expected.installationId || manifest.profileId !== expected.profileId
    || manifest.sourceDatabaseIdentity !== authoritySourceDatabaseIdentity({ kind: "profile", binding: expected })) {
    throw new IsolatedLibraryImportRefusedError("source-binding-mismatch");
  }
  if (manifest.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) throw new IsolatedLibraryImportRefusedError("source-schema-not-current");
  const backupPath = join(dirname(manifestPath), manifest.backupFileName);
  await verifyBackupBytesAtPath(backupPath, manifest);
  const library = withReadonlyAuthoritySnapshot(backupPath, (database): SourceLibrary => {
    assertBackupInspection(manifest, inspectOpenDatabase(database, manifest.schemaVersion), { kind: "profile", binding: expected });
    const repository = createWorkbookLibraryRepository({ database, read: work => work(),
      mutate: () => { throw new Error("isolated-library-import-source-read-only"); } });
    const entries = repository.catalog();
    const local = entries.filter(entry => entry.state.origin.kind === "local");
    return {
      types: repository.types().filter(type => type.id !== INITIAL_WORKBOOK_TYPE.id),
      workbooks: local.map(entry => {
        const record = repository.read(entry.libraryId);
        if (record === undefined) throw new IsolatedLibraryImportRefusedError("source-library-entry-missing");
        return { record, typeId: entry.metadata.typeId };
      }),
      skippedWorkflowOutputs: entries.length - local.length,
    };
  });
  // The snapshot proved the file unchanged while read; this proves it is still the manifest's bytes.
  await verifyBackupBytesAtPath(backupPath, manifest);
  return { manifest, library };
}

/**
 * Imports or refreshes the Spreadsheets library of a verified production person backup in an already signed-up staging or development
 * person. Each local workbook's current content and the workbook types come across under IDs derived from the source entry; history,
 * journals, workflow outputs, SharePoint links, runs, settings, assistant state, credentials and sessions stay behind. Entries the copy
 * created or changed are never written. All writes are one store transaction.
 */
export async function importIsolatedWorkbookLibrary(admissionInput: RuntimeAdmission, database: AuthorityDatabase, requestInput: unknown,
  clock: Clock = systemClock, productionWorkspace: string = applicationDataWorkspace(undefined, "production")): Promise<IsolatedLibraryImportReport> {
  const admission = requireRuntimeAdmission(admissionInput);
  const request = IsolatedLibraryImportRequestSchema.parse(requestInput);
  admission.assertProfileRuntime();
  const meta = database.getMeta();
  if (!sameBinding(admission.profileBinding, request.destination) || !sameBinding(meta, request.destination)) {
    throw new IsolatedLibraryImportRefusedError("destination-binding-mismatch");
  }
  if (request.destination.installationId === request.source.binding.installationId || inside(productionWorkspace, admission.stateRoot)) {
    throw new IsolatedLibraryImportRefusedError("destination-not-isolated");
  }
  const manifestPath = resolve(request.source.manifestPath);
  if (inside(admission.stateRoot, manifestPath)) throw new IsolatedLibraryImportRefusedError("source-inside-destination");

  const { manifest, library } = await readVerifiedSourceLibrary(manifestPath, request.source.binding);
  const target = database.authority.workbooks;
  const at = clock.now().toISOString();
  const issued = (sourceLibraryId: string) => importedLibraryId(request.source.binding, request.destination, sourceLibraryId);
  const write = (libraryId: string, change: WorkbookOperation["change"]) => {
    const receipt = target.operation(libraryId, { operationId: `${IMPORT_OPERATION_PREFIX}${randomUUID()}`, source: { kind: "operator" }, at, change });
    if (receipt.state !== "applied") throw new Error(`isolated-library-import-write-${receipt.state}`);
  };
  const outcome = target.atomically(() => {
    const types = new Map(target.types().map(type => [type.id, type]));
    const diverged = library.types.find(type => {
      const existing = types.get(type.id);
      return existing !== undefined && canonicalJsonStringify({ ...existing, defaultWorkbookId: null }) !== canonicalJsonStringify({ ...type, defaultWorkbookId: null });
    });
    if (diverged !== undefined) return { refused: "destination-type-diverged" } as const;
    const createdTypes = library.types.filter(type => !types.has(type.id));
    for (const type of createdTypes) target.putType({ ...type, defaultWorkbookId: null });
    const counts = { created: 0, refreshed: 0, unchanged: 0, keptLocal: 0 };
    for (const { record, typeId } of library.workbooks) {
      const libraryId = issued(record.libraryId), workbook = { ...record.workbook, libraryId };
      if (target.creation(libraryId) === undefined) {
        target.create({ libraryId, version: 1, createdAt: record.createdAt, savedAt: record.savedAt, workbook });
        if (typeId !== INITIAL_WORKBOOK_TYPE.id) write(libraryId, { kind: "metadata", expectedVersion: 1, metadata: { typeId, sharePoint: null } });
        counts.created++;
        continue;
      }
      const current = target.read(libraryId);
      // Only an entry that nothing but this import ever changed is refreshed; anything touched in the copy stays as it is.
      const journal = target.journal(libraryId);
      // Each applied write and each library action advances the revision once; any revision beyond the import's own writes is the copy's.
      if (current === undefined || journal.some(receipt => !receipt.operationId.startsWith(IMPORT_OPERATION_PREFIX))
        || target.libraryState(libraryId).revision !== 1 + journal.filter(receipt => receipt.state === "applied").length) { counts.keptLocal++; continue; }
      const content = encodeSavedWorkbook({ ...current, workbook }).workbook;
      const changed = canonicalJsonStringify(encodeSavedWorkbook(current).workbook) !== canonicalJsonStringify(content);
      if (changed) write(libraryId, { kind: "save", expectedVersion: current.version, workbook: content });
      const version = current.version + (changed ? 1 : 0);
      const typed = target.metadata(libraryId).typeId !== typeId;
      if (typed) write(libraryId, { kind: "metadata", expectedVersion: version, metadata: { typeId, sharePoint: null } });
      counts[changed || typed ? "refreshed" : "unchanged"]++;
    }
    for (const type of createdTypes) {
      const defaultWorkbookId = type.defaultWorkbookId === null ? undefined : issued(type.defaultWorkbookId);
      if (defaultWorkbookId !== undefined && target.creation(defaultWorkbookId) !== undefined) target.putType({ ...type, defaultWorkbookId });
    }
    return { ...counts, createdTypes: createdTypes.length };
  });
  if ("refused" in outcome) throw new IsolatedLibraryImportRefusedError(outcome.refused);
  return Object.freeze({
    ...outcome,
    skippedWorkflowOutputs: library.skippedWorkflowOutputs,
    sourceBackup: Object.freeze({ backupFileName: manifest.backupFileName, sha256: manifest.sha256, authorityGeneration: manifest.authorityGeneration }),
  });
}

/** The copy's library ID for one source entry: the same source entry always lands on the same ID, which no other writer issues. */
export function importedLibraryId(source: ProfileDatabaseBinding, destination: ProfileDatabaseBinding, sourceLibraryId: string): string {
  const hex = createHash("sha256").update(JSON.stringify(["relay-isolated-library-import", source.installationId, source.profileId,
    destination.installationId, destination.profileId, sourceLibraryId])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${(8 | (parseInt(hex[16], 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
