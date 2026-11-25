import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { applicationDataWorkspace } from "../../app/config/runtime-isolation.js";
import { isUpgradeableAuthoritySchemaVersion } from "../../../models/config/authority-schema-versions.js";
import { runtimeProfiles } from "../../../models/config/define-runtime-isolation.js";
import { ProfileDatabaseBindingSchema, type ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { encodeSavedWorkbook, type SavedWorkbook, type WorkbookOperation, type WorkbookType } from "../../../models/dashboard/workbooks.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import { withStagedHistory } from "./isolated-history-import.js";
import { type RuntimeAdmission } from "../admission/admission.js";
import { requireRuntimeAdmission } from "../admission/admission-identity.js";
import { RuntimeLifetimeLock } from "../admission/lifetime-lock.js";
import { type AuthorityDatabase } from "../sqlite/authority-database.js";
import { isolatedBackupScratchRoot, withUpgradedBackupCopy } from "../sqlite/backup-inspection.js";
import { readVerifiedBackupManifestAtPath } from "../sqlite/backup-service.js";
import { authoritySourceDatabaseIdentity } from "../sqlite/database-identity.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../sqlite/migrations.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import { createWorkbookLibraryRepository, INITIAL_WORKBOOK_TYPE } from "../sqlite/workbook-library-repository.js";

export const IsolatedLibraryImportRequestSchema = z.strictObject({
  source: z.strictObject({ manifestPath: z.string().min(1), binding: ProfileDatabaseBindingSchema }),
  destination: ProfileDatabaseBindingSchema,
});

const IMPORT_OPERATION_PREFIX = "relay-isolated-import:";

const newerVersion = z.int().gt(CURRENT_AUTHORITY_SCHEMA_VERSION);
const NewerBackupManifestSchema = z.strictObject({ ...AuthorityBackupManifestSchema.shape, schemaVersion: newerVersion,
  verification: AuthorityBackupManifestSchema.shape.verification.extend({ schemaVersion: newerVersion }),
}).refine(manifest => manifest.schemaVersion === manifest.verification.schemaVersion);
const ImportBackupManifestSchema = AuthorityBackupManifestSchema.or(NewerBackupManifestSchema);

export function parseIsolatedImportBackupManifest(manifestPath: string) {
  return ImportBackupManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
}

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
  return !isAbsolute(offset) && offset.split(sep)[0] !== "..";
}

/**
 * Proves the open store is the destination person's own state.db under its exclusive admission, whose controller holds a non-production
 * lifetime lock on a workspace outside the production application data. Nothing here comes from the caller.
 */
function assertIsolatedDestination(admission: RuntimeAdmission, database: AuthorityDatabase): void {
  try { database.assertOpenedByExclusive(admission); }
  catch (cause) { throw new IsolatedLibraryImportRefusedError("destination-store-unbound", { cause }); }
  const lifetime = admission.lifetime, context = admission.readInstallationContext();
  if (!(lifetime instanceof RuntimeLifetimeLock) || lifetime.port === runtimeProfiles.production.lockPort || context === undefined) {
    throw new IsolatedLibraryImportRefusedError("destination-not-isolated");
  }
  lifetime.assertWorkspace(context.workspace);
  const production = applicationDataWorkspace(undefined, "production");
  if (inside(production, context.workspace) || inside(production, admission.stateRoot)) throw new IsolatedLibraryImportRefusedError("destination-not-isolated");
}

type StageHistory = Parameters<Parameters<typeof withStagedHistory>[1]>[0];

