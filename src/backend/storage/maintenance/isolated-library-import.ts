import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { applicationDataWorkspace } from "../../app/config/runtime-isolation.js";
import { ProfileDatabaseBindingSchema, type ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { type SavedWorkbook, type WorkbookType } from "../../../models/dashboard/workbooks.js";
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

export type IsolatedLibraryImportReport = Readonly<{
  importedWorkbooks: number;
  importedTypes: number;
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
 * Imports the Spreadsheets library of a verified production person backup into an already signed-up staging or development person.
 * Only each local workbook's current content and the workbook types come across, under new library IDs; history, journals, workflow
 * outputs, SharePoint links, runs, settings, assistant state, credentials and sessions stay behind. Every write is one store transaction.
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
  const occupied = target.atomically(() => {
    if (target.list().length !== 0 || target.types().some(type => type.id !== INITIAL_WORKBOOK_TYPE.id)) return true;
    for (const type of library.types) target.putType({ ...type, defaultWorkbookId: null });
    const issued = new Map<string, string>();
    for (const { record, typeId } of library.workbooks) {
      const libraryId = randomUUID();
      issued.set(record.libraryId, libraryId);
      target.create({ libraryId, version: 1, createdAt: record.createdAt, savedAt: record.savedAt, workbook: { ...record.workbook, libraryId } });
      if (typeId === INITIAL_WORKBOOK_TYPE.id) continue;
      const receipt = target.operation(libraryId, { operationId: randomUUID(), source: { kind: "operator" }, at,
        change: { kind: "metadata", expectedVersion: 1, metadata: { typeId, sharePoint: null } } });
      if (receipt.state !== "applied") throw new Error(`isolated-library-import-type-${receipt.state}`);
    }
    for (const type of library.types) {
      const defaultWorkbookId = type.defaultWorkbookId === null ? undefined : issued.get(type.defaultWorkbookId);
      if (defaultWorkbookId !== undefined) target.putType({ ...type, defaultWorkbookId });
    }
    return false;
  });
  if (occupied) throw new IsolatedLibraryImportRefusedError("destination-library-not-empty");
  return Object.freeze({
    importedWorkbooks: library.workbooks.length,
    importedTypes: library.types.length,
    skippedWorkflowOutputs: library.skippedWorkflowOutputs,
    sourceBackup: Object.freeze({ backupFileName: manifest.backupFileName, sha256: manifest.sha256, authorityGeneration: manifest.authorityGeneration }),
  });
}