function readVerifiedSourceLibrary(admission: RuntimeAdmission, manifestPath: string, expected: ProfileDatabaseBinding, clock: Clock, stage?: StageHistory) {
  const manifest = parseIsolatedImportBackupManifest(manifestPath);
  if (manifest.installationId !== expected.installationId || manifest.profileId !== expected.profileId
    || manifest.sourceDatabaseIdentity !== authoritySourceDatabaseIdentity({ kind: "profile", binding: expected })) {
    throw new IsolatedLibraryImportRefusedError("source-binding-mismatch");
  }
  const version = manifest.schemaVersion;
  if (version > CURRENT_AUTHORITY_SCHEMA_VERSION) throw new IsolatedLibraryImportRefusedError("source-schema-newer");
  if (version !== CURRENT_AUTHORITY_SCHEMA_VERSION && !isUpgradeableAuthoritySchemaVersion(version)) {
    throw new IsolatedLibraryImportRefusedError("source-schema-upgrade-unsupported");
  }
  isolatedBackupScratchRoot(admission, manifestPath);
  const verified = readVerifiedBackupManifestAtPath(admission, manifestPath, { kind: "profile", binding: expected }, (database): SourceLibrary => {
    if (database.prepare("PRAGMA user_version").get()?.user_version !== version) {
      throw new IsolatedLibraryImportRefusedError("source-backup-changed");
    }
    const read = (source: typeof database): SourceLibrary => {
      stage?.(source, manifest.createdAt);
      const repository = createWorkbookLibraryRepository({ database: source, read: work => work(),
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
    };
    return version === CURRENT_AUTHORITY_SCHEMA_VERSION ? read(database)
      : withUpgradedBackupCopy(admission, database, version, expected, clock.now().toISOString(), read);
  });
  if (canonicalJsonStringify(verified.manifest) !== canonicalJsonStringify(manifest)) throw new IsolatedLibraryImportRefusedError("source-backup-changed");
  return { manifest: verified.manifest, library: verified.value };
}

/**
 * Imports or refreshes the Spreadsheets library of a verified production person backup in an already signed-up staging or development
 * person. Each local workbook's current content and the workbook types come across under IDs derived from the source entry; history,
 * journals, workflow outputs, SharePoint links, runs, settings, assistant state, credentials and sessions stay behind. Entries the copy
 * created, changed or still has pending operations on are never written, and their pending operations stay queued. All writes are one
 * store transaction.
 */
export async function importIsolatedWorkbookLibrary(admissionInput: RuntimeAdmission, database: AuthorityDatabase, requestInput: unknown,
  clock: Clock = systemClock): Promise<IsolatedLibraryImportReport> {
  return importLibrary(admissionInput, database, requestInput, clock);
}

export async function importIsolatedProfileData(admission: RuntimeAdmission, database: AuthorityDatabase, request: unknown, clock: Clock = systemClock) {
  return withStagedHistory(admission, stage => importLibrary(admission, database, request, clock, stage));
}

async function importLibrary(admissionInput: RuntimeAdmission, database: AuthorityDatabase, requestInput: unknown, clock: Clock, stage?: StageHistory) {
  const admission = requireRuntimeAdmission(admissionInput);
  const request = IsolatedLibraryImportRequestSchema.parse(requestInput);
  admission.assertProfileRuntime();
  assertIsolatedDestination(admission, database);
  if (!sameBinding(admission.profileBinding, request.destination) || !sameBinding(database.getMeta(), request.destination)) {
    throw new IsolatedLibraryImportRefusedError("destination-binding-mismatch");
  }
  if (request.destination.installationId === request.source.binding.installationId) throw new IsolatedLibraryImportRefusedError("destination-not-isolated");
  const manifestPath = resolve(request.source.manifestPath);
  if (inside(admission.stateRoot, manifestPath)) throw new IsolatedLibraryImportRefusedError("source-inside-destination");

  const { manifest, library } = readVerifiedSourceLibrary(admission, manifestPath, request.source.binding, clock, stage);
  const target = database.authority.workbooks;
  const at = clock.now().toISOString();
  const issued = (sourceLibraryId: string) => importedLibraryId(request.source.binding, request.destination, sourceLibraryId);
  const write = (libraryId: string, change: WorkbookOperation["change"]) => {
    const receipt = target.operation(libraryId, { operationId: `${IMPORT_OPERATION_PREFIX}${randomUUID()}`, source: { kind: "operator" }, at, change });
    if (receipt.state !== "applied") throw new Error(`isolated-library-import-write-${receipt.state}`);
  };
  const outcome = target.atomically(() => {
    assertIsolatedDestination(admission, database);
    const types = new Map(target.types().map(type => [type.id, type]));
    const diverged = library.types.find(type => {
      const existing = types.get(type.id);
      return existing !== undefined && canonicalJsonStringify({ ...existing, defaultWorkbookId: null }) !== canonicalJsonStringify({ ...type, defaultWorkbookId: null });
    });
    if (diverged !== undefined) return "destination-type-diverged";
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
      if (current === undefined || target.hasQueuedOperation(libraryId) || journal.some(receipt => !receipt.operationId.startsWith(IMPORT_OPERATION_PREFIX))
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
  if (typeof outcome === "string") throw new IsolatedLibraryImportRefusedError(outcome);
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
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${(8 | (parseInt(hex.slice(16, 17), 16) & 3)).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
