import { AuthorityDatabase } from "../sqlite/authority-database.js";
import { emailKey, passwordMatches } from "../configuration/synthetic-verifier.js";
import type { RuntimeAdmission } from "./admission.js";
import { AuthorityBackupService, verifyBackupManifestAtPath } from "../sqlite/backup-service.js";
import { inspectAuthorityBackupReadOnly, openAuthorityBackupSourceReadOnly } from "../sqlite/backup-inspection.js";
import { CredentialMaintenanceHold, captureCanonicalCredentialStartupLocks, publishStoppedCanonicalCredentials, CanonicalCredentialConversionPlanSchema, type CanonicalCredentialConversionPlan, CanonicalCredentialRestoreSnapshotSchema, CanonicalCredentialHeadSchema, CanonicalCredentialPublicationSourceSchema } from "../configuration/canonical-credential-store.js";
import { profileAuthorityFileWitnesses } from "../maintenance/existing-data-backup-files.js";
import { replacePrivateFile, privatePathRejects, writePrivateStage, fsyncPath } from "../private-path.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { assertOfflineMaintenanceOperation, OfflineMaintenanceOperationUnavailableError, offlineMaintenanceWorkspace, isOfflineMaintenanceOperationActive, type OfflineMaintenanceOperation, RuntimeLifetimeLock, WorkerRuntimeLifetimeLock } from "./lifetime-lock.js";
import { ProfileStorageRelocationUnsupportedError, requireRuntimeAdmission } from "./admission-identity.js";
import { credentialKeyCustody } from "../configuration/credential-key-custody.js";
import { createProfileVerifiers, preparedProfileVerifierPepperWitness, verifyPreparedProfileVerifier } from "../configuration/verifier-store.js";
import { retainedStorageBackup, SourceRecordSchema, StorageBackupSchema, inventory as backupFileInventory, file as backupFile } from "../maintenance/existing-data-backup-files.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure, hasUnprovedSourceClosure, retainUnprovedSourceOwners, rememberUnprovedSourceClosure, assertSourceClosuresProved } from "../source-closure.js";
import { capturePriorPrivateFileLock, withPrivateFileLock, withOperationProof, outermostOperationProof, type PrivateFileLock, readPrivateFile, noSymlinkAncestry, unpublishedDraftAbortMembership } from "../configuration/credential-safe-file.js";
import { assertProfileRestoreDatabaseBinding, assertCanonicalProfileBinding, readProfileDatabaseBinding } from "../sqlite/profile-local-databases.js";
import { ProfileDatabaseBindingSchema, SignUpOperationSchema, LogoutOperationSchema, type ProfileOperation, ProfileRegistryDocumentSchema, advanceProfileRegistryDocument, ProfileRegistryRowSchema, ProfileVerifierDocumentSchema, ProfileOnboardingCompletionSchema, assertFinishedProfileOnboarding, deriveProfileNames, type ProfileRegistryDocument } from "../../../models/profiles/profile.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../sqlite/migrations.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmSync, rmdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { readProcessCustodyFile } from "../sqlite/runtime-process-locks.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { encodePrivate } from "../../../rules/validation/private-equal.js";
import { storageRelocationDesiredDigest } from "../../../rules/commands/commands.js";
import { NonNegativeIntSchema } from "../../../rules/identity/ids.js";
import { systemClock } from "../../../rules/time/clock.js";
import { ConfigSnapshotRecordSchema, ConfigSnapshotWriteSchema } from "../../../models/config/snapshot.js";
import { ActiveRuntimeConfigRecordSchema } from "../../../models/config/runtime-generation.js";
import { createReadonlyAuthoritySnapshot } from "../sqlite/readonly-authority-snapshot.js";
import { readStoppedCredentialConversion, releaseStoppedCredentialConversion, type StoppedControlCredentialAttestation, StoppedDuoContinuityRowSchema as DuoContinuityRowSchema, type StoppedDuoContinuityRow as DuoContinuityRow, StoppedCredentialKeyWitnessSchema as CredentialKeyWitnessSchema, StoppedCredentialErasureHeadSchema as CredentialErasureHeadSchema } from "../configuration/credential-conversion.js";


const ProfileOperationSchema = z.union([SignUpOperationSchema, LogoutOperationSchema]);
const ProfileOperationMutationSchema = z.union([z.strictObject({ kind: z.literal("write"), operation: ProfileOperationSchema }), z.strictObject({ kind: z.literal("delete"), operationId: z.uuid() })]);
const ProfileErasureHeadSchema = z.lazy(() => z.strictObject({ profileId: z.uuid(), originOperationId: z.uuid(), head: CredentialErasureHeadSchema, credentialKey: CredentialKeyWitnessSchema.optional() }));
const RestoreFileBindingSchema = z.strictObject({ dev: z.number().int().nonnegative(), ino: z.number().int().nonnegative(),
  byteSize: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/u) });
export const CompletedRestoreCustodySchema = z.strictObject({ operationId: z.uuid(), profile: ProfileDatabaseBindingSchema,
  sourceGeneration: z.number().int().nonnegative(), outcome: z.enum(["unchanged", "replaced"]),
  suspect: z.strictObject({ relativePath: z.string().min(1), file: RestoreFileBindingSchema }),
  companions: z.array(z.strictObject({ suffix: z.enum(["-wal", "-shm"]), file: RestoreFileBindingSchema })).max(2)
    .refine(rows => new Set(rows.map(row => row.suffix)).size === rows.length),
});
export type CompletedRestoreCustody = z.infer<typeof CompletedRestoreCustodySchema>;
const PriorProfileContinuitySchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(),
  digest: z.string().regex(/^[0-9a-f]{64}$/u), device: z.number().int().nonnegative(), inode: z.number().int().nonnegative(), generation: z.number().int().nonnegative(), erasures: z.array(ProfileErasureHeadSchema).max(10_000), operations: z.array(z.strictObject({ operationId: z.uuid(), digest: z.string().regex(/^[0-9a-f]{64}$/u), device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() })) });

const StoppedPriorProfileContinuitySchema = z.discriminatedUnion("schemaVersion", [PriorProfileContinuitySchema,
  PriorProfileContinuitySchema.extend({ schemaVersion: z.literal(2), duo: z.array(DuoContinuityRowSchema).max(10_000) })]);
const StoppedCurrentProfileContinuitySchema = PriorProfileContinuitySchema.extend({ schemaVersion: z.literal(3), duo: z.array(DuoContinuityRowSchema).max(10_000),
  completedRestores: z.array(CompletedRestoreCustodySchema).max(10_000).refine(rows => new Set(rows.map(row => row.operationId)).size === rows.length) })
  .refine(value => value.completedRestores.every(row => row.profile.installationId === value.installationId));
const StoppedProfileRegistryDocumentSchema = z.union([ProfileRegistryDocumentSchema.omit({ installationId: true, revision: true }).extend({ schemaVersion: z.literal(2) }), ProfileRegistryDocumentSchema]);
const StoppedLogicalProfileContinuitySchema = z.strictObject({ schemaVersion: z.literal(4), installationId: z.uuid(),
  digest: z.string().regex(/^[0-9a-f]{64}$/u), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  operations: z.array(z.strictObject({ operationId: z.uuid(), digest: z.string().regex(/^[0-9a-f]{64}$/u) })),
  erasures: z.array(ProfileErasureHeadSchema).max(10_000), duo: z.array(DuoContinuityRowSchema).max(10_000),
  completedRestores: z.array(CompletedRestoreCustodySchema).max(10_000).refine(rows => new Set(rows.map(row => row.operationId)).size === rows.length) })
  .refine(value => value.completedRestores.every(row => row.profile.installationId === value.installationId));
const StoppedProfileContinuitySchema = z.union([StoppedPriorProfileContinuitySchema, StoppedCurrentProfileContinuitySchema, StoppedLogicalProfileContinuitySchema]);
const ProfileContinuitySchema = z.strictObject({ schemaVersion: z.literal(5), installationId: z.uuid(),
  digest: z.string().regex(/^[0-9a-f]{64}$/u), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  operations: z.array(z.strictObject({ operationId: z.uuid(), digest: z.string().regex(/^[0-9a-f]{64}$/u) })),
  completedRestores: z.array(CompletedRestoreCustodySchema).max(10_000).refine(rows => new Set(rows.map(row => row.operationId)).size === rows.length) })
  .refine(value => value.completedRestores.every(row => row.profile.installationId === value.installationId));
const ProfileAuthorityFilesSchema = z.array(z.strictObject({ suffix: z.enum(["", "-wal", "-shm", "-journal"]),
  file: CanonicalCredentialPublicationSourceSchema.shape.head.optional() }));
const DraftMembershipSchema = z.array(z.strictObject({ path: z.string(), directory: z.boolean(), device: z.number(), inode: z.number(), size: z.number(),
  mode: z.number(), modified: z.number(), changed: z.number() }));
const ProfilePublicationSchema = z.lazy(() => z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("onboarding-finish"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    operation: SignUpOperationSchema, priorDocument: ProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema,
    priorVerifiers: ProfileVerifierDocumentSchema, verifiers: ProfileVerifierDocumentSchema,
    credentials: CanonicalCredentialPublicationSourceSchema, pepper: CanonicalCredentialPublicationSourceSchema.shape.head, databases: ProfileAuthorityFilesSchema }),
  z.strictObject({ kind: z.literal("incomplete-profile-draft"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    capture: z.strictObject({ operation: SignUpOperationSchema, credentials: CanonicalCredentialPublicationSourceSchema,
      membership: DraftMembershipSchema, databases: ProfileAuthorityFilesSchema }),
    priorDocument: ProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema,
    priorVerifiers: ProfileVerifierDocumentSchema, verifiers: ProfileVerifierDocumentSchema }),
  z.strictObject({ kind: z.literal("draft-abort"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    capture: z.strictObject({ operation: SignUpOperationSchema, head: CanonicalCredentialPublicationSourceSchema.shape.head.optional(), membership: DraftMembershipSchema, databases: ProfileAuthorityFilesSchema }) }),
  z.strictObject({ kind: z.literal("profile"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    document: ProfileRegistryDocumentSchema, operation: ProfileOperationMutationSchema.optional() }),
]));

const PairSchema = z.strictObject({ stateRoot: z.string().min(1), artifactRoot: z.string().min(1) });
const InstallationSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), workspace: z.string().min(1) });
const LocatorCommon = { installationId: z.uuid(), generation: z.number().int().nonnegative(), stateRoot: z.string(), artifactRoot: z.string() };
const LocatorSchema = z.discriminatedUnion("schemaVersion", [
  z.strictObject({ schemaVersion: z.literal(1), ...LocatorCommon }),
  z.strictObject({ schemaVersion: z.literal(2), ...LocatorCommon,
    stateRootGeneration: z.number().int().nonnegative(), artifactRootGeneration: z.number().int().nonnegative() }),
]);
const MarkerCommon = { installationId: z.uuid(), workspace: z.string(), role: z.enum(["state", "artifact"]), generation: z.number().int().nonnegative() };
const MarkerSchema = z.discriminatedUnion("schemaVersion", [
  z.strictObject({ schemaVersion: z.literal(1), ...MarkerCommon }),
  z.strictObject({ schemaVersion: z.literal(2), ...MarkerCommon, operationId: z.uuid() }),
]);
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const ControlUpgradeFileSchema = z.strictObject({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative(), digest: DigestSchema });

const ControlUpgradeReceiptSchema = z.strictObject({ schemaVersion: z.literal(2), operationId: z.uuid(), installationId: z.uuid(),
  phase: z.enum(["backing-up", "publishing"]),
  credentials: z.array(z.strictObject({ profileId: z.uuid(), plan: CanonicalCredentialConversionPlanSchema })).max(10_000),
  backups: z.array(z.strictObject({ profileId: z.uuid(), directory: z.string().regex(/^[0-9a-f-]{36}\.[0-9a-f-]{36}\.authority$/u),
    verifiedBackup: z.strictObject({ manifest: AuthorityBackupManifestSchema, manifestSha256: DigestSchema }).optional() })).max(10_000),
  prior: StoppedProfileContinuitySchema, current: ProfileContinuitySchema,
  priorDocument: StoppedProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema,
  priorRegistry: ControlUpgradeFileSchema, registryBackup: ControlUpgradeFileSchema, registryStage: ControlUpgradeFileSchema,
  priorControl: ControlUpgradeFileSchema, priorMarker: ControlUpgradeFileSchema,
  controlBackup: ControlUpgradeFileSchema, markerBackup: ControlUpgradeFileSchema,
  controlStage: ControlUpgradeFileSchema, markerStage: ControlUpgradeFileSchema,
  retained: z.array(z.strictObject({ name: z.string().regex(/^[0-9a-f-]{36}\.(?:registry|control|marker)\.before\.json$|^[0-9a-f-]{36}\.receipt\.json$/u), file: ControlUpgradeFileSchema })),
  sourceEvidence: z.string().max(16 * 1024 * 1024) });

const GenerationSchema = z.number().int().nonnegative();
const EpochsSchema = z.strictObject({ state: GenerationSchema, artifact: GenerationSchema });
const PlanBindingSchema = z.strictObject({ commandId: z.uuid(), revision: z.number().int().positive(),
  expectedRevision: GenerationSchema,
  requestFingerprint: DigestSchema, desiredDigest: DigestSchema });
const PreparationEvidenceSchema = z.strictObject({ operationId: z.uuid(), installationId: z.uuid(),
  sourceGeneration: GenerationSchema, source: PairSchema, destination: PairSchema, plan: PlanBindingSchema,
  sourceDatabaseIdentity: DigestSchema, sourceSchemaVersion: z.number().int().positive().max(CURRENT_AUTHORITY_SCHEMA_VERSION),
  sourceAuthorityGeneration: GenerationSchema, sourceAuthorityContentFingerprint: DigestSchema,
  backupReceiptId: z.string().min(1).max(200), backupManifestPath: z.string().min(1),
  backupManifestSha256: DigestSchema, backupFilePath: z.string().min(1), backupFileSha256: DigestSchema });
const ManagedEntrySchema = z.strictObject({ name: z.string().regex(/^(?!\.{1,2}$)[A-Za-z0-9._-]+$/u), kind: z.enum(["file", "directory"]) });
const PinnedEntrySchema = ManagedEntrySchema.shape.name;
const StageEvidenceSchema = z.strictObject({ operationId: z.uuid(), installationId: z.uuid(), sourceGeneration: GenerationSchema,
  source: PairSchema, destination: PairSchema, plan: PlanBindingSchema, stagingReceiptId: z.string().min(1),
  stagingDigest: DigestSchema, backupReceiptId: z.string().min(1), backupDigest: DigestSchema,
  finalDatabasePath: z.string().min(1), configSnapshotId: z.uuid(), configFingerprint: DigestSchema,
  authorityVersion: z.number().int().positive().max(CURRENT_AUTHORITY_SCHEMA_VERSION), databaseIdentity: z.string().min(1),
  managedStateEntries: z.array(ManagedEntrySchema) });
const CurrentPreparationEvidenceSchema = PreparationEvidenceSchema.extend({
  sourceSchemaVersion: PreparationEvidenceSchema.shape.sourceSchemaVersion.refine(
    (version): boolean => version === CURRENT_AUTHORITY_SCHEMA_VERSION, { message: `expected ${CURRENT_AUTHORITY_SCHEMA_VERSION}` }),
});
const CurrentStageEvidenceSchema = StageEvidenceSchema.extend({
  authorityVersion: StageEvidenceSchema.shape.authorityVersion.refine(
    (version): boolean => version === CURRENT_AUTHORITY_SCHEMA_VERSION, { message: `expected ${CURRENT_AUTHORITY_SCHEMA_VERSION}` }),
});
const StageCopySchema = z.strictObject({ manifestPath: z.string().min(1), manifestSha256: DigestSchema,
  backupPath: z.string().min(1), backupSha256: DigestSchema });
const ActivationIntentSchema = z.strictObject({ operationId: z.uuid(), installationId: z.uuid(), sourceGeneration: GenerationSchema,
  source: PairSchema, destination: PairSchema, plan: PlanBindingSchema,
  stageAuthority: StageCopySchema,
  nativeDestinationPath: z.string().min(1), nativeDestinationSha256: DigestSchema.nullable(),
  preAuthorityGeneration: GenerationSchema, preAuthorityContentFingerprint: DigestSchema,
  managedInventoryDigest: DigestSchema, settingsRevision: z.number().int().positive(), settingsFingerprint: DigestSchema,
  priorActive: ActiveRuntimeConfigRecordSchema.nullable(), snapshot: ConfigSnapshotRecordSchema });
const RetentionSchema = z.strictObject({ role: z.enum(["state", "artifact"]), source: z.string(), retained: z.string(),
  strategy: z.enum(["whole-root", "lock-shell", "witness-shell"]) });
const FenceSchema = z.strictObject({ schemaVersion: z.literal(2), operationId: z.uuid(), installationId: z.uuid(),
  role: z.enum(["state", "artifact"]), bindingDigest: DigestSchema });
const TombstoneSchema = z.strictObject({ schemaVersion: z.literal(1), kind: z.literal("relocation-tombstone"),
  operationId: z.uuid(), installationId: z.uuid(), role: z.enum(["state", "artifact"]),
  source: z.string(), retained: z.string(), bindingDigest: DigestSchema });
const JournalBase = { schemaVersion: z.literal(2), operationId: z.uuid(), installationId: z.uuid(), fromGeneration: GenerationSchema,
  source: PairSchema, destination: PairSchema, sourceEpochs: EpochsSchema, destinationEpochs: EpochsSchema,
  plan: PlanBindingSchema, restoreAdmissionId: z.uuid(), retentions: z.array(RetentionSchema).min(1).max(2),
  pinnedEntries: z.array(PinnedEntrySchema) };
const ProfileRestoreContextSchema = z.lazy(() => z.strictObject({ binding: ProfileDatabaseBindingSchema, continuity: ProfileContinuitySchema,
  credentials: CanonicalCredentialRestoreSnapshotSchema }));
export type ProfileRestoreContext = z.infer<typeof ProfileRestoreContextSchema>;
export const AuthorityRestoreInputSchema = z.strictObject({ operationId: z.uuid(), profile: ProfileRestoreContextSchema,
  authorityPath: z.string().min(1), stagedPath: z.string().min(1), suspectPath: z.string().min(1),
  manifestPath: z.string().min(1), manifestSha256: DigestSchema,
  backupPath: z.string().min(1), backupSha256: DigestSchema,
  sourceDatabaseIdentity: DigestSchema, authorityGeneration: GenerationSchema,
  authorityContentFingerprint: DigestSchema,
  live: RestoreFileBindingSchema, staged: RestoreFileBindingSchema, suspect: RestoreFileBindingSchema,
  companions: z.array(z.strictObject({ suffix: z.enum(["-wal", "-shm"]), binding: RestoreFileBindingSchema, suspect: RestoreFileBindingSchema })).max(2) });
const AuthorityRestoreJournalSchema = z.strictObject({ schemaVersion: z.literal(2), phase: z.literal("restoring"),
  installationId: z.uuid(), source: LocatorSchema, restoreAdmissionId: z.uuid(),
  restore: AuthorityRestoreInputSchema,
  invalidation: z.strictObject({ priorDocument: ProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema, continuity: ProfileContinuitySchema }).optional() });
export type AuthorityRestoreInput = z.infer<typeof AuthorityRestoreInputSchema>;
export type AuthorityRestoreVerification = Readonly<{ authorityGeneration: number; authorityContentFingerprint: string }>;
export type AuthorityRestoreVerifier = () => AuthorityRestoreVerification;
const JournalSchema = z.discriminatedUnion("phase", [
  AuthorityRestoreJournalSchema,
  z.strictObject({ schemaVersion: z.literal(1), phase: z.literal("adopting"), installationId: z.uuid() }),
  z.strictObject({ ...JournalBase, phase: z.literal("preparing") }),
  z.strictObject({ ...JournalBase, phase: z.literal("prepared"), preparation: CurrentPreparationEvidenceSchema }),
  z.strictObject({ ...JournalBase, phase: z.literal("activating"), preparation: CurrentPreparationEvidenceSchema, activationIntent: ActivationIntentSchema }),
  z.strictObject({ ...JournalBase, phase: z.literal("staged"), preparation: CurrentPreparationEvidenceSchema, activationIntent: ActivationIntentSchema, evidence: CurrentStageEvidenceSchema }),
  z.strictObject({ ...JournalBase, phase: z.literal("fenced"), preparation: CurrentPreparationEvidenceSchema, activationIntent: ActivationIntentSchema, evidence: CurrentStageEvidenceSchema }),
  z.strictObject({ ...JournalBase, phase: z.literal("retaining"), preparation: CurrentPreparationEvidenceSchema, activationIntent: ActivationIntentSchema, evidence: CurrentStageEvidenceSchema }),
  z.strictObject({ ...JournalBase, phase: z.literal("retained"), preparation: CurrentPreparationEvidenceSchema, activationIntent: ActivationIntentSchema, evidence: CurrentStageEvidenceSchema }),
  z.strictObject({ ...JournalBase, phase: z.literal("switched"), preparation: CurrentPreparationEvidenceSchema, activationIntent: ActivationIntentSchema, evidence: CurrentStageEvidenceSchema }),
]);
const CompletionReceiptSchema = z.strictObject({ ...JournalBase, fromGeneration: GenerationSchema, toGeneration: GenerationSchema,
  preparation: PreparationEvidenceSchema, activationIntent: ActivationIntentSchema,
  evidence: StageEvidenceSchema, completedAt: z.string().datetime() });
export type RuntimePair = z.infer<typeof PairSchema>;
export type RuntimeLocator = z.infer<typeof LocatorSchema>;
export type RelocationPlanBinding = z.infer<typeof PlanBindingSchema>;
export type VerifiedRelocationPreparation = z.infer<typeof PreparationEvidenceSchema>;
export type VerifiedRelocationEvidence = z.infer<typeof StageEvidenceSchema>;
export type RelocationEvidenceView = Readonly<Omit<VerifiedRelocationEvidence, "source" | "destination" | "plan" | "managedStateEntries"> & {
  source: Readonly<RuntimePair>; destination: Readonly<RuntimePair>; plan: Readonly<RelocationPlanBinding>;
  managedStateEntries: readonly Readonly<z.infer<typeof ManagedEntrySchema>>[] }>;
export type VerifiedRelocationActivationIntent = z.infer<typeof ActivationIntentSchema>;
export type RelocationCompletionReceipt = z.infer<typeof CompletionReceiptSchema>;
export type RelocationInventory = Readonly<{ operationId: string; installationId: string; fromGeneration: number;
  source: RuntimePair; destination: RuntimePair; plan: RelocationPlanBinding;
  phase: "preparing" | "prepared" | "activating" | "staged" | "fenced" | "retaining" | "retained" | "switched";
  preparation?: VerifiedRelocationPreparation;
  activationIntent?: VerifiedRelocationActivationIntent;
  evidence?: RelocationEvidenceView;
  pinnedEntries: readonly string[]; retentions: readonly z.infer<typeof RetentionSchema>[] }>;
export type VerifiedSourceControlEntries = Readonly<{ source: RuntimePair;
  state: readonly string[]; artifact: readonly string[] }>;
export type ExistingAuthorityEvidence = Readonly<{ kind: "verified-existing"; pair: RuntimePair; authorityGeneration: number; databaseIdentity: string }>;
export type AuthorityVerifier = (pair: RuntimePair) => ExistingAuthorityEvidence;
export type FreshInitializationWitness = Readonly<{ installationId: string; pair: RuntimePair; assertHeld(): void }>;
export type FreshInitializer = (witness: FreshInitializationWitness) => void;
export type RelocationVerifier = (source: RuntimeLocator, destination: RuntimePair, operationId: string, plan: RelocationPlanBinding) => VerifiedRelocationEvidence;
export type RelocationPreparationVerifier = (source: RuntimeLocator, destination: RuntimePair,
  operationId: string, plan: RelocationPlanBinding) => VerifiedRelocationPreparation;
export type RelocationActivationVerifier = (source: RuntimeLocator, destination: RuntimePair,
  operationId: string, plan: RelocationPlanBinding) => VerifiedRelocationActivationIntent;
export type InstallationLease = Readonly<{ retainSourceClosure(error: unknown): void; lifetime: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock; mode: "shared" | "exclusive"; locator: RuntimeLocator;
  assertHeld(): void; assertFixedProcessLockRoot(workspaceRoot: string, processLockRoot: string): void;
  beginOfflineMaintenance(): OfflineMaintenanceOperation;
  offlineMaintenanceOperation(): OfflineMaintenanceOperation;
  assertOfflineMaintenance(operation: OfflineMaintenanceOperation): void;
  readRelocationReceipts(): readonly RelocationCompletionReceipt[];
  readProfileRegistry(): ProfileRegistryDocument;
  readCompletedRestores(profileId: string): readonly CompletedRestoreCustody[];
  requiresFlatStoreMigration(): boolean;
  flatStoreMigrationPending(): boolean;
  eraseFlatStoreCredentials(restore: OfflineMaintenanceOperation): void;
  startCleanFlatStore(restore: OfflineMaintenanceOperation): void;
  abortUnpublishedProfile(operation: z.infer<typeof SignUpOperationSchema>, head?: z.infer<typeof CanonicalCredentialPublicationSourceSchema.shape.head>): boolean;
  reclassifyIncompleteProfile(profile: RuntimeAdmission): void;
  resumeIncompleteProfileDraft(profileId: string, restore: OfflineMaintenanceOperation): boolean;
  assertColdPendingLogout(operation: z.infer<typeof LogoutOperationSchema>): void;
  capturePendingProfileLogout(operation: z.infer<typeof LogoutOperationSchema>): Readonly<{ assertHeld(publication?: ProfilePublicationRead): void }>;
  captureStoppedProfileUpgrade(profileId: string): Readonly<{ assertHeld(): void }>;
  captureProfileUpgradeHandoff(profileId: string): Readonly<{ consume(next: InstallationLease): void }>;
  publishProfileRegistration(operation: z.infer<typeof SignUpOperationSchema>, profile: RuntimeAdmission): void;
  publishProfileRegistry(expected: ProfileRegistryDocument, document: ProfileRegistryDocument): void;
  beginProfileSignUp(fields: Omit<z.infer<typeof SignUpOperationSchema>, "operationId" | "profileId" | "commandId" | "writeId" | "schemaVersion" | "kind" | "phase" | "onboarding" | "credentials">): z.infer<typeof SignUpOperationSchema>;
  publishProfileOperation(operation: ProfileOperation | string): void;
  completeStoppedLogout(admission: RuntimeAdmission, operation: z.infer<typeof LogoutOperationSchema>, restore: OfflineMaintenanceOperation, source: AuthorityDatabase): void;
  publishStoppedLogoutSettlement(admission: RuntimeAdmission, expected: z.infer<typeof LogoutOperationSchema>, next: z.infer<typeof LogoutOperationSchema>, restore: OfflineMaintenanceOperation, source: AuthorityDatabase): void;
  readInstallationContext(): Readonly<{ workspace: string; locator: RuntimeLocator; receipts: readonly RelocationCompletionReceipt[] }>;
  release(): void }>;
export type ExclusiveInstallationLease = InstallationLease & Readonly<{
  captureProfileRestore(profileId: string, credentials: z.infer<typeof CanonicalCredentialRestoreSnapshotSchema>): ProfileRestoreContext;
  assertProfileRestoreHeld(input: AuthorityRestoreInput, restore: OfflineMaintenanceOperation): void;
  readAuthorityRestore(operationId: string): AuthorityRestoreInput;
  beginAuthorityRestore(input: AuthorityRestoreInput, restore: OfflineMaintenanceOperation): void;
  settleAuthorityRestore(input: AuthorityRestoreInput, outcome: "unchanged" | "replaced", verify: AuthorityRestoreVerifier, restore: OfflineMaintenanceOperation): void;
  beginRelocation(destination: RuntimePair, plan: RelocationPlanBinding, restore: OfflineMaintenanceOperation): string;
  relocationInventory(): RelocationInventory;
  prepareDestinationRoots(): void;
  verifiedSourceControlEntries(): VerifiedSourceControlEntries;
  readPriorReceipts(): readonly RelocationCompletionReceipt[];
  recordVerifiedPreparation(verify: RelocationPreparationVerifier): void;
  recordActivationIntent(verify: RelocationActivationVerifier): void;
  recordVerifiedStage(verify: RelocationVerifier): void;
  fenceRelocationSource(): void;
  retainRelocationSources(): void;
  switchRelocationLocator(verify: RelocationVerifier): RuntimeLocator;
  settleRelocation(verify: RelocationVerifier): void;
}>;

const CONTROL = ".tracker/control";
const MARKER = ".runtime-owner.json";
const FENCE = ".runtime-source-fence.json";
export const RUNTIME_ROOT_AUTHORITY_ENTRY_NAMES = Object.freeze([MARKER,FENCE]);
const RECEIPTS = "relocation-receipts";
const FlatStartCleanIntentSchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(),
  backup: z.strictObject({ backupPath: z.string(), backupDigest: z.string() }) });
const issuedLeases = new WeakSet<object>();

function fail(reason: string): never { throw new Error(`runtime-control: ${reason}`); }
function pairOf(locator: RuntimeLocator): RuntimePair { return { stateRoot: locator.stateRoot, artifactRoot: locator.artifactRoot }; }
function epochsOf(locator: RuntimeLocator): z.infer<typeof EpochsSchema> {
  return locator.schemaVersion === 1
    ? { state: locator.generation, artifact: locator.generation }
    : { state: locator.stateRootGeneration, artifact: locator.artifactRootGeneration };
}
function equalPair(left: RuntimePair, right: RuntimePair): boolean {
  return left.stateRoot === right.stateRoot && left.artifactRoot === right.artifactRoot;
}
function equalEpochs(left: z.infer<typeof EpochsSchema>, right: z.infer<typeof EpochsSchema>): boolean {
  return left.state === right.state && left.artifact === right.artifact;
}
function planDesiredDigest(installationId: string, sourceGeneration: number, sourcePair: RuntimePair,
  desiredPair: RuntimePair, expectedRevision: number): string {
  return storageRelocationDesiredDigest({ installationId,
    sourceGeneration: NonNegativeIntSchema.parse(sourceGeneration), sourcePair,
    expectedRevision: NonNegativeIntSchema.parse(expectedRevision) }, desiredPair);
}
function checkPlan(plan: RelocationPlanBinding, installationId: string, sourceGeneration: number,
  sourcePair: RuntimePair, desiredPair: RuntimePair): void {
  if (plan.revision !== plan.expectedRevision + 1
    || plan.desiredDigest !== planDesiredDigest(installationId, sourceGeneration, sourcePair, desiredPair, plan.expectedRevision)) {
    fail("relocation plan binding mismatch");
  }
}
function operationBinding(journal: z.infer<typeof JournalSchema>): string {
  if (journal.phase === "adopting" || journal.phase === "restoring") fail("journal has no relocation binding");
  const { phase: _phase, ...bound } = journal;
  const { evidence: _evidence, ...base } = "evidence" in bound ? bound : { ...bound, evidence: undefined };
  return createHash("sha256").update("hrauto:runtime-relocation:v1\0").update(canonicalJsonStringify(base)).digest("hex");
}
function retainedSibling(source: string, operationId: string, role: "state" | "artifact"): string {
  const name = basename(source);
  return join(dirname(source), `${name.startsWith(".") ? "" : "."}${name}.retained-${operationId}-${role}`);
}
function relocationRetentions(workspace: string, source: RuntimePair, destination: RuntimePair, operationId: string,
  priorReceipts: readonly RelocationCompletionReceipt[]): z.infer<typeof RetentionSchema>[] {
  validateDestination(workspace, source, destination);
  const stateMoved = source.stateRoot !== destination.stateRoot;
  const artifactMoved = source.artifactRoot !== destination.artifactRoot;
  if (!stateMoved && !artifactMoved) fail("destination unchanged");
  if (stateMoved && !artifactMoved && inside(source.stateRoot, source.artifactRoot)) fail("state-only move would strand nested artifacts");
  for (const target of [...(stateMoved ? [destination.stateRoot] : []), ...(artifactMoved ? [destination.artifactRoot] : [])]) {
    for (const prior of [source.stateRoot, source.artifactRoot]) {
      if (inside(target, prior) || inside(prior, target)) fail("moved destination overlaps source root");
    }
  }
  const retentions: z.infer<typeof RetentionSchema>[] = [];
  const priorWitnesses = stateMoved ? pinnedWitnessEntries(source.stateRoot, priorReceipts) : [];
  if (stateMoved && artifactMoved && inside(source.stateRoot, source.artifactRoot)
    && (inside(source.stateRoot, fixedLockRoot(workspace)) || priorWitnesses.length > 0)
    && dirname(source.artifactRoot) !== source.stateRoot) fail("nested artifact under source shell must be a direct child");
  if (stateMoved) retentions.push({ role: "state", source: source.stateRoot,
    retained: retainedSibling(source.stateRoot, operationId, "state"),
    strategy: inside(source.stateRoot, fixedLockRoot(workspace)) ? "lock-shell"
      : priorWitnesses.length > 0 ? "witness-shell" : "whole-root" });
  if (artifactMoved && !(stateMoved && inside(source.stateRoot, source.artifactRoot))) {
    retentions.push({ role: "artifact", source: source.artifactRoot,
      retained: retainedSibling(source.artifactRoot, operationId, "artifact"), strategy: "whole-root" });
  }
  for (const target of [...(stateMoved ? [destination.stateRoot] : []), ...(artifactMoved ? [destination.artifactRoot] : [])]) {
    for (const row of retentions) {
      if (inside(target, row.retained) || inside(row.retained, target)) fail("destination overlaps retained source witness");
    }
  }
  return retentions;
}
type RelocationJournal = Exclude<z.infer<typeof JournalSchema>, { phase: "adopting" | "restoring" }>;
function sameEvidence(left: VerifiedRelocationEvidence, right: VerifiedRelocationEvidence): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}
function samePreparation(left: VerifiedRelocationPreparation, right: VerifiedRelocationPreparation): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}
function checkPreparationBinding(pending: RelocationJournal | RelocationCompletionReceipt,
  preparation: VerifiedRelocationPreparation): void {
  if (preparation.operationId !== pending.operationId || preparation.installationId !== pending.installationId
    || preparation.sourceGeneration !== pending.fromGeneration || !equalPair(preparation.source, pending.source)
    || !equalPair(preparation.destination, pending.destination)
    || canonicalJsonStringify(preparation.plan) !== canonicalJsonStringify(pending.plan)
    || ![preparation.backupManifestPath, preparation.backupFilePath].every((path) => isAbsolute(path) && resolve(path) === path)
    || preparation.backupManifestPath === preparation.backupFilePath) fail("relocation preparation binding mismatch");
}
function verifyPreparation(pending: RelocationJournal, verify: RelocationPreparationVerifier): VerifiedRelocationPreparation {
  const raw: unknown = verify(sourceLocator(pending), Object.freeze({ ...pending.destination }), pending.operationId,
    Object.freeze({ ...pending.plan }));
  if (typeof raw === "object" && raw !== null && typeof Reflect.get(raw, "then") === "function") {
    fail("relocation preparation verifier must complete synchronously");
  }
  const preparation = CurrentPreparationEvidenceSchema.parse(raw);
  checkPreparationBinding(pending, preparation);
  return preparation;
}
function verifyStage(journal: RelocationJournal, sourceLocator: RuntimeLocator, verify: RelocationVerifier): VerifiedRelocationEvidence {
  const evidence = CurrentStageEvidenceSchema.parse(verify(sourceLocator, Object.freeze({ ...journal.destination }), journal.operationId,
    Object.freeze({ ...journal.plan })));
  if (evidence.operationId !== journal.operationId || evidence.installationId !== journal.installationId
    || evidence.sourceGeneration !== journal.fromGeneration || !equalPair(evidence.source, journal.source)
    || !equalPair(evidence.destination, journal.destination)
    || evidence.finalDatabasePath !== join(journal.destination.stateRoot, "state.db")
    || canonicalJsonStringify(evidence.plan) !== canonicalJsonStringify(journal.plan)) fail("verified stage binding mismatch");
  return evidence;
}
function entryKind(path: string): "file" | "directory" {
  const stat = lstatMaybe(path);
  if (stat === undefined || privatePathRejects(path, stat, "owner")) fail("managed source entry missing or unsafe");
  if (stat.isFile() && stat.nlink === 1) return "file";
  if (stat.isDirectory()) return "directory";
  fail("managed source entry has unsupported kind");
}
function verifyManagedEntries(journal: RelocationJournal, evidence: VerifiedRelocationEvidence): void {
  const state = journal.retentions.find((row) => row.role === "state");
  if (!state || state.strategy === "whole-root") {
    if (evidence.managedStateEntries.length !== 0) fail("managed state entry list is unexpected");
    return;
  }
  const excluded = new Set([MARKER, FENCE, ...journal.pinnedEntries]);
  if (state.strategy === "lock-shell") excluded.add("locks");
  const names = readdirSync(state.source).filter((name) => !excluded.has(name)).sort();
  const declared = evidence.managedStateEntries.map((entry) => entry.name).sort();
  if (canonicalJsonStringify(names) !== canonicalJsonStringify(declared)
    || new Set(declared).size !== declared.length || !declared.includes("state.db")) fail("managed state entry membership mismatch");
  for (const entry of evidence.managedStateEntries) {
    if (excluded.has(entry.name) || entryKind(join(state.source, entry.name)) !== entry.kind) fail("managed state entry shape mismatch");
  }
  if (journal.source.artifactRoot !== journal.destination.artifactRoot
    && inside(state.source, journal.source.artifactRoot)
    && !declared.includes(relative(state.source, journal.source.artifactRoot).split(/[\\/]/u)[0] ?? "")) {
    fail("nested artifact entry omitted from managed state manifest");
  }
}
function fixedLockRoot(workspace: string): string { return resolve(workspace, rebuildRuntimeIsolation.processLockRoot); }
export class OldBuildRuntimeArtifactsError extends Error {
  readonly code = "RUNTIME_OLD_BUILD_ARTIFACTS";
  constructor() { super(ERROR_CATALOG.RUNTIME_OLD_BUILD_ARTIFACTS.text); this.name = "OldBuildRuntimeArtifactsError"; }
}

export function assertNoOldBuildRuntimeArtifacts(workspace: string): void {
  const root = fixedLockRoot(workspace), info = lstatMaybe(root);
  if (info === undefined) return;
  assertNoSymlinkComponents(root);
  privateDirectory(root);
  if (readdirSync(root).length !== 0) throw new OldBuildRuntimeArtifactsError();
}

export function assertOfflineMaintenanceForProcessRoot(operation: OfflineMaintenanceOperation, processLockRoot: string): void {
  const workspace = offlineMaintenanceWorkspace(operation);
  if (processLockRoot !== fixedLockRoot(workspace)) fail("offline-maintenance-workspace-mismatch");
  assertOfflineMaintenanceOperation(operation, workspace);
  assertNoOldBuildRuntimeArtifacts(workspace);
}

function assertRestoreHeld(workspace: string, operation: OfflineMaintenanceOperation | undefined): void {
  if (operation === undefined) fail("offline-maintenance-unissued");
  assertOfflineMaintenanceOperation(operation, workspace);
  assertNoOldBuildRuntimeArtifacts(workspace);
}

function inside(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return part === "" || (part !== ".." && !part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(part));
}
function validatePair(workspace: string, pair: RuntimePair): RuntimePair {
  PairSchema.parse({ stateRoot: pair.stateRoot, artifactRoot: pair.artifactRoot });
  for (const path of [pair.stateRoot, pair.artifactRoot]) {
    if (!isAbsolute(path) || resolve(path) !== path) fail("root must be canonical absolute path");
    if (inside(path, workspace) || inside(path, join(workspace, CONTROL)) || inside(join(workspace, CONTROL), path)) fail("control overlaps a movable root");
  }
  if (pair.stateRoot === pair.artifactRoot || (inside(pair.artifactRoot, pair.stateRoot))) fail("invalid root overlap");
  return pair;
}
function validateDestination(workspace: string, source: RuntimePair, pair: RuntimePair): void {
  validatePair(workspace, pair);
  if ((pair.stateRoot !== source.stateRoot && inside(workspace, pair.stateRoot))
    || (pair.artifactRoot !== source.artifactRoot && inside(workspace, pair.artifactRoot))) fail("destination is inside workspace");
}
function assertKnownDefaults(workspace: string, pair: RuntimePair): void {
  validatePair(workspace, pair);
  if (pair.stateRoot !== resolve(workspace, rebuildRuntimeIsolation.stateRoot) || pair.artifactRoot !== resolve(workspace, rebuildRuntimeIsolation.artifactRoot)) fail("first adoption requires the known default root pair");
}
function privateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || privatePathRejects(path, stat, "directory-0700")) fail(`unsafe directory ${path}`);
}
function dataDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || privatePathRejects(path, stat, "owner-write-only")) fail(`unsafe data root ${path}`);
}
function lstatMaybe(path: string): ReturnType<typeof lstatSync> | undefined {
  try { return lstatSync(path); }
  catch (error) {
    if (typeof error === "object" && error !== null && Reflect.get(error, "code") === "ENOENT") return undefined;
    throw error;
  }
}
function privateFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || privatePathRejects(path, stat, "file-0600")) fail(`unsafe file ${path}`);
}
function readStrict<T>(path: string, schema: z.ZodType<T>): T {
  privateFile(path);
  const expected = lstatSync(path);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let result: { value: T } | undefined;
  let primary: { error: unknown } | undefined;
  let descriptorIdentity = expected;
  try {
    const stat = fstatSync(fd); descriptorIdentity = stat;
    if (!stat.isFile() || stat.nlink !== 1 || privatePathRejects(path, stat, "file-0600")) fail(`unsafe file ${path}`);
    result = { value: schema.parse(JSON.parse(readFileSync(fd, "utf8"))) };
  } catch (error) { primary = { error }; }
  try { closeSync(fd); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
    { descriptor: { descriptor: fd, identity: descriptorIdentity } }); }
  if (primary !== undefined) throw primary.error;
  if (result === undefined) throw new Error("installation-read-result-missing");
  return result.value;
}
function atomicJson(path: string, value: unknown, parentKind: "control" | "data" = "control"): void {
  const directory = resolve(path, "..");
  if (parentKind === "control") privateDirectory(directory);
  else dataDirectory(directory);
  const temp = join(directory, `.${randomUUID()}.tmp`);
  let primary: { error: unknown } | undefined;
  try {
    writePrivateStage(temp, Buffer.from(`${JSON.stringify(value)}\n`));
    if (lstatMaybe(path)) privateFile(path);
    replacePrivateFile(temp, path);
    fsyncPath(directory);
  } catch (error) { primary = { error }; }
  if (primary?.error instanceof AuthoritySourceClosureUnprovedError) throw primary.error;
  let cleanupFailure: { error: unknown } | undefined;
  try { if (existsSync(temp)) unlinkSync(temp); }
  catch (error) { cleanupFailure = { error }; }
  if (cleanupFailure !== undefined) {
    if (primary !== undefined) throw new AggregateError([primary.error, cleanupFailure.error], "installation-publication-cleanup-failed", { cause: primary.error });
    throw cleanupFailure.error;
  }
  if (primary !== undefined) throw primary.error;
}
function assertNoSymlinkComponents(path: string): void {
  const proof = outermostOperationProof();
  const existing = proof?.slots.get("symlink-free");
  const proven = existing instanceof Set ? existing as Set<string> : new Set<string>();
  if (proof !== undefined && existing !== proven) proof.slots.set("symlink-free", proven);
  if (proven.has(path)) return;
  let component = parse(path).root;
  const checked: string[] = [];
  for (const part of relative(component, path).split(/[\\/]/u)) {
    component = join(component, part);
    checked.push(component);
    if (proven.has(component)) continue;
    if (lstatMaybe(component)?.isSymbolicLink()) fail(`symlink in root path ${component}`);
  }
  for (const item of checked) proven.add(item);
}
function preflightRoot(path: string): void {
  assertNoSymlinkComponents(path);
  if (lstatMaybe(path)) dataDirectory(path);
}
function preflightPair(pair: RuntimePair): void {
  preflightRoot(pair.stateRoot);
  preflightRoot(pair.artifactRoot);
}
function ensureRoot(path: string): void {
  preflightRoot(path);
  if (!lstatMaybe(path)) { mkdirSync(path, { recursive: true, mode: 0o700 }); fsyncPath(resolve(path, "..")); }
  dataDirectory(path);
}
function markerPath(root: string): string { return join(root, MARKER); }
function assertNoDefaultWitness(pair: RuntimePair): void {
  for (const root of [pair.stateRoot, pair.artifactRoot]) {
    if (lstatMaybe(markerPath(root))) fail("existing ownership witness without locator");
    if (lstatMaybe(join(root, FENCE))) fail("retained source fence without locator");
  }
}
function checkMarker(root: string, installationId: string, workspace: string, role: "state" | "artifact", generation: number): void {
  preflightRoot(root);
  dataDirectory(root);
  const marker = readStrict(markerPath(root), MarkerSchema);
  if (marker.installationId !== installationId || marker.workspace !== workspace || marker.role !== role || marker.generation !== generation) fail(`root ownership mismatch: ${role}`);
}
function checkDestinationMarker(root: string, pending: RelocationJournal, workspace: string,
  role: "state" | "artifact", generation: number): void {
  checkMarker(root, pending.installationId, workspace, role, generation);
  const marker = readStrict(markerPath(root), MarkerSchema);
  if (marker.schemaVersion !== 2 || marker.operationId !== pending.operationId) fail("destination marker operation mismatch");
}
function installMarker(root: string, installationId: string, workspace: string, role: "state" | "artifact", generation: number,
  operationId?: string): void {
  ensureRoot(root);
  if (lstatMaybe(markerPath(root))) fail(`root already owned: ${role}`);
  atomicJson(markerPath(root), operationId === undefined
    ? { schemaVersion: 1, installationId, workspace, role, generation }
    : { schemaVersion: 2, installationId, workspace, role, generation, operationId }, "data");
}
function assertEmptyNestedDestination(stateRoot: string, artifactRoot: string): void {
  let current = stateRoot;
  for (const part of relative(stateRoot, artifactRoot).split(/[\\/]/u)) {
    if (part === "") continue;
    const entries = readdirSync(current);
    if (entries.length !== 1 || entries[0] !== part) fail("unowned nested destination content");
    current = join(current, part);
    preflightRoot(current);
    dataDirectory(current);
  }
  if (readdirSync(artifactRoot).length !== 0) fail("unowned nested destination content");
}
function prepareMovedDestinationRoot(workspace: string, pending: RelocationJournal,
  role: "state" | "artifact"): void {
  const root = pending.destination[`${role}Root`];
  preflightRoot(root);
  if (lstatMaybe(markerPath(root))) {
    checkDestinationMarker(root, pending, workspace, role, pending.sourceEpochs[role]);
    if (lstatMaybe(join(root, FENCE))) fail("destination is fenced");
    return;
  }
  if (lstatMaybe(root)) {
    dataDirectory(root);
    if (role === "state" && movedRole(pending, "artifact") && inside(root, pending.destination.artifactRoot)) {
      if (readdirSync(root).length > 0) assertEmptyNestedDestination(root, pending.destination.artifactRoot);
    } else if (readdirSync(root).length > 0) fail("unowned destination content");
  }
  if (lstatMaybe(join(root, FENCE))) fail("destination is fenced");
  ensureRoot(root);
  installMarker(root, pending.installationId, workspace, role, pending.sourceEpochs[role], pending.operationId);
}
type LocalAdmission = Readonly<{ mode: "shared" | "exclusive" }>;
const installationAdmissions = new Map<string, Set<LocalAdmission>>();
function activeAdmissions(control: string): readonly LocalAdmission[] {
  return [...(installationAdmissions.get(control) ?? [])];
}
function withInstallationControl<T>(control: string, callback: (held: PrivateFileLock) => T): T {
  privateDirectory(control);
  return withPrivateFileLock(control, ".installation-mutation.lock", callback);
}
class ActiveProfilePublicationRead {
  #active = true;
  readonly #control: string;
  readonly #workspace: string;
  readonly #locator: RuntimeLocator;
  readonly #operationId: string;
  readonly #held: PrivateFileLock;
  readonly #assertLease: () => void;
  constructor(control: string, workspace: string, locator: RuntimeLocator, operationId: string, held: PrivateFileLock, assertLease: () => void) {
    this.#control = control; this.#workspace = workspace; this.#locator = locator;
    this.#operationId = operationId; this.#held = held; this.#assertLease = assertLease;
  }
  assertHeld(): void {
    if (!this.#active) fail("profile-publication-read-expired");
    this.#assertLease(); this.#held.assertHeld();
  }
  assertOperation(stateRoot: string, operationId: string): void {
    this.assertHeld();
    if (this.#locator.stateRoot !== stateRoot || this.#operationId !== operationId) fail("credential-key-stage-publication-scope-mismatch");
  }
  read(): ProfileRegistryDocument {
    this.assertHeld();
    const current = readLocator(this.#control, this.#workspace);
    if (!equalLocator(current, this.#locator)) fail("profile-machine-authority-changed");
    return readMachineRegistry(this.#control, this.#locator, false, this.#operationId);
  }
  expire(): void { this.#active = false; }
}
export type ProfilePublicationRead = ActiveProfilePublicationRead;
export function readProfilePublicationRegistry(scope: ProfilePublicationRead): ProfileRegistryDocument {
  if (!(scope instanceof ActiveProfilePublicationRead)) fail("profile-publication-read-unissued");
  return scope.read();
}
function readInstallation(control: string, workspace: string): z.infer<typeof InstallationSchema> {
  const installed = readStrict(join(control, "installation.json"), InstallationSchema);
  if (installed.workspace !== workspace) fail("installation workspace mismatch");
  return installed;
}
function receiptPath(control: string, generation: number, operationId: string): string {
  return join(control, RECEIPTS, `${String(generation).padStart(12, "0")}-${operationId}.json`);
}
function pinnedWitnessEntries(stateRoot: string, receipts: readonly RelocationCompletionReceipt[]): string[] {
  const names = new Set<string>();
  for (const receipt of receipts) {
    for (const row of receipt.retentions) {
      for (const path of [row.source, row.retained]) {
        if (!inside(stateRoot, path)) continue;
        if (dirname(path) !== stateRoot) fail("historical retained witness is nested too deeply for lock shell");
        names.add(PinnedEntrySchema.parse(basename(path)));
      }
    }
  }
  return [...names].sort();
}
function pinnedForOperation(retentions: readonly z.infer<typeof RetentionSchema>[], sourceStateRoot: string,
  receipts: readonly RelocationCompletionReceipt[]): string[] {
  const state = retentions.find((row) => row.role === "state");
  if (!state) return [];
  const pinned = pinnedWitnessEntries(sourceStateRoot, receipts);
  if (state.strategy === "whole-root" && pinned.length > 0) fail("historical retained witness requires a source shell");
  return pinned;
}
function readReceiptChain(control: string, workspace: string, installationId: string): readonly RelocationCompletionReceipt[] {
  const directory = join(control, RECEIPTS);
  if (!lstatMaybe(directory)) return [];
  privateDirectory(directory);
  const names = readdirSync(directory).sort();
  let source: RuntimePair = { stateRoot: resolve(workspace, rebuildRuntimeIsolation.stateRoot),
    artifactRoot: resolve(workspace, rebuildRuntimeIsolation.artifactRoot) };
  let epochs = { state: 0, artifact: 0 };
  const accepted: RelocationCompletionReceipt[] = [];
  return Object.freeze(names.map((name, index) => {
    if (!/^\d{12}-[0-9a-f-]{36}\.json$/u.test(name)) fail("unexpected relocation receipt entry");
    const receipt = readStrict(join(directory, name), CompletionReceiptSchema);
    if (receipt.installationId !== installationId || receipt.fromGeneration !== index || receipt.toGeneration !== index + 1
      || name !== `${String(index + 1).padStart(12, "0")}-${receipt.operationId}.json`
      || !equalPair(receipt.source, source) || !equalEpochs(receipt.sourceEpochs, epochs)) fail("relocation receipt chain mismatch");
    const nextEpochs = { state: receipt.destination.stateRoot === source.stateRoot ? epochs.state : index + 1,
      artifact: receipt.destination.artifactRoot === source.artifactRoot ? epochs.artifact : index + 1 };
    if (!equalEpochs(receipt.destinationEpochs, nextEpochs)) fail("relocation receipt root epochs mismatch");
    const expectedRetentions = relocationRetentions(workspace, receipt.source, receipt.destination, receipt.operationId, accepted);
    const pinned = pinnedForOperation(expectedRetentions, receipt.source.stateRoot, accepted);
    if (canonicalJsonStringify(receipt.retentions) !== canonicalJsonStringify(expectedRetentions)
      || canonicalJsonStringify(receipt.pinnedEntries) !== canonicalJsonStringify(pinned)
      || receipt.evidence.operationId !== receipt.operationId || receipt.evidence.installationId !== installationId
      || receipt.evidence.sourceGeneration !== receipt.fromGeneration
      || !equalPair(receipt.evidence.source, receipt.source) || !equalPair(receipt.evidence.destination, receipt.destination)
      || canonicalJsonStringify(receipt.evidence.plan) !== canonicalJsonStringify(receipt.plan)
      || receipt.evidence.finalDatabasePath !== join(receipt.destination.stateRoot, "state.db")
      || receipt.plan.revision !== receipt.plan.expectedRevision + 1
      || receipt.plan.desiredDigest !== planDesiredDigest(installationId, receipt.fromGeneration,
        receipt.source, receipt.destination, receipt.plan.expectedRevision)) {
      fail("relocation receipt evidence mismatch");
    }
    checkPreparationBinding(receipt, receipt.preparation);
    const { toGeneration: _toGeneration, completedAt: _completedAt, ...base } = receipt;
    const settled = { ...base, phase: "switched" as const };
    verifyActivationIntent(settled, receipt.activationIntent);
    if (receipt.evidence.configSnapshotId !== receipt.activationIntent.snapshot.configSnapshotId
      || receipt.evidence.configFingerprint !== receipt.activationIntent.snapshot.fingerprint) fail("activation receipt snapshot mismatch");
    checkRetainedSource(workspace, settled);
    source = receipt.destination;
    epochs = nextEpochs;
    accepted.push(receipt);
    return Object.freeze(receipt);
  }));
}
function movedRole(journal: RelocationJournal, role: "state" | "artifact"): boolean {
  return journal.source[`${role}Root`] !== journal.destination[`${role}Root`];
}
function retainedRoleRoot(journal: RelocationJournal, role: "state" | "artifact"): string {
  const direct = journal.retentions.find((retention) => retention.role === role);
  if (direct) return direct.retained;
  const state = journal.retentions.find((retention) => retention.role === "state");
  if (role === "artifact" && state && inside(state.source, journal.source.artifactRoot)) {
    return join(state.retained, relative(state.source, journal.source.artifactRoot));
  }
  fail("retained role path is unavailable");
}
function expectedFence(journal: RelocationJournal, role: "state" | "artifact"): z.infer<typeof FenceSchema> {
  return { schemaVersion: 2, operationId: journal.operationId, installationId: journal.installationId,
    role, bindingDigest: operationBinding(journal) };
}
function checkFence(path: string, expected: z.infer<typeof FenceSchema>): void {
  if (canonicalJsonStringify(readStrict(join(path, FENCE), FenceSchema)) !== canonicalJsonStringify(expected)) fail("source fence mismatch");
}
function fenceMovedRoles(journal: RelocationJournal): void {
  for (const role of ["state", "artifact"] as const) {
    if (!movedRole(journal, role)) continue;
    const root = journal.source[`${role}Root`];
    const expected = expectedFence(journal, role);
    if (lstatMaybe(join(root, FENCE))) checkFence(root, expected);
    else atomicJson(join(root, FENCE), expected, "data");
  }
}
function tombstoneValue(journal: RelocationJournal, role: "state" | "artifact", source: string, retained: string): z.infer<typeof TombstoneSchema> {
  return { schemaVersion: 1, kind: "relocation-tombstone", operationId: journal.operationId,
    installationId: journal.installationId, role, source, retained, bindingDigest: operationBinding(journal) };
}
function readTombstone(path: string): z.infer<typeof TombstoneSchema> {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || privatePathRejects(path, stat, "file-0400")) fail("unsafe relocation tombstone");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) fail("relocation tombstone changed during read");
    return TombstoneSchema.parse(JSON.parse(readFileSync(fd, "utf8")));
  } finally { closeSync(fd); }
}
function checkTombstone(path: string, expected: z.infer<typeof TombstoneSchema>): void {
  if (canonicalJsonStringify(readTombstone(path)) !== canonicalJsonStringify(expected)) fail("relocation tombstone mismatch");
}
function writeTombstone(path: string, expected: z.infer<typeof TombstoneSchema>): void {
  const temp = join(dirname(path), `.${basename(path)}.${expected.operationId}.tombstone.tmp`);
  if (lstatMaybe(path)) { checkTombstone(path, expected); if (lstatMaybe(temp)) { checkTombstone(temp, expected); unlinkSync(temp); fsyncPath(dirname(path)); } return; }
  if (lstatMaybe(temp)) checkTombstone(temp, expected);
  else {
    writeFileSync(temp, `${canonicalJsonStringify(expected)}\n`, { mode: 0o400, flag: "wx" });
    const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  renameSync(temp, path);
  fsyncPath(dirname(path));
}
function writeJournal(control: string, pending: RelocationJournal): void {
  atomicJson(join(control, "journal.json"), JournalSchema.parse(pending));
}
function sourceLocator(pending: RelocationJournal): RuntimeLocator {
  return { schemaVersion: 2, installationId: pending.installationId, generation: pending.fromGeneration,
    stateRoot: pending.source.stateRoot, artifactRoot: pending.source.artifactRoot,
    stateRootGeneration: pending.sourceEpochs.state, artifactRootGeneration: pending.sourceEpochs.artifact };
}
function destinationLocator(pending: RelocationJournal): RuntimeLocator {
  return { schemaVersion: 2, installationId: pending.installationId, generation: pending.fromGeneration + 1,
    stateRoot: pending.destination.stateRoot, artifactRoot: pending.destination.artifactRoot,
    stateRootGeneration: pending.destinationEpochs.state, artifactRootGeneration: pending.destinationEpochs.artifact };
}
function validateJournal(workspace: string, pending: RelocationJournal, receipts: readonly RelocationCompletionReceipt[]): void {
  const prior = receipts.slice(0, pending.fromGeneration);
  const expected = relocationRetentions(workspace, pending.source, pending.destination, pending.operationId, prior);
  const pinned = pinnedForOperation(expected, pending.source.stateRoot, prior);
  const epochs = { state: pending.source.stateRoot === pending.destination.stateRoot ? pending.sourceEpochs.state : pending.fromGeneration + 1,
    artifact: pending.source.artifactRoot === pending.destination.artifactRoot ? pending.sourceEpochs.artifact : pending.fromGeneration + 1 };
  if (canonicalJsonStringify(expected) !== canonicalJsonStringify(pending.retentions)
    || canonicalJsonStringify(pinned) !== canonicalJsonStringify(pending.pinnedEntries)
    || !equalEpochs(pending.destinationEpochs, epochs)
    || pending.plan.revision !== pending.plan.expectedRevision + 1
    || pending.plan.desiredDigest !== planDesiredDigest(pending.installationId, pending.fromGeneration,
      pending.source, pending.destination, pending.plan.expectedRevision)) {
    fail("relocation journal binding mismatch");
  }
  if (pending.phase !== "preparing") checkPreparationBinding(pending, pending.preparation);
  if (pending.phase !== "preparing" && pending.phase !== "prepared") verifyActivationIntent(pending, pending.activationIntent);
  if (pending.phase !== "preparing" && pending.phase !== "prepared" && pending.phase !== "activating") {
    const evidence = pending.evidence;
    if (evidence.operationId !== pending.operationId || evidence.installationId !== pending.installationId
      || evidence.sourceGeneration !== pending.fromGeneration || !equalPair(evidence.source, pending.source)
      || !equalPair(evidence.destination, pending.destination)
      || canonicalJsonStringify(evidence.plan) !== canonicalJsonStringify(pending.plan)
      || evidence.finalDatabasePath !== join(pending.destination.stateRoot, "state.db")
      || evidence.configSnapshotId !== pending.activationIntent.snapshot.configSnapshotId
      || evidence.configFingerprint !== pending.activationIntent.snapshot.fingerprint) fail("relocation journal stage mismatch");
  }
}
function equalLocator(left: RuntimeLocator, right: RuntimeLocator): boolean {
  return left.installationId === right.installationId && left.generation === right.generation
    && equalPair(left, right) && equalEpochs(epochsOf(left), epochsOf(right));
}
function verifyActivationIntent(pending: RelocationJournal, intentInput: VerifiedRelocationActivationIntent): VerifiedRelocationActivationIntent {
  const intent = ActivationIntentSchema.parse(intentInput);
  if (intent.operationId !== pending.operationId || intent.installationId !== pending.installationId
    || intent.sourceGeneration !== pending.fromGeneration || !equalPair(intent.source, pending.source)
    || !equalPair(intent.destination, pending.destination)
    || canonicalJsonStringify(intent.plan) !== canonicalJsonStringify(pending.plan)
    || intent.nativeDestinationPath !== join(pending.destination.stateRoot, "state.db")
    || (movedRole(pending, "state") ? intent.nativeDestinationSha256 === null : intent.nativeDestinationSha256 !== null)
    || (movedRole(pending, "state") && intent.nativeDestinationSha256 !== intent.stageAuthority.backupSha256)
    || intent.snapshot.fingerprint !== createHash("sha256").update(canonicalJsonStringify(intent.snapshot.config)).digest("hex")
    || intent.snapshot.config.paths.stateRoot !== pending.destination.stateRoot
    || intent.snapshot.config.paths.artifactRoot !== pending.destination.artifactRoot) fail("activation intent binding mismatch");
  for (const path of [intent.stageAuthority.manifestPath, intent.stageAuthority.backupPath]) {
    if (!isAbsolute(path) || resolve(path) !== path || !inside(pending.source.stateRoot, path)) {
      fail("activation copy is outside source state root");
    }
  }
  return intent;
}
function checkRetainedSource(workspace: string, pending: RelocationJournal): void {
  for (const retention of pending.retentions) {
    assertNoSymlinkComponents(dirname(retention.source));
    preflightRoot(retention.retained);
    const expected = tombstoneValue(pending, retention.role, retention.source, retention.retained);
    if (retention.strategy === "whole-root") {
      checkTombstone(retention.source, expected);
      dataDirectory(retention.retained);
    } else {
      dataDirectory(retention.source);
      dataDirectory(retention.retained);
      if (retention.strategy === "lock-shell") privateDirectory(fixedLockRoot(workspace));
      const entries = pending.phase === "preparing" || pending.phase === "prepared" || pending.phase === "activating"
        ? [] : pending.evidence.managedStateEntries;
      const expectedNames = new Set([MARKER, FENCE, "state.db", ...pending.pinnedEntries]);
      if (retention.strategy === "lock-shell") expectedNames.add("locks");
      if (movedRole(pending, "artifact") && inside(retention.source, pending.source.artifactRoot)) {
        expectedNames.add(relative(retention.source, pending.source.artifactRoot).split(/[\\/]/u)[0] ?? "");
      }
      const found = readdirSync(retention.source);
      if (found.length !== expectedNames.size || found.some((name) => !expectedNames.has(name))) fail("lock shell membership mismatch");
      const retainedNames = new Set([MARKER, FENCE, ...entries.map((entry) => entry.name)]);
      const retainedFound = readdirSync(retention.retained);
      if (retainedFound.length !== retainedNames.size || retainedFound.some((name) => !retainedNames.has(name))) {
        fail("retained managed entry membership mismatch");
      }
      checkTombstone(join(retention.source, "state.db"), tombstoneValue(pending, "state", join(retention.source, "state.db"), join(retention.retained, "state.db")));
      for (const entry of entries) {
        if (entryKind(join(retention.retained, entry.name)) !== entry.kind) fail("retained managed entry shape mismatch");
      }
      if (movedRole(pending, "artifact") && inside(retention.source, pending.source.artifactRoot)) {
        checkTombstone(pending.source.artifactRoot, tombstoneValue(pending, "artifact", pending.source.artifactRoot,
          join(retention.retained, relative(retention.source, pending.source.artifactRoot))));
      }
      checkFence(retention.source, expectedFence(pending, "state"));
      checkMarker(retention.source, pending.installationId, workspace, "state", pending.sourceEpochs.state);
    }
    checkMarker(retention.retained, pending.installationId, workspace, retention.role, pending.sourceEpochs[retention.role]);
    checkFence(retention.retained, expectedFence(pending, retention.role));
  }
  if (movedRole(pending, "artifact") && !pending.retentions.some((row) => row.role === "artifact")) {
    const root = retainedRoleRoot(pending, "artifact");
    checkMarker(root, pending.installationId, workspace, "artifact", pending.sourceEpochs.artifact);
    checkFence(root, expectedFence(pending, "artifact"));
  }
}
function retainWholeRoot(pending: RelocationJournal, row: z.infer<typeof RetentionSchema>): void {
  assertNoSymlinkComponents(dirname(row.source));
  preflightRoot(row.retained);
  const expected = tombstoneValue(pending, row.role, row.source, row.retained);
  const source = lstatMaybe(row.source);
  const retained = lstatMaybe(row.retained);
  if (source?.isDirectory() && !retained) {
    checkFence(row.source, expectedFence(pending, row.role));
    renameSync(row.source, row.retained);
    fsyncPath(dirname(row.source));
  } else if (source?.isDirectory() || !retained) fail("ambiguous retained source root");
  dataDirectory(row.retained);
  writeTombstone(row.source, expected);
}
function retainEntryShell(workspace: string, pending: RelocationJournal, row: z.infer<typeof RetentionSchema>): void {
  preflightRoot(row.source);
  preflightRoot(row.retained);
  const entries = pending.phase === "preparing" || pending.phase === "prepared" || pending.phase === "activating"
    ? [] : pending.evidence.managedStateEntries;
  dataDirectory(row.source);
  if (row.strategy === "lock-shell") privateDirectory(fixedLockRoot(workspace));
  checkMarker(row.source, pending.installationId, workspace, "state", pending.sourceEpochs.state);
  checkFence(row.source, expectedFence(pending, "state"));
  if (!lstatMaybe(row.retained)) {
    mkdirSync(row.retained, { mode: 0o700 });
    fsyncPath(dirname(row.retained));
  }
  dataDirectory(row.retained);
  const existing = readdirSync(row.retained);
  const permitted = new Set([MARKER, FENCE, ...entries.map((entry) => entry.name)]);
  if (existing.some((name) => !permitted.has(name))
    || (existing.includes(FENCE) && !existing.includes(MARKER))
    || (existing.some((name) => name !== MARKER && name !== FENCE)
      && (!existing.includes(MARKER) || !existing.includes(FENCE)))) fail("ambiguous retained shell");
  const oldMarker = readStrict(markerPath(row.source), MarkerSchema);
  const oldFence = readStrict(join(row.source, FENCE), FenceSchema);
  for (const [name, value] of [[MARKER, oldMarker], [FENCE, oldFence]] as const) {
    const path = join(row.retained, name);
    if (!lstatMaybe(path)) atomicJson(path, value, "data");
    else if (canonicalJsonStringify(name === MARKER ? readStrict(path, MarkerSchema) : readStrict(path, FenceSchema))
      !== canonicalJsonStringify(value)) fail("retained shell witness mismatch");
  }
  for (const entry of entries) {
    const original = join(row.source, entry.name);
    const retained = join(row.retained, entry.name);
    const originalStat = lstatMaybe(original);
    const retainedStat = lstatMaybe(retained);
    const tombstoneRole = entry.name === "state.db" ? "state"
      : movedRole(pending, "artifact") && original === pending.source.artifactRoot ? "artifact" : undefined;
    if (originalStat && !retainedStat && entryKind(original) === entry.kind) {
      renameSync(original, retained);
      fsyncPath(row.source);
      fsyncPath(row.retained);
    } else if (originalStat && retainedStat) {
      if (!tombstoneRole) fail("duplicate retained managed entry");
      checkTombstone(original, tombstoneValue(pending, tombstoneRole, original, retained));
    } else if (!retainedStat) fail("missing managed entry during retention");
    if (entryKind(retained) !== entry.kind) fail("retained managed entry shape mismatch");
    if (tombstoneRole) writeTombstone(original, tombstoneValue(pending, tombstoneRole, original, retained));
  }
}
function restoreFileBinding(path: string): z.infer<typeof RestoreFileBindingSchema> {
  const custody = lstatSync(path);
  if (!custody.isFile() || custody.isSymbolicLink() || custody.nlink !== 1
    || privatePathRejects(path, custody, "group-write")) fail("unsafe restore data file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd), bytes = readFileSync(fd), after = fstatSync(fd), current = lstatSync(path);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== bytes.length
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || current.dev !== before.dev || current.ino !== before.ino) fail("restore file custody changed");
    return RestoreFileBindingSchema.parse({ dev: before.dev, ino: before.ino, byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") });
  } finally { closeSync(fd); }
}
function sameRestoreFile(path: string, expected: z.infer<typeof RestoreFileBindingSchema>): void {
  if (canonicalJsonStringify(restoreFileBinding(path)) !== canonicalJsonStringify(expected)) fail("restore file binding mismatch");
}
function assertRestoreSuspect(input: AuthorityRestoreInput): void {
  sameRestoreFile(input.suspectPath, input.suspect);
  if(input.suspect.byteSize!==input.live.byteSize || input.suspect.sha256!==input.live.sha256)fail("restore suspect source binding mismatch");
  for(const suffix of ["-wal","-shm"] as const){
    const row=input.companions.find(value=>value.suffix===suffix),path=`${input.suspectPath}${suffix}`;
    if(row===undefined){if(existsSync(path))fail("restore suspect companion inventory mismatch");continue;}
    sameRestoreFile(path,row.suspect);
    if(row.suspect.byteSize!==row.binding.byteSize || row.suspect.sha256!==row.binding.sha256)fail("restore suspect companion source binding mismatch");
  }
}

function assertCompletedRestoreCustody(locator: RuntimeLocator, record: CompletedRestoreCustody): void {
  const root = join(locator.stateRoot, "profiles", record.profile.profileId), path = join(root, record.suspect.relativePath);
  if (record.profile.installationId !== locator.installationId || record.sourceGeneration > locator.generation
    || record.suspect.relativePath !== join("backups", "suspects", basename(path))
    || !basename(path).endsWith(`-${record.operationId}.sqlite`)) fail("completed-restore-profile-binding-mismatch");
  assertNoSymlinkComponents(path);
  sameRestoreFile(path, record.suspect.file);
  for (const suffix of ["-wal", "-shm"] as const) {
    const companion = record.companions.find(row => row.suffix === suffix);
    if (companion === undefined) {
      if (lstatMaybe(`${path}${suffix}`)) fail("completed-restore-companion-inventory-mismatch");
    } else sameRestoreFile(`${path}${suffix}`, companion.file);
  }
  if (lstatMaybe(`${path}-journal`)) fail("completed-restore-companion-inventory-mismatch");
}

function completedRestoreCustody(input: AuthorityRestoreInput, locator: RuntimeLocator, outcome: "unchanged" | "replaced"): CompletedRestoreCustody {
  const root = join(locator.stateRoot, "profiles", input.profile.binding.profileId);
  const record = CompletedRestoreCustodySchema.parse({ operationId: input.operationId, profile: input.profile.binding,
    sourceGeneration: locator.generation, outcome, suspect: { relativePath: relative(root, input.suspectPath), file: input.suspect },
    companions: input.companions.map(row => ({ suffix: row.suffix, file: row.suspect })) });
  assertCompletedRestoreCustody(locator, record);
  return record;
}

function assertRestoreCredentialSnapshot(locator: RuntimeLocator, profile: ProfileRestoreContext): void {
  const { credentials, binding } = profile;
  if (binding.installationId !== locator.installationId || canonicalJsonStringify(credentials.binding) !== canonicalJsonStringify(binding)) fail("profile-restore-credential-binding-mismatch");
  const path = join(locator.stateRoot, "machine", "credential-keys", `${binding.profileId}.json`), file = readPrivateFile(path, { label: "lock", maxBytes: 25 * 1024 * 1024 });
  if (file === undefined || createHash("sha256").update(file.bytes).digest("hex") !== credentials.digest) fail("profile-restore-credential-head-changed");
  const head = CanonicalCredentialHeadSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)));
  if (head.state !== "active" || head.installationId !== binding.installationId || head.profileId !== binding.profileId
    || head.key.installationId !== binding.installationId || head.key.profileId !== binding.profileId
    || head.key.keyId !== credentials.keyId || head.generation !== credentials.generation
    || canonicalJsonStringify(head.counters) !== canonicalJsonStringify(credentials.counters)
    || canonicalJsonStringify(head.retired) !== canonicalJsonStringify(credentials.retired)) fail("profile-restore-credential-head-changed");
  credentialKeyCustody.read(head.key);
}

function checkRestoreInput(locator: RuntimeLocator, input: AuthorityRestoreInput): void {
  for (const path of [input.authorityPath, input.stagedPath, input.suspectPath, input.manifestPath, input.backupPath]) {
    if (!isAbsolute(path) || resolve(path) !== path) fail("restore path must be absolute and canonical");
    assertNoSymlinkComponents(path);
  }
  const root = join(locator.stateRoot, "profiles", input.profile.binding.profileId);
  if (input.profile.binding.installationId !== locator.installationId || input.profile.continuity.installationId !== locator.installationId) fail("restore profile installation mismatch");
  assertRestoreCredentialSnapshot(locator, input.profile);
  if (input.authorityPath !== join(root, "state.db")
    || input.stagedPath !== join(root, `.restore-${input.operationId}.sqlite.tmp`)
    || dirname(input.suspectPath) !== join(root, "backups", "suspects")
    || dirname(input.backupPath) !== join(root, "backups", "authority") || dirname(input.manifestPath) !== join(root, "backups", "authority")
    || !basename(input.suspectPath).endsWith(`-${input.operationId}.sqlite`)
    || new Set(input.companions.map(row => row.suffix)).size !== input.companions.length) fail("restore path or companion binding mismatch");
}
function readLocator(control: string, workspace: string, recovery?: { installationId: string; fromGeneration: number; operationId: string },
  restoreRecovery?: { operationId: string; restoreAdmission: OfflineMaintenanceOperation }): RuntimeLocator {
  const installation = readInstallation(control, workspace);
  if (!existsSync(join(control, "locator.json"))) fail("installation locator missing; offline recovery required");
  const locator = readStrict(join(control, "locator.json"), LocatorSchema);
  if (locator.installationId !== installation.installationId) fail("locator installation mismatch");
  validatePair(workspace, locator);
  const receipts = readReceiptChain(control, workspace, installation.installationId);
  if (existsSync(join(control, "journal.json"))) {
    const journal = readStrict(join(control, "journal.json"), JournalSchema);
    if (journal.phase === "restoring") {
      if (restoreRecovery === undefined || journal.restore.operationId !== restoreRecovery.operationId
        || journal.installationId !== installation.installationId
        || canonicalJsonStringify(journal.source) !== canonicalJsonStringify(locator)
        || receipts.length !== locator.generation) fail("unfinished restoring operation; exact offline restore recovery required");
      assertRestoreHeld(workspace, restoreRecovery.restoreAdmission);
      checkRestoreInput(locator, journal.restore);
      const epochs = epochsOf(locator);
      checkMarker(locator.stateRoot, locator.installationId, workspace, "state", epochs.state);
      checkMarker(locator.artifactRoot, locator.installationId, workspace, "artifact", epochs.artifact);
      if (existsSync(join(locator.stateRoot, FENCE)) || existsSync(join(locator.artifactRoot, FENCE))) fail("restore source is fenced");
      return locator;
    }
    if (journal.phase === "adopting" || !recovery || recovery.installationId !== journal.installationId
      || recovery.fromGeneration !== journal.fromGeneration || recovery.operationId !== journal.operationId) {
      fail(`unfinished ${journal.phase} operation; explicit offline recovery required`);
    }
    validateJournal(workspace, journal, receipts);
    const completedReceipt = receipts.at(-1);
    const receiptPending = receipts.length === journal.fromGeneration + 1 && completedReceipt?.operationId === journal.operationId;
    if (receipts.length !== journal.fromGeneration && !receiptPending) fail("recovery receipt chain mismatch");
    if (!equalPair((receiptPending ? receipts.at(-2) : completedReceipt)?.destination ?? {
      stateRoot: resolve(workspace, rebuildRuntimeIsolation.stateRoot), artifactRoot: resolve(workspace, rebuildRuntimeIsolation.artifactRoot),
    }, journal.source)) fail("recovery receipt chain mismatch");
    if (receiptPending && (journal.phase !== "switched" || !equalPair(completedReceipt.destination, journal.destination))) fail("recovery completion receipt mismatch");
    const atSource = locator.generation === journal.fromGeneration && equalPair(locator, journal.source)
      && equalEpochs(epochsOf(locator), journal.sourceEpochs);
    const atDestination = locator.generation === journal.fromGeneration + 1 && equalPair(locator, journal.destination)
      && equalEpochs(epochsOf(locator), journal.destinationEpochs);
    if (!atSource && !atDestination) fail("recovery locator mismatch");
    if (journal.phase === "switched" && !atDestination) fail("switched journal locator mismatch");
  } else if (recovery) {
    fail("relocation recovery journal missing");
  } else {
    if (receipts.length !== locator.generation
      || (receipts.length > 0 && (!equalPair(receipts.at(-1)!.destination, locator)
        || !equalEpochs(receipts.at(-1)!.destinationEpochs, epochsOf(locator))))) fail("active locator receipt chain mismatch");
    const epochs = epochsOf(locator);
    checkMarker(locator.stateRoot, locator.installationId, workspace, "state", epochs.state);
    checkMarker(locator.artifactRoot, locator.installationId, workspace, "artifact", epochs.artifact);
    if (existsSync(join(locator.stateRoot, FENCE)) || existsSync(join(locator.artifactRoot, FENCE))) fail("locator points to a fenced source");
  }
  return locator;
}
function rawLocator(control: string, workspace: string): RuntimeLocator {
  const installation = readInstallation(control, workspace);
  if (!lstatMaybe(join(control, "locator.json"))) fail("installation locator missing; offline recovery required");
  const locator = readStrict(join(control, "locator.json"), LocatorSchema);
  if (locator.installationId !== installation.installationId) fail("locator installation mismatch");
  validatePair(workspace, locator);
  return locator;
}
function defaultEmpty(pair: RuntimePair): boolean {
  const permittedStateEntry = inside(pair.stateRoot, pair.artifactRoot) ? relative(pair.stateRoot, pair.artifactRoot).split(/[\\/]/u)[0] : undefined;
  for (const [root, allowed] of [[pair.stateRoot, permittedStateEntry], [pair.artifactRoot, undefined]] as const) {
    if (!lstatMaybe(root)) continue;
    dataDirectory(root);
    if (readdirSync(root).some((name) => name !== allowed)) return false;
  }
  return true;
}
function readProfileEvidence<T>(path: string, schema: z.ZodType<T>): T {
  const file = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
  if (file === undefined) fail("profile-registry-evidence-missing");
  return schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
}
function profileOperationInventory(machineRoot: string) {
  const directory = join(machineRoot, "machine", "operations");
  if (!lstatMaybe(directory)) return [];
  privateDirectory(directory);
  return readdirSync(directory).filter(name => name.endsWith(".json")).sort().map(name => {
    const path = join(directory, name);
    const operation = readProfileEvidence(path, ProfileOperationSchema);
    if (name !== `${operation.operationId}.json`) fail("profile-operation-identity-mismatch");
    return { operationId: operation.operationId, digest: createHash("sha256").update(canonicalJsonStringify(operation)).digest("hex") };
  });
}

function profileRegistryWitness(installationId: string, path: string, document: ProfileRegistryDocument, completedRestores: readonly CompletedRestoreCustody[]) {
  privateFile(path);
  if (document.installationId !== installationId) fail("profile-registry-installation-mismatch");
  return ProfileContinuitySchema.parse({ schemaVersion: 5, installationId, revision: document.revision,
    digest: createHash("sha256").update(canonicalJsonStringify(document)).digest("hex"),
    generation: document.sessionGeneration, completedRestores, operations: profileOperationInventory(dirname(dirname(path))) });
}

function assertProfileCredentialKeyMembership(locator: RuntimeLocator, heads: readonly z.infer<typeof ProfileErasureHeadSchema>[]): void {
  const directory = join(locator.stateRoot, "machine", "credential-keys");
  assertNoSymlinkComponents(directory); privateDirectory(directory);
  const expected = heads.filter(row => row.credentialKey !== undefined).map(row => `${row.profileId}.json`).sort();
  if (canonicalJsonStringify(readdirSync(directory).sort()) !== canonicalJsonStringify(expected)) fail("profile-credential-key-unowned");
  for (const row of heads) {
    const anchor = row.credentialKey;
    if (anchor === undefined) fail("profile-control-upgrade-credential-conversion-required");
    const file = readPrivateFile(join(directory, `${row.profileId}.json`), { label: "lock", maxBytes: 4096 });
    if (file === undefined) fail("credential-key-required");
    const raw = z.looseObject({ schemaVersion: z.union([z.literal(1), z.literal(2)]), installationId: z.uuid(), profileId: z.uuid(), keyId: z.uuid(), legacyWitness: z.literal(true).optional() })
      .parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)));
    if (raw.installationId !== locator.installationId || raw.profileId !== row.profileId || raw.keyId !== anchor.keyId
      || anchor.binding.installationId !== raw.installationId || anchor.binding.profileId !== raw.profileId) fail("profile-credential-key-unowned");
    let bytes = file.bytes;
    if (raw.schemaVersion === 2 && raw.legacyWitness === true) {
      const metadata = z.strictObject({ schemaVersion: z.literal(2), installationId: z.uuid(), profileId: z.uuid(), keyId: z.uuid(), keyDigest: DigestSchema, legacyWitness: z.literal(true) }).parse(raw);
      const { legacyWitness: _legacyWitness, ...native } = metadata;
      bytes = Buffer.from(encodePrivate(credentialKeyCustody.read(native)));
    }
    if (file.identity.device !== anchor.file.device || file.identity.inode !== anchor.file.inode
      || createHash("sha256").update(bytes).digest("hex") !== anchor.file.digest) fail("profile-credential-key-unowned");
  }
}


function readProfilePublicationSource(control: string, locator: RuntimeLocator) {
  if (lstatMaybe(join(control, "device-recertification.json"))) fail("device-recertification-pending");
  const path = join(locator.stateRoot, "machine", "profiles.json");
  if (lstatMaybe(join(control, "profile-control-upgrade.json"))) fail("profile-control-upgrade-pending");
  assertNoSymlinkComponents(path);
  readProfileEvidence(join(locator.stateRoot, "machine", "profile-registry-version.json"), z.strictObject({ schemaVersion: z.literal(6) }));
  const document = readProfileEvidence(path, ProfileRegistryDocumentSchema);
  readProfileEvidence(join(locator.stateRoot, "machine", "profile-verifiers.json"), ProfileVerifierDocumentSchema);
  const pepperPath = join(locator.stateRoot, "machine", "profile-pepper");
  const pepper = readPrivateFile(pepperPath, { label: "lock", maxBytes: 32 });
  if (pepper === undefined || pepper.bytes.byteLength !== 32) fail("profile-verifier-evidence-invalid");
  const witnessPath = join(control, "profile-registry.json");
  const witness = readProfileEvidence(witnessPath, ProfileContinuitySchema);
  return { path, document, witnessPath, witness };
}

function readMachineRegistry(control: string, locator: RuntimeLocator, recoverPublication = true, publicationOperationId?: string): ProfileRegistryDocument {
  const { path, document, witness, witnessPath } = readProfilePublicationSource(control, locator);
  const intentPath = join(control, "profile-publication.json");
  if (lstatMaybe(intentPath)) {
    const intent = readProfileEvidence(intentPath, ProfilePublicationSchema);
    const operationId = intent.kind === "profile" ? intent.operation?.kind === "write" ? intent.operation.operation.operationId : undefined
      : intent.kind === "onboarding-finish" ? intent.operation.operationId : intent.capture.operation.operationId;
    if (publicationOperationId !== undefined && operationId !== publicationOperationId) fail("profile-publication-read-operation-mismatch");
    if (intent.kind === "profile") {
      if (!recoverPublication && publicationOperationId === undefined) fail("profile-registry-publication-pending");
      const finish = prepareProfileRegistryPublication(control, locator, path, document, witness, intent);
      if (recoverPublication) finish();
      return document;
    }
    if (intent.kind === "onboarding-finish") assertOnboardingFinishPublicationDocument(locator, intent);
    if (intent.kind === "draft-abort") {
      const operation = intent.capture.operation;
      if (document.activeProfileId !== null || document.revision !== intent.prior.revision || document.sessionGeneration !== intent.prior.generation
        || createHash("sha256").update(canonicalJsonStringify(document)).digest("hex") !== intent.prior.digest
        || document.profiles.some(row => row.profileId === operation.profileId) || operation.onboarding?.abort === undefined) fail("profile-draft-abort-invalid");
    }
    // Credential publication settles only through its captured owner, never a registry read.
    if (intent.installationId !== locator.installationId) fail("profile-publication-installation-mismatch");
    const prior = intent.kind === "draft-abort" ? undefined : intent.priorDocument;
    const next = intent.kind === "draft-abort" ? undefined : intent.document;
    if (prior !== undefined && next !== undefined && canonicalJsonStringify(document) !== canonicalJsonStringify(prior)
      && canonicalJsonStringify(document) !== canonicalJsonStringify(next)) fail("profile-publication-registry-changed");
    const expected = profileRegistryWitness(locator.installationId, path, document, intent.prior.completedRestores);
    if (canonicalJsonStringify(witness) !== canonicalJsonStringify(intent.prior)
      && canonicalJsonStringify(witness) !== canonicalJsonStringify(expected)) fail("profile-publication-control-changed");
    return document;
  }
  if (canonicalJsonStringify(profileRegistryWitness(locator.installationId, path, document, witness.completedRestores)) !== canonicalJsonStringify(witness)) fail("profile-registry-continuity-mismatch");
  for (const record of witness.completedRestores) assertCompletedRestoreCustody(locator, record);
  privateFile(witnessPath);
  return document;
}

function assertProfileRegistryPublicationDocument(locator: RuntimeLocator,
  intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "profile" }>): void {
  const { prior, document } = intent;
  if (intent.installationId !== locator.installationId || prior.installationId !== locator.installationId
    || document.installationId !== locator.installationId) fail("profile-registry-publication-conflict");
  if (intent.operation === undefined) {
    if (document.revision !== prior.revision + 1 || document.sessionGeneration < prior.generation) fail("profile-registry-publication-conflict");
  } else if (document.revision !== prior.revision || document.sessionGeneration !== prior.generation
    || createHash("sha256").update(canonicalJsonStringify(document)).digest("hex") !== prior.digest) fail("profile-operation-publication-uncertain");
}

function prepareProfileRegistryPublication(control: string, locator: RuntimeLocator, path: string,
  document: ProfileRegistryDocument, witness: z.infer<typeof ProfileContinuitySchema>,
  intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "profile" }>): () => void {
  assertProfileRegistryPublicationDocument(locator, intent);
  if (intent.installationId !== locator.installationId || canonicalJsonStringify(intent.document) !== canonicalJsonStringify(document)) fail("profile-registry-publication-uncertain");
  const published = profileRegistryWitness(locator.installationId, path, document, intent.prior.completedRestores);
  if (intent.operation !== undefined) {
    const mutation = intent.operation;
    const operationId = mutation.kind === "write" ? mutation.operation.operationId : mutation.operationId;
    const others = (rows: typeof published.operations) => rows.filter(row => row.operationId !== operationId);
    if (canonicalJsonStringify(others(published.operations)) !== canonicalJsonStringify(others(intent.prior.operations))) fail("profile-operation-publication-uncertain");
    const operationPath = join(locator.stateRoot, "machine", "operations", `${operationId}.json`);
    if (mutation.kind === "write") {
      if (canonicalJsonStringify(readProfileEvidence(operationPath, ProfileOperationSchema)) !== canonicalJsonStringify(mutation.operation)) fail("profile-operation-publication-uncertain");
    } else if (lstatMaybe(operationPath)) fail("profile-operation-publication-uncertain");
  } else if (canonicalJsonStringify(published.operations) !== canonicalJsonStringify(intent.prior.operations)) fail("profile-operation-publication-uncertain");
  if (canonicalJsonStringify(intent.prior) !== canonicalJsonStringify(witness)
    && canonicalJsonStringify(published) !== canonicalJsonStringify(witness)) fail("profile-registry-publication-uncertain");
  return () => {
    atomicJson(join(control, "profile-registry.json"), published);
    unlinkSync(join(control, "profile-publication.json")); fsyncPath(control);
  };
}

function assertDuoMembership(locator: RuntimeLocator, document: ProfileRegistryDocument, rows: readonly DuoContinuityRow[]): void {
  if (rows.length !== document.profiles.length || new Set(rows.map(row => row.profileId)).size !== rows.length
    || rows.some(row => !document.profiles.some(profile => profile.profileId === row.profileId))) fail("duo-profile-membership-mismatch");
  const allRows = rows;
  const directory = join(locator.stateRoot, "machine", "duo-credentials");
  assertNoSymlinkComponents(directory);
  if (lstatMaybe(directory)) {
    privateDirectory(directory);
    const expected = allRows.filter(row => row.state !== "never-initialized").map(row => `${row.profileId}.json`).sort();
    if (canonicalJsonStringify(readdirSync(directory).sort()) !== canonicalJsonStringify(expected)) fail("duo-document-membership-mismatch");
  }
  for (const row of allRows) {
    const path = join(directory, `${row.profileId}.json`);
    if (row.state === "never-initialized") { if (lstatMaybe(path)) fail("duo-document-membership-mismatch"); }
    else if (!sameControlUpgradeFile(path, row.document, 25 * 1024 * 1024)) fail("duo-document-custody-changed");
  }
}

function profileOnboardingCompletion(operation: z.infer<typeof SignUpOperationSchema>) {
  assertFinishedProfileOnboarding(operation);
  const draft = operation.onboarding;
  if (draft?.finish === undefined) fail("profile-onboarding-incomplete");
  const key = draft.attempts.findLast(entry => entry.method === "key" && entry.generation === draft.generation);
  const touch = draft.attempts.findLast(entry => entry.method === "touch" && entry.generation === draft.generation);
  if (key === undefined || touch?.operatorConfirmedAt === undefined) fail("profile-onboarding-incomplete");
  return ProfileOnboardingCompletionSchema.parse({ generation: draft.generation, ...draft.finish,
    key: { receiptDigest: createHash("sha256").update(canonicalJsonStringify(key)).digest("hex"),
      confirmation: key.operatorConfirmedAt === undefined ? "exact-credential-request" : "operator" },
    touch: { receiptDigest: createHash("sha256").update(canonicalJsonStringify(touch)).digest("hex"),
      softwareInterceptionDisabled: true, operatorConfirmedAt: touch.operatorConfirmedAt } });
}

function assertOnboardingFinishPublicationDocument(locator: RuntimeLocator,
  intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "onboarding-finish" }>): void {
  const { operation, prior, priorDocument, document, priorVerifiers, verifiers } = intent;
  const added = document.profiles.filter(row => !priorDocument.profiles.some(prior => prior.profileId === row.profileId));
  const verifier = verifiers.profiles.filter(row => !priorVerifiers.profiles.some(prior => prior.profileId === row.profileId));
  if (intent.installationId !== locator.installationId || operation.phase !== "publishing" || operation.credentials.phase !== "ready"
    || added.length !== 1 || verifier.length !== 1 || added[0]?.profileId !== operation.profileId || verifier[0]?.profileId !== operation.profileId
    || verifier[0].emailKey !== operation.emailKey || priorVerifiers.profiles.some(row => row.emailKey === operation.emailKey)
    || priorDocument.installationId !== locator.installationId || document.installationId !== locator.installationId
    || priorDocument.activeProfileId !== null || priorDocument.revision !== prior.revision || priorDocument.sessionGeneration !== prior.generation
    || createHash("sha256").update(canonicalJsonStringify(priorDocument)).digest("hex") !== prior.digest
    || canonicalJsonStringify(document) !== canonicalJsonStringify(advanceProfileRegistryDocument(priorDocument, { profiles: [...priorDocument.profiles, added[0]] }))
    || canonicalJsonStringify(verifiers) !== canonicalJsonStringify({ ...priorVerifiers, profiles: [...priorVerifiers.profiles, verifier[0]] })
    || added[0].firstName !== operation.firstName || added[0].lastName !== operation.lastName || added[0].createdAt !== operation.createdAt
    || added[0].lifecycle !== "ready" || added[0].credentialState !== "saved" || added[0].duoState !== "ready"
    || added[0].registration.operationId !== operation.operationId || added[0].registration.commandId !== operation.commandId
    || added[0].registration.writeId !== operation.writeId || operation.expectedRevision === undefined
    || added[0].registration.credentialRevision !== operation.expectedRevision + 1
    || canonicalJsonStringify(added[0].registration.onboardingCompletion) !== canonicalJsonStringify(profileOnboardingCompletion(operation))) fail("profile-onboarding-finish-invalid");
  const current = readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`), SignUpOperationSchema);
  if (canonicalJsonStringify(current) !== canonicalJsonStringify(operation)) fail("profile-onboarding-finish-operation-changed");
  const pepper = readPrivateFile(join(locator.stateRoot, "machine", "profile-pepper"), { label: "lock", maxBytes: 32 });
  if (pepper === undefined || pepper.bytes.length !== 32 || pepper.identity.device !== intent.pepper.device || pepper.identity.inode !== intent.pepper.inode
    || createHash("sha256").update(pepper.bytes).digest("hex") !== intent.pepper.digest) fail("profile-onboarding-finish-pepper-changed");
}

function prepareProfileOnboardingFinish(control: string, locator: RuntimeLocator,
  intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "onboarding-finish" }>, revalidate: () => void): () => void {
  assertOnboardingFinishPublicationDocument(locator, intent);
  const { operation, prior, priorDocument, document, priorVerifiers, verifiers } = intent;
  const root = join(locator.stateRoot, "profiles", operation.profileId), registryPath = join(locator.stateRoot, "machine", "profiles.json"),
    verifierPath = join(locator.stateRoot, "machine", "profile-verifiers.json");
  revalidate(); assertCanonicalProfileBinding(join(root, "state.db"), { installationId: locator.installationId, profileId: operation.profileId });
  if (canonicalJsonStringify(profileAuthorityFileWitnesses(root)) !== canonicalJsonStringify(intent.databases)) fail("profile-onboarding-finish-source-changed");
  const currentVerifiers = readStrict(verifierPath, ProfileVerifierDocumentSchema), currentDocument = readStrict(registryPath, ProfileRegistryDocumentSchema);
  const before = canonicalJsonStringify(currentDocument) === canonicalJsonStringify(priorDocument), after = canonicalJsonStringify(currentDocument) === canonicalJsonStringify(document),
    verifierBefore = canonicalJsonStringify(currentVerifiers) === canonicalJsonStringify(priorVerifiers), verifierAfter = canonicalJsonStringify(currentVerifiers) === canonicalJsonStringify(verifiers);
  if (!before && !after || !verifierBefore && !verifierAfter || after && !verifierAfter) fail("profile-onboarding-finish-order-invalid");
  const continuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
  if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(prior)
    && (!after || canonicalJsonStringify(continuity) !== canonicalJsonStringify(profileRegistryWitness(locator.installationId, registryPath, document, prior.completedRestores)))) fail("profile-onboarding-finish-control-changed");
  return () => {
    revalidate(); if (verifierBefore) atomicJson(verifierPath, verifiers);
    revalidate(); if (before) atomicJson(registryPath, document);
    revalidate(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, registryPath, document, prior.completedRestores));
    revalidate(); unlinkSync(join(control, "profile-publication.json")); fsyncPath(control);
  };
}

function prepareIncompleteProfileDraft(control: string, locator: RuntimeLocator,
  intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "incomplete-profile-draft" }>): () => void {
  const { capture, prior, priorDocument, document, priorVerifiers, verifiers } = intent, operation = capture.operation;
  const target = priorDocument.profiles.find(row => row.profileId === operation.profileId), binding = { installationId: locator.installationId, profileId: operation.profileId };
  if (intent.installationId !== locator.installationId || binding.installationId !== locator.installationId || binding.profileId !== operation.profileId
    || target === undefined || target.registration.onboardingCompletion !== undefined || target.duoState !== "not-set-up" || target.migratedFromLegacy !== undefined
    || target.registration.operationId !== operation.operationId || target.registration.commandId !== operation.commandId || target.registration.writeId !== operation.writeId
    || operation.phase !== "applying" || operation.credentials.phase !== "ready" || operation.onboarding === undefined || operation.onboarding.attempts.length !== 0
    || operation.onboarding.finish !== undefined || operation.onboarding.abort !== undefined
    || canonicalJsonStringify(document) !== canonicalJsonStringify(advanceProfileRegistryDocument(priorDocument, { profiles: priorDocument.profiles.filter(row => row.profileId !== operation.profileId),
      activeProfileId: priorDocument.activeProfileId === operation.profileId ? null : priorDocument.activeProfileId, sessionGeneration: priorDocument.sessionGeneration + 1 }))
    || canonicalJsonStringify(verifiers) !== canonicalJsonStringify({ ...priorVerifiers, profiles: priorVerifiers.profiles.filter(row => row.profileId !== operation.profileId) })
    || priorVerifiers.profiles.filter(row => row.profileId === operation.profileId).length !== 1) fail("profile-incomplete-reclassification-invalid");
  if (createHash("sha256").update(canonicalJsonStringify(priorDocument)).digest("hex") !== prior.digest
    || prior.generation !== priorDocument.sessionGeneration || prior.revision !== priorDocument.revision) fail("profile-incomplete-prior-changed");
  const root = join(locator.stateRoot, "profiles", operation.profileId), registryPath = join(locator.stateRoot, "machine", "profiles.json");
  if (canonicalJsonStringify(unpublishedDraftAbortMembership(root)) !== canonicalJsonStringify(capture.membership)) fail("profile-incomplete-copy-membership-changed");
  assertCanonicalProfileBinding(join(root, "state.db"), binding);
  if (canonicalJsonStringify(profileAuthorityFileWitnesses(root)) !== canonicalJsonStringify(capture.databases)) fail("profile-incomplete-source-changed");
  const sources = [{ path: join(locator.stateRoot, "machine", "credential-keys", `${operation.profileId}.json`), file: capture.credentials.head },
    ...capture.credentials.files.map(file => ({ path: file.kind === "duo" ? join(locator.stateRoot, "machine", "duo-credentials", `${operation.profileId}.json`)
      : join(root, "credentials", file.kind === "protected" ? "protected.json" : "chatgpt-account.json"), file: { device: file.device, inode: file.inode, digest: file.digest } }))];
  for (const source of sources) if (!sameControlUpgradeFile(source.path, source.file, 25 * 1024 * 1024)) fail("profile-incomplete-source-changed");
  const currentDocument = readProfileEvidence(registryPath, ProfileRegistryDocumentSchema), verifierPath = join(locator.stateRoot, "machine", "profile-verifiers.json");
  const currentVerifiers = readProfileEvidence(verifierPath, ProfileVerifierDocumentSchema), operationPath = join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`);
  const operationPresent = lstatMaybe(operationPath) !== undefined;
  if (operationPresent && canonicalJsonStringify(readProfileEvidence(operationPath, SignUpOperationSchema)) !== canonicalJsonStringify(operation)) fail("profile-incomplete-operation-changed");
  const isPrior = canonicalJsonStringify(currentDocument) === canonicalJsonStringify(priorDocument), isNext = canonicalJsonStringify(currentDocument) === canonicalJsonStringify(document);
  const verifierPrior = canonicalJsonStringify(currentVerifiers) === canonicalJsonStringify(priorVerifiers), verifierNext = canonicalJsonStringify(currentVerifiers) === canonicalJsonStringify(verifiers);
  if (!isPrior && !isNext || !verifierPrior && !verifierNext || !operationPresent && (!isPrior || !verifierPrior) || isNext && !verifierNext) fail("profile-incomplete-reclassification-order-invalid");
  const current = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
  const next = profileRegistryWitness(locator.installationId, registryPath, currentDocument, prior.completedRestores);
  if (canonicalJsonStringify(current) !== canonicalJsonStringify(prior) && (!isNext || !operationPresent || canonicalJsonStringify(current) !== canonicalJsonStringify(next))) fail("profile-incomplete-control-changed");
  return () => {
    const revalidate = () => { prepareIncompleteProfileDraft(control, locator, intent); };
    revalidate(); if (!operationPresent) atomicJson(operationPath, operation);
    revalidate(); if (verifierPrior) atomicJson(verifierPath, verifiers);
    revalidate(); if (isPrior) atomicJson(registryPath, document);
    revalidate(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, registryPath, document, prior.completedRestores));
    revalidate(); unlinkSync(join(control, "profile-publication.json")); fsyncPath(control);
  };
}

function prepareUnpublishedDraftAbort(control: string, locator: RuntimeLocator, document: ProfileRegistryDocument,
  witness: z.infer<typeof ProfileContinuitySchema>, intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "draft-abort" }>): () => void {
  const { capture, prior } = intent, operation = capture.operation, abort = operation.onboarding?.abort;
  if (intent.installationId !== locator.installationId || operation.phase !== "applying" || abort === undefined
    || operation.onboarding?.finish !== undefined || operation.onboarding?.attempts.some(attempt => attempt.providerClosedAt === undefined)
    || document.activeProfileId !== null || document.profiles.some(row => row.profileId === operation.profileId)) fail("profile-draft-abort-invalid");
  const root = join(locator.stateRoot, "profiles", operation.profileId), operationPath = join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`),
    headPath = join(locator.stateRoot, "machine", "credential-keys", `${operation.profileId}.json`);
  if (capture.head === undefined) {
    if (operation.credentials.phase !== "planned" || operation.onboarding?.attempts.length !== 0 || capture.membership.length !== 0 || capture.databases.length !== 0
      || lstatMaybe(root) || lstatMaybe(headPath)) fail("profile-draft-abort-uninitialized-source-changed");
    credentialKeyCustody.assertAbsent({ installationId: locator.installationId, profileId: operation.profileId, keyId: operation.credentials.keyId });
  } else {
    const headFile = readPrivateFile(headPath, { label: "lock", maxBytes: 25 * 1024 * 1024 });
    if (headFile === undefined || canonicalJsonStringify({ ...headFile.identity, digest: createHash("sha256").update(headFile.bytes).digest("hex") }) !== canonicalJsonStringify(capture.head)) fail("profile-draft-abort-head-changed");
    const head = CanonicalCredentialHeadSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(headFile.bytes)));
    if (head.state !== "erased" || head.installationId !== locator.installationId || head.profileId !== operation.profileId
      || head.key.installationId !== head.installationId || head.key.profileId !== head.profileId || head.key.keyId !== operation.credentials.keyId
      || head.operationId !== abort.operationId || head.generation !== abort.generation) fail("profile-draft-abort-head-changed");
  }
  if (lstatMaybe(join(locator.stateRoot, "machine", "credential-operations", `${operation.profileId}.json`))
    || lstatMaybe(join(locator.stateRoot, "machine", "duo-credentials", `${operation.profileId}.json`))) fail("profile-draft-abort-credential-operation-pending");
  const current = profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document, prior.completedRestores);
  const others = (value: typeof current) => ({ ...value, operations: value.operations.filter(row => row.operationId !== operation.operationId) });
  if (canonicalJsonStringify(others(current)) !== canonicalJsonStringify(others(prior))
    || canonicalJsonStringify(witness) !== canonicalJsonStringify(prior) && canonicalJsonStringify(witness) !== canonicalJsonStringify(current)) fail("profile-draft-abort-control-changed");
  const operationPresent = lstatMaybe(operationPath) !== undefined, rootPresent = lstatMaybe(root) !== undefined;
  if (operationPresent && canonicalJsonStringify(readProfileEvidence(operationPath, SignUpOperationSchema)) !== canonicalJsonStringify(operation)
    || rootPresent && !operationPresent) fail("profile-draft-abort-order-invalid");
  if (rootPresent) {
    const remaining = unpublishedDraftAbortMembership(root);
    for (const entry of remaining) {
      const original = capture.membership.find(prior => prior.path === entry.path);
      if (original === undefined || original.device !== entry.device || original.inode !== entry.inode || original.mode !== entry.mode
        || original.directory !== entry.directory || !entry.directory && (original.size !== entry.size || original.modified !== entry.modified || original.changed !== entry.changed)) fail("profile-draft-abort-membership-changed");
    }
    for (const database of profileAuthorityFileWitnesses(root)) if (database.file !== undefined
      && canonicalJsonStringify(database) !== canonicalJsonStringify(capture.databases.find(file => file.suffix === database.suffix))) fail("profile-draft-abort-database-changed");
    if (lstatMaybe(join(root, "credentials", "protected.json")) || lstatMaybe(join(root, "credentials", "chatgpt-account.json"))) fail("profile-draft-abort-credentials-remain");
  }
  return () => {
    if (rootPresent) { rmSync(root, { recursive: true }); fsyncPath(dirname(root)); }
    if (operationPresent) { unlinkSync(operationPath); fsyncPath(dirname(operationPath)); }
    atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document, prior.completedRestores));
    unlinkSync(join(control, "profile-publication.json")); fsyncPath(control);
  };
}

function assertErasureMembership(document: ProfileRegistryDocument, heads: readonly z.infer<typeof ProfileErasureHeadSchema>[]): void {
  if (heads.length !== document.profiles.length || new Set(heads.map(row => row.profileId)).size !== heads.length
    || heads.some(head => !document.profiles.some(row => row.profileId === head.profileId && row.registration.operationId === head.originOperationId))) fail("profile-erasure-membership-mismatch");
}

const PROFILE_REGISTRY_PROOF = "profile-registry";
export const PROFILE_CUSTODY_PROOF = "profile-custody";
function profileRegistryProofKey(control: string, locator: RuntimeLocator): string {
  return `${PROFILE_REGISTRY_PROOF}\0${control}\0${locator.installationId}\0${String(locator.generation)}\0${locator.stateRoot}`;
}
class ProfileRegistryProof {
  constructor(readonly paths: readonly string[], readonly witness: string, readonly document: ProfileRegistryDocument, readonly assertUnchanged: () => void) {}
}
function captureProfileRegistryWitness(control: string, locator: RuntimeLocator) {
  const machine = join(locator.stateRoot, "machine");
  const operations = join(machine, "operations");
  const receipts = join(control, RECEIPTS);
  const directories = [operations, receipts, join(machine, "erasures"), join(machine, "credential-keys"), join(machine, "duo-credentials")];
  const roots = [control, locator.stateRoot, locator.artifactRoot, machine, ...directories];
  for (const directory of roots) assertNoSymlinkComponents(directory);
  const membership = profileRegistryStatWitness(control, locator, directories);
  const paths = [...profileEvidencePaths(control, locator), ...roots,
    ...["profile-publication.json", "journal.json", "profile-control-upgrade.json", "device-recertification.json"].map(name => join(control, name)),
    join(locator.stateRoot, FENCE), join(locator.artifactRoot, FENCE),
    ...directories.flatMap(directory => lstatMaybe(directory) === undefined ? [] : readdirSync(directory).sort().map(name => join(directory, name)))];
  const witness = profileRegistryStatWitness(control, locator, paths);
  if (membership !== profileRegistryStatWitness(control, locator, directories)) fail("profile-registry-observation-changed");
  return { paths, witness };
}
function profileRegistryStatWitness(control: string, locator: RuntimeLocator, paths: readonly string[]): string {
  for (const directory of [control, locator.stateRoot, locator.artifactRoot]) assertNoSymlinkComponents(directory);
  return paths.map(path => {
    const stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    // Peer mutex turnover changes control membership without changing registry evidence.
    if (stat !== undefined && path === control) return [stat.dev, stat.ino, stat.mode, stat.uid].join(":");
    return stat === undefined ? "absent" : [stat.dev, stat.ino, stat.mode, stat.uid, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(":");
  }).join("|");
}
function provenProfileRegistry(control: string, locator: RuntimeLocator): ProfileRegistryDocument | undefined {
  const proof = outermostOperationProof()?.witnesses.get(profileRegistryProofKey(control, locator));
  return proof instanceof ProfileRegistryProof
    && proof.witness === profileRegistryStatWitness(control, locator, proof.paths) ? proof.document : undefined;
}
function rememberProfileRegistry(control: string, locator: RuntimeLocator, paths: readonly string[], witness: string, document: ProfileRegistryDocument): void {
  const proof = outermostOperationProof(), key = profileRegistryProofKey(control, locator);
  // Relocated installations revalidate their retained source roots.
  if (proof === undefined || locator.generation !== 0 || proof.witnesses.has(key)) return;
  proof.witnesses.set(key, new ProfileRegistryProof(paths, witness, document, () => {
    if (witness !== profileRegistryStatWitness(control, locator, paths)) {
      readProfileEvidence(join(locator.stateRoot, "machine", "profiles.json"), ProfileRegistryDocumentSchema);
      fail("profile-registry-observation-changed");
    }
  }));
}
function dropProfileRegistryProof(control: string, locator: RuntimeLocator): void {
  const proof = outermostOperationProof();
  proof?.witnesses.delete(profileRegistryProofKey(control, locator));
  proof?.slots.delete(PROFILE_CUSTODY_PROOF);
}

function profileEvidencePaths(control: string, locator: RuntimeLocator): readonly string[] {
  const machine = join(locator.stateRoot, "machine");
  return [join(control, "installation.json"), join(control, "locator.json"), join(control, "profile-registry.json"),
    markerPath(locator.stateRoot), markerPath(locator.artifactRoot), join(machine, "profiles.json"),
    join(machine, "profile-registry-version.json"), join(machine, "profile-verifiers.json"), join(machine, "profile-pepper")];
}

function profileObservation(control: string, locator: RuntimeLocator): string {
  const operations = profileOperationInventory(locator.stateRoot);
  const files = profileEvidencePaths(control, locator).map(path => {
    assertNoSymlinkComponents(path);
    const file = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined) fail("profile-registry-evidence-missing");
    return { path, device: file.identity.device, inode: file.identity.inode,
      digest: createHash("sha256").update(file.bytes).digest("hex") };
  });
  return canonicalJsonStringify({ files, operations });
}

function readProfileUpgradeAuthority(control: string, workspace: string, locator: RuntimeLocator, id: string, assertHeld: () => void): string {
  assertHeld();
  if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-stopped-upgrade-locator-changed");
  const before = profileObservation(control, locator);
  const document = readMachineRegistry(control, locator, false);
  const row = document.profiles.find(entry => entry.profileId === id);
  if (row?.lifecycle !== "ready" || row.credentialState !== "saved") fail("profile-stopped-upgrade-ready-required");
  const key = join(locator.stateRoot, "machine", "credential-keys", `${id}.json`);
  const headFile = readPrivateFile(key, { label: "lock", maxBytes: 25 * 1024 * 1024 });
  if (headFile === undefined) fail("profile-stopped-upgrade-key-required");
  const head = CanonicalCredentialHeadSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(headFile.bytes)));
  if (head.state !== "active" || head.installationId !== locator.installationId || head.profileId !== id
    || head.key.installationId !== head.installationId || head.key.profileId !== head.profileId) fail("profile-stopped-upgrade-key-required");
  credentialKeyCustody.read(head.key);
  const pending = join(locator.stateRoot, "machine", "credential-operations", `${id}.json`);
  if (lstatMaybe(pending)) fail("profile-stopped-upgrade-credential-operation-pending");
  const files = [key, join(locator.stateRoot, "profiles", id, "credentials", "protected.json"),
    join(locator.stateRoot, "profiles", id, "credentials", "chatgpt-account.json"), join(locator.stateRoot, "machine", "duo-credentials", `${id}.json`)].map(path => {
      const file = readPrivateFile(path, { label: "protected.json", maxBytes: 25 * 1024 * 1024 });
      if (file === undefined) fail("profile-stopped-upgrade-evidence-required");
      return { path, identity: file.identity, digest: createHash("sha256").update(file.bytes).digest("hex") };
    });
  if (profileObservation(control, locator) !== before || lstatMaybe(join(control, "profile-publication.json"))) fail("profile-stopped-upgrade-observation-changed");
  assertHeld();
  const directories = [control, join(locator.stateRoot, "machine"), join(locator.stateRoot, "machine", "credential-keys"),
    join(locator.stateRoot, "machine", "credential-operations"), join(locator.stateRoot, "machine", "operations")].map(path => {
      privateDirectory(path);
      const info = lstatSync(path);
      return { path, device: info.dev, inode: info.ino, mode: info.mode, owner: info.uid };
    });
  return canonicalJsonStringify({ document, observation: before, files, directories });
}

function initializeMachineRegistry(control: string, locator: RuntimeLocator): void {
  const directory = join(locator.stateRoot, "machine");
  if (!lstatMaybe(directory)) { mkdirSync(directory, { mode: 0o700 }); fsyncPath(locator.stateRoot); }
  privateDirectory(directory);
  const allowed = ["profile-registry-version.json", "profiles.json", "profile-verifiers.json", "profile-pepper"];
  if (readdirSync(directory).some(name => !allowed.includes(name))) fail("profile-machine-initialization-membership-refused");
  const publish = (path: string, value: unknown) => {
    if (!lstatMaybe(path)) atomicJson(path, value);
    else if (canonicalJsonStringify(readStrict(path, z.unknown())) !== canonicalJsonStringify(value)) fail("profile-machine-initialization-changed");
  };
  const document = ProfileRegistryDocumentSchema.parse({ schemaVersion: 3, installationId: locator.installationId, revision: 0, profiles: [], activeProfileId: null, sessionGeneration: 0 });
  publish(join(directory, "profile-registry-version.json"), { schemaVersion: 6 });
  publish(join(directory, "profiles.json"), document);
  publish(join(directory, "profile-verifiers.json"), { schemaVersion: 1, profiles: [] });
  const pepperPath = join(directory, "profile-pepper");
  if (!lstatMaybe(pepperPath)) writeFileSync(pepperPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  const pepper = readPrivateFile(pepperPath, { label: "lock", maxBytes: 32 });
  if (pepper?.bytes.length !== 32) fail("profile-machine-pepper-invalid");
  fsyncPath(pepperPath); fsyncPath(directory);
  publish(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(directory, "profiles.json"), document, []));
}

function adopt(control: string, workspace: string, defaultPair: RuntimePair, verifier?: AuthorityVerifier,
  initializeFresh?: FreshInitializer, machine = false): RuntimeLocator {
  const pair = Object.freeze({ stateRoot: defaultPair.stateRoot, artifactRoot: defaultPair.artifactRoot });
  assertKnownDefaults(workspace, pair);
  preflightPair(pair);
  if (existsSync(join(control, "installation.json")) || existsSync(join(control, "locator.json")) || existsSync(join(control, "journal.json"))) fail("incomplete adoption; offline recovery required");
  assertNoDefaultWitness(pair);
  const fresh = defaultEmpty(pair);
  if (!fresh && machine) fail("profile-stopped-conversion-required");
  if (fresh && !machine && (!verifier || !initializeFresh)) fail("fresh authority requires initializer and verifier");
  if (!fresh) {
    if (!verifier) fail("existing authority requires verifier");
    const evidence = verifier(Object.freeze({ ...pair }));
    if (evidence.kind !== "verified-existing" || evidence.pair.stateRoot !== pair.stateRoot || evidence.pair.artifactRoot !== pair.artifactRoot || !Number.isSafeInteger(evidence.authorityGeneration) || evidence.authorityGeneration < 0 || !evidence.databaseIdentity) fail("invalid authority evidence");
  }
  preflightPair(pair);
  assertNoDefaultWitness(pair);
  const installationId = randomUUID();
  atomicJson(join(control, "installation.json"), { schemaVersion: 1, installationId, workspace });
  atomicJson(join(control, "journal.json"), { schemaVersion: 1, phase: "adopting", installationId });
  installMarker(pair.stateRoot, installationId, workspace, "state", 0);
  installMarker(pair.artifactRoot, installationId, workspace, "artifact", 0);
  if (fresh && machine) {
    const processLockRoot = fixedLockRoot(workspace);
    assertNoSymlinkComponents(processLockRoot);
    mkdirSync(processLockRoot, { mode: 0o700 });
    privateDirectory(processLockRoot);
    fsyncPath(dirname(processLockRoot));
    initializeMachineRegistry(control, { schemaVersion: 1, installationId, generation: 0, ...pair });
  }
  if (fresh && !machine) {
    let active = true;
    const witness: FreshInitializationWitness = Object.freeze({ installationId, pair,
      assertHeld() {
        if (!active) fail("fresh initialization capability expired");
        const pending = readStrict(join(control, "journal.json"), JournalSchema);
        if (pending.phase !== "adopting" || pending.installationId !== installationId) fail("fresh initialization journal changed");
        if (readStrict(join(control, "installation.json"), InstallationSchema).installationId !== installationId) {
          fail("fresh initialization installation changed");
        }
        if (lstatMaybe(join(control, "locator.json"))) fail("fresh initialization locator already published");
        checkMarker(pair.stateRoot, installationId, workspace, "state", 0);
        checkMarker(pair.artifactRoot, installationId, workspace, "artifact", 0);
      },
    });
    try {
      const completed: unknown = initializeFresh!(witness);
      if (completed !== undefined) fail("fresh initializer must complete synchronously");
    }
    finally { active = false; }
    const database = lstatMaybe(join(pair.stateRoot, "state.db"));
    if (!database || !database.isFile() || database.isSymbolicLink() || database.nlink !== 1
      || privatePathRejects(join(pair.stateRoot, "state.db"), database, "group-write")) {
      fail("fresh authority database missing or unsafe");
    }
    const evidence = verifier!(Object.freeze({ ...pair }));
    if (evidence.kind !== "verified-existing" || evidence.pair.stateRoot !== pair.stateRoot
      || evidence.pair.artifactRoot !== pair.artifactRoot || !Number.isSafeInteger(evidence.authorityGeneration)
      || evidence.authorityGeneration < 0 || !evidence.databaseIdentity) fail("invalid fresh authority evidence");
  }
  const locator = { schemaVersion: 1 as const, installationId, generation: 0, ...pair };
  atomicJson(join(control, "locator.json"), locator);
  unlinkSync(join(control, "journal.json")); fsyncPath(control);
  return locator;
}
type RecoveryRequest = Readonly<{ installationId: string; fromGeneration: number; operationId: string; restoreAdmission: OfflineMaintenanceOperation }>;
export function inspectPendingRelocationStatus(workspacePath: string): Readonly<{
  operationId: string; phase: RelocationInventory["phase"]; fromGeneration: number;
}> | undefined {
  const workspace = realpathSync(workspacePath);
  if (resolve(workspacePath) !== workspace) fail("status workspace must be canonical");
  const control = join(workspace, CONTROL);
  assertNoSymlinkComponents(control);
  privateDirectory(control);
  const installation = readInstallation(control, workspace);
  if (!lstatMaybe(join(control, "journal.json"))) {
    readLocator(control, workspace);
    return undefined;
  }
  const pending = readStrict(join(control, "journal.json"), JournalSchema);
  if (pending.phase === "adopting" || pending.phase === "restoring" || pending.installationId !== installation.installationId) {
    fail("pending relocation status is not an owned relocation");
  }
  readLocator(control, workspace, { installationId: pending.installationId,
    fromGeneration: pending.fromGeneration, operationId: pending.operationId });
  return Object.freeze({ operationId: pending.operationId, phase: pending.phase,
    fromGeneration: pending.fromGeneration });
}
export function inspectPendingRelocationRecovery(workspacePath: string, operationId: string,
  restore: OfflineMaintenanceOperation): Readonly<{ installationId: string; fromGeneration: number; operationId: string }> {
  const workspace = realpathSync(workspacePath);
  if (resolve(workspacePath) !== workspace) fail("recovery workspace must be canonical");
  const control = join(workspace, CONTROL);
  assertNoSymlinkComponents(control);
  privateDirectory(control);
  assertRestoreHeld(workspace, restore);
  if (activeAdmissions(control).length !== 0) fail("installation lease busy during recovery inspection");
  const installation = readInstallation(control, workspace);
  const pending = readStrict(join(control, "journal.json"), JournalSchema);
  if (pending.phase === "adopting" || pending.phase === "restoring" || pending.operationId !== operationId
    || pending.installationId !== installation.installationId) fail("recovery operation binding mismatch");
  const binding = Object.freeze({ installationId: pending.installationId,
    fromGeneration: pending.fromGeneration, operationId: pending.operationId });
  readLocator(control, workspace, binding);
  return binding;
}
function preflightProfileFormats(control: string, workspace: string, stoppedForward: boolean): void {
  if (!lstatMaybe(join(control, "installation.json"))) return;
  const locator = rawLocator(control, workspace), machine = join(locator.stateRoot, "machine");
  const clean = join(control, "flat-start-clean.json");
  if (lstatMaybe(clean)) {
    const intent = readStrict(clean, FlatStartCleanIntentSchema);
    const backup = retainedStorageBackup(workspace, locator.installationId);
    if (intent.installationId !== locator.installationId || backup === undefined
      || canonicalJsonStringify(intent.backup) !== canonicalJsonStringify(backup)) fail("flat-start-clean-intent-changed");
    return;
  }
  if (!lstatMaybe(machine)) return;
  const operationDirectory = join(machine, "operations");
  if (lstatMaybe(operationDirectory) !== undefined) {
    assertNoSymlinkComponents(operationDirectory); privateDirectory(operationDirectory);
    for (const name of readdirSync(operationDirectory)) {
      if (!/^[0-9a-f-]{36}\.json$/u.test(name)) fail("profile-operation-identity-mismatch");
      const file = readPrivateFile(join(operationDirectory, name), { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined) fail("profile-operation-identity-mismatch");
      const version = z.looseObject({ schemaVersion: z.number().int(), kind: z.string(), phase: z.string() }).parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(file.bytes)));
      if (version.kind === "logout" && version.schemaVersion !== 2) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED", {
        cause: new Error(version.phase === "complete" ? "profile-control-upgrade-legacy-logout-completion-unproved" : "profile-control-upgrade-legacy-logout-epoch-unproved") });
    }
  }
  const marker = readProfileEvidence(join(machine, "profile-registry-version.json"), z.strictObject({ schemaVersion: z.number().int() }));
  const pending = join(control, "profile-control-upgrade.json");
  if (lstatMaybe(join(control, "device-recertification.json"))) fail("profile-control-upgrade-pending-conversion-unsupported");
  if (lstatMaybe(pending)) {
    if (!stoppedForward) fail("profile-control-upgrade-pending");
    for (const name of ["profile-publication.json", "journal.json"]) if (lstatMaybe(join(control, name))) fail("profile-control-upgrade-pending-conversion-unsupported");
    validateStoppedControlUpgrade(control, locator, readControlUpgradeReceipt(pending));
    return;
  }
  if (marker.schemaVersion === 6) {
    const document = readProfileEvidence(join(machine, "profiles.json"), ProfileRegistryDocumentSchema);
    const continuity = readProfileEvidence(join(control, "profile-registry.json"), ProfileContinuitySchema);
    if (document.installationId !== locator.installationId || continuity.installationId !== locator.installationId) fail("profile-registry-installation-mismatch");
    if (lstatMaybe(join(control, "profile-publication.json"))) {
      const file = readPrivateFile(join(control, "profile-publication.json"), { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined || !ProfilePublicationSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes))).success) fail("profile-control-upgrade-pending-conversion-unsupported");
    }
    if (lstatMaybe(join(control, "journal.json"))) {
      const file = readPrivateFile(join(control, "journal.json"), { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined || !JournalSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes))).success) fail("profile-control-upgrade-pending-conversion-unsupported");
    }
    if (!lstatMaybe(join(control, "profile-publication.json")) && !lstatMaybe(join(control, "journal.json"))
      && canonicalJsonStringify(profileRegistryWitness(locator.installationId, join(machine, "profiles.json"), document, continuity.completedRestores)) !== canonicalJsonStringify(continuity)) fail("profile-registry-continuity-mismatch");
    return;
  }
  if (!stoppedForward) fail("profile-control-upgrade-required");
  if (![2, 3, 4, 5].includes(marker.schemaVersion)) fail("profile-control-upgrade-pending-conversion-unsupported");
  for (const name of ["profile-publication.json", "journal.json"]) if (lstatMaybe(join(control, name))) fail("profile-control-upgrade-pending-conversion-unsupported");
  const prior = readProfileEvidence(join(control, "profile-registry.json"), StoppedProfileContinuitySchema);
  if (marker.schemaVersion !== prior.schemaVersion + 1) fail("profile-control-upgrade-prior-mismatch");
  assertPriorRegistryLogicalBinding(locator, prior, readProfileEvidence(join(machine, "profiles.json"), StoppedProfileRegistryDocumentSchema));
}

function assertStoppedLogoutMaintenance(lease: InstallationLease, operation: OfflineMaintenanceOperation): void {
  assertInstallationLease(lease);
  const lifetime = lease.lifetime, workspace = lease.readInstallationContext().workspace;
  if (!(lifetime instanceof RuntimeLifetimeLock)) fail("profile-logout-controller-required");
  lifetime.assertOfflineMaintenance(operation, workspace);
  if (!equalLocator(readLocator(join(workspace, CONTROL), workspace), lease.locator)) fail("profile-logout-locator-changed");
}

function logoutIdentity(operation: z.infer<typeof LogoutOperationSchema>): string {
  const { phase: _phase, settlement: _settlement, ...identity } = operation;
  return canonicalJsonStringify(identity);
}

export function acquireInstallation(workspacePath: string, mode: "shared", lifetime: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock, options?: { machine?: true; readonlyControl?: true }): InstallationLease;
export function acquireInstallation(workspacePath: string, mode: "exclusive", lifetime: RuntimeLifetimeLock, options?: { offlineOperation?: OfflineMaintenanceOperation; readonlyControl?: true; stoppedControlForward?: true; defaultPair?: RuntimePair; verifyExisting?: AuthorityVerifier; initializeFresh?: FreshInitializer; machine?: true; recoverRelocation?: RecoveryRequest; recoverAuthorityRestore?: { operationId: string; restoreAdmission: OfflineMaintenanceOperation } }): ExclusiveInstallationLease;
export function acquireInstallation(workspacePath: string, mode: "shared" | "exclusive", lifetime: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock, options?: { offlineOperation?: OfflineMaintenanceOperation; readonlyControl?: true; stoppedControlForward?: true; defaultPair?: RuntimePair; verifyExisting?: AuthorityVerifier; initializeFresh?: FreshInitializer; machine?: true; recoverRelocation?: RecoveryRequest; recoverAuthorityRestore?: { operationId: string; restoreAdmission: OfflineMaintenanceOperation } }): InstallationLease | ExclusiveInstallationLease {
  const workspace = realpathSync(workspacePath);
  if (!(lifetime instanceof RuntimeLifetimeLock) && !(lifetime instanceof WorkerRuntimeLifetimeLock)) fail("runtime-lifetime-required");
  lifetime.assertHeld();
  if (resolve(workspacePath) !== workspace) fail("installation workspace must be canonical");
  if ((mode === "exclusive" || options?.stoppedControlForward === true) && !(lifetime instanceof RuntimeLifetimeLock)) fail("exclusive-root-lifetime-required");
  if (options?.stoppedControlForward === true && mode !== "exclusive") fail("stopped-control-forward-exclusive-required");
  if (lifetime instanceof RuntimeLifetimeLock) {
    if (mode !== "exclusive" && options?.offlineOperation !== undefined) fail("offline-maintenance-exclusive-root-required");
    lifetime.assertAdmissionOperation(options?.offlineOperation, workspace);
    if (options?.offlineOperation !== undefined) assertNoOldBuildRuntimeArtifacts(workspace);
  }
  const coldLogoutObservations = new Map<string, string>();
  try { preflightProfileFormats(join(workspace, CONTROL), workspace, options?.stoppedControlForward === true); }
  catch (error) { lifetime.retainSourceClosure(error); throw error; }
  if (lifetime instanceof RuntimeLifetimeLock) lifetime.initializeWorkspace(workspace, () => {
    lifetime.assertStartupWorkspace(workspace);
    const control = join(workspace, CONTROL);
    if (lstatMaybe(control) === undefined) return;
    assertNoSymlinkComponents(control); privateDirectory(control);
    const removals: (() => void)[] = [];
    const controlLock = capturePriorPrivateFileLock(control, ".installation-mutation.lock");
    if (controlLock !== undefined) removals.push(controlLock);
    const installationPath = join(control, "installation.json");
    if (lstatMaybe(installationPath) !== undefined) {
      const priorLocator = rawLocator(control, workspace), machine = join(priorLocator.stateRoot, "machine");
      assertNoSymlinkComponents(machine);
      const marker = lstatMaybe(join(machine, "profile-registry-version.json")) === undefined ? undefined
        : readProfileEvidence(join(machine, "profile-registry-version.json"), z.strictObject({ schemaVersion: z.number().int() }));
      if (marker?.schemaVersion === 6) {
        readMachineRegistry(control, priorLocator, false);
        for (const entry of profileOperationInventory(priorLocator.stateRoot)) {
          const operation = readProfileEvidence(join(machine, "operations", `${entry.operationId}.json`), ProfileOperationSchema);
          if (operation.kind !== "logout" || operation.phase === "complete") continue;
          const source = lstatSync(join(priorLocator.stateRoot, "profiles", operation.profileId, "state.db"));
          if (!source.isFile() || source.nlink !== 1 || privatePathRejects(join(priorLocator.stateRoot, "profiles", operation.profileId, "state.db"), source, "owner")
            || source.dev !== operation.source.database.device || source.ino !== operation.source.database.inode) fail("profile-logout-native-source-changed");
          lifetime.assertStartupWorkspace(workspace);
          coldLogoutObservations.set(operation.operationId, logoutIdentity(operation));
        }
        removals.push(...captureCanonicalCredentialStartupLocks(lifetime, workspace, priorLocator.stateRoot, priorLocator.installationId));
      }
      for (const name of [".profile-ops.lock", ".profile-registry.lock"]) {
        if (lstatMaybe(join(machine, name)) === undefined) continue;
        if (!equalLocator(readLocator(control, workspace, options?.recoverRelocation, options?.recoverAuthorityRestore), priorLocator)) fail("profile-machine-authority-changed");
        const pending = lstatMaybe(join(control, "profile-publication.json")) === undefined ? undefined
          : readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema);
        if (pending?.kind === "onboarding-finish") {
          readProfilePublicationSource(control, priorLocator);
          assertOnboardingFinishPublicationDocument(priorLocator, pending);
        } else if (pending?.kind === "incomplete-profile-draft") {
          readProfilePublicationSource(control, priorLocator);
          prepareIncompleteProfileDraft(control, priorLocator, pending);
        } else if (pending?.kind === "draft-abort") {
          const source = readProfilePublicationSource(control, priorLocator);
          prepareUnpublishedDraftAbort(control, priorLocator, source.document, source.witness, pending);
        } else if (pending?.kind === "profile") {
          const source = readProfilePublicationSource(control, priorLocator);
          prepareProfileRegistryPublication(control, priorLocator, source.path, source.document, source.witness, pending);
        } else readMachineRegistry(control, priorLocator, false);
        const remove = capturePriorPrivateFileLock(machine, name);
        if (remove !== undefined) removals.push(remove);
      }
    }
    for (const remove of removals) { lifetime.assertStartupWorkspace(workspace); remove(); }
  });
  lifetime.assertWorkspace(workspace);
  if (mode === "exclusive") {
    if (!(lifetime instanceof RuntimeLifetimeLock)) fail("exclusive-root-lifetime-required");
    lifetime.assertExclusiveWorkspace(workspace);
  }
  const control = join(workspace, CONTROL);
  if (!existsSync(control)) {
    if (mode !== "exclusive" || !options?.defaultPair) fail("installation locator missing");
    assertKnownDefaults(workspace, options.defaultPair);
    preflightPair(options.defaultPair);
    assertNoDefaultWitness(options.defaultPair);
    if (defaultEmpty(options.defaultPair) && !options.machine && (!options.initializeFresh || !options.verifyExisting)) {
      fail("fresh authority requires initializer and verifier");
    }
    const parent = dirname(control);
    if (lstatMaybe(parent) === undefined) { mkdirSync(parent, { mode: 0o700 }); fsyncPath(workspace); }
    privateDirectory(parent);
    mkdirSync(control, { mode: 0o700 }); fsyncPath(parent);
  }
  privateDirectory(control);
  const localAdmission: LocalAdmission = Object.freeze({ mode });
  const sourceFailures = new Set<unknown>();
  const releaseExclusive = mode === "exclusive" && lifetime instanceof RuntimeLifetimeLock
    ? lifetime.retainExclusiveAdmission(workspace, options?.offlineOperation) : undefined;
  let resolvedLocator: RuntimeLocator;
  try { resolvedLocator = withInstallationControl(control, () => {
    const peers = activeAdmissions(control);
    if (peers.some((peer) => mode === "exclusive" || peer.mode === "exclusive")) fail("installation lease busy");
    if (options?.recoverRelocation) assertLocalRestoreHeld(options.recoverRelocation.restoreAdmission);
    const resolved = existsSync(join(control, "installation.json")) ? readLocator(control, workspace, mode === "exclusive" ? options?.recoverRelocation : undefined, mode === "exclusive" ? options?.recoverAuthorityRestore : undefined) : (mode === "exclusive" && options?.defaultPair ? adopt(control, workspace, options.defaultPair, options.verifyExisting, options.initializeFresh, options.machine) : fail("installation locator missing"));
    if (options?.machine === true) readMachineRegistry(control, resolved, options.readonlyControl !== true);
    return resolved;
  }); } catch (error) {
    const pending: unknown[] = [error], seen = new Set<unknown>();
    let closureUnproved = false;
    while (pending.length > 0) {
      const failure = pending.pop();
      if (seen.has(failure)) continue;
      seen.add(failure);
      if (failure instanceof AuthoritySourceClosureUnprovedError) closureUnproved = true;
      if (failure instanceof AggregateError) { const errors: readonly unknown[] = failure.errors; pending.push(...errors); }
      if (failure instanceof Error && failure.cause !== undefined) pending.push(failure.cause);
    }
    if (closureUnproved) lifetime.retainSourceClosure(error);
    else releaseExclusive?.();
    throw error;
  }
  const admissions = installationAdmissions.get(control) ?? new Set<LocalAdmission>();
  admissions.add(localAdmission);
  installationAdmissions.set(control, admissions);
  const locator = Object.freeze({ ...resolvedLocator });
  const publicLocator = Object.freeze({ ...locator });
  let released = false;
  let offlineOperation: OfflineMaintenanceOperation | undefined = options?.offlineOperation;
  function assertLocalRestoreHeld(operation: OfflineMaintenanceOperation | undefined): void {
    assertRestoreHeld(workspace, operation);
    if (!(lifetime instanceof RuntimeLifetimeLock) || operation === undefined) fail("offline-maintenance-exclusive-root-required");
    lifetime.assertOfflineMaintenance(operation, workspace);
  }
  function assertHeld(): void {
    lifetime.assertWorkspace(workspace);
    if (mode === "exclusive") {
      if (!(lifetime instanceof RuntimeLifetimeLock)) fail("exclusive-root-lifetime-required");
      lifetime.assertExclusiveWorkspace(workspace);
    }
    if (released) fail("installation lease released");
    if (!admissions.has(localAdmission)) fail("installation admission released");
  }
  function mutate<T>(callback: (held: PrivateFileLock) => T): T {
    assertHeld();
    if (options?.readonlyControl === true) fail("worker-machine-control-read-only");
    outermostOperationProof()?.slots.delete("symlink-free");
    dropProfileRegistryProof(control, locator);
    try { return withInstallationControl(control, callback); }
    catch (error) {
      if (rememberUnprovedSourceClosure(sourceFailures, error)) lifetime.retainSourceClosure(error);
      throw error;
    }
    finally { dropProfileRegistryProof(control, locator); }
  }
  function publishOperation(input: ProfileOperation | string, creating: boolean): void {
    mutate(held => {
      const current = () => { assertHeld(); lifetime.assertRuntimeAvailable(); held.assertHeld(); };
      current();
      if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-machine-authority-changed");
      const document = readMachineRegistry(control, locator);
      if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-publication-pending");
      const directory = join(locator.stateRoot, "machine", "operations");
      if (typeof input !== "string") {
        const path = join(directory, `${input.operationId}.json`);
        if (!lstatMaybe(path)) {
          if (input.kind === "sign-up" && !creating) fail("profile-signup-intent-unissued");
          if (input.kind === "logout" && !document.profiles.some(row => row.profileId === input.profileId)) fail("profile-logout-unregistered");
        } else {
          const before = readStrict(path, ProfileOperationSchema);
          if (before.kind !== input.kind || before.profileId !== input.profileId) fail("profile-operation-identity-mismatch");
          if (before.kind === "sign-up" && input.kind === "sign-up") {
            const stable = (operation: z.infer<typeof SignUpOperationSchema>) => ({ operationId: operation.operationId, profileId: operation.profileId,
              commandId: operation.commandId, writeId: operation.writeId, emailKey: operation.emailKey, firstName: operation.firstName,
              lastName: operation.lastName, createdAt: operation.createdAt, commandFingerprint: operation.commandFingerprint,
              credentials: { operationId: operation.credentials.operationId, keyId: operation.credentials.keyId, generation: operation.credentials.generation } });
            if (canonicalJsonStringify(stable(before)) !== canonicalJsonStringify(stable(input))
              || before.expectedRevision !== undefined && before.expectedRevision !== input.expectedRevision
              || before.credentials.phase === "ready" && (input.credentials.phase !== "ready" || input.credentials.protectedRevision !== before.credentials.protectedRevision)
              || before.onboarding?.abort !== undefined && canonicalJsonStringify(input.onboarding?.abort) !== canonicalJsonStringify(before.onboarding.abort)
              || before.onboarding?.finish !== undefined && canonicalJsonStringify(input.onboarding?.finish) !== canonicalJsonStringify(before.onboarding.finish)) fail("profile-signup-intent-changed");
          }
        }
      }
      const operation = typeof input === "string" ? { kind: "delete" as const, operationId: z.uuid().parse(input) }
        : { kind: "write" as const, operation: ProfileOperationSchema.parse(input) };
      const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
      current(); atomicJson(join(control, "profile-publication.json"), { kind: "profile", schemaVersion: 1, installationId: locator.installationId, prior, document, operation });
      if (!lstatMaybe(directory)) { current(); mkdirSync(directory, { mode: 0o700 }); fsyncPath(dirname(directory)); }
      privateDirectory(directory);
      const id = operation.kind === "write" ? operation.operation.operationId : operation.operationId, path = join(directory, `${id}.json`);
      current();
      if (operation.kind === "write") atomicJson(path, operation.operation);
      else if (lstatMaybe(path)) { privateFile(path); unlinkSync(path); fsyncPath(directory); }
      current(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document, prior.completedRestores));
      current(); unlinkSync(join(control, "profile-publication.json")); fsyncPath(control);
    });
  }

  function publishRegistry(expected: ProfileRegistryDocument | undefined, document: ProfileRegistryDocument | undefined,
    registration?: { operation: z.infer<typeof SignUpOperationSchema>; profile: RuntimeAdmission; lease: InstallationLease }): void {
    mutate(held => {
      const current = () => { assertHeld(); lifetime.assertRuntimeAvailable(); held.assertHeld(); };
      current();
      if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-machine-authority-changed");
      const before = readMachineRegistry(control, locator), intentPath = join(control, "profile-publication.json");
      if (registration !== undefined) {
        const { operation } = registration, scope = new ActiveProfilePublicationRead(control, workspace, locator, operation.operationId, held, current);
        try {
          const inspect = () => { current(); return requireRuntimeAdmission(registration.profile, scope).readProfileRegistration(registration.lease, operation, scope); };
          const captured = inspect();
          if (lstatMaybe(intentPath)) {
            const pending = readStrict(intentPath, ProfilePublicationSchema);
            if (pending.kind !== "onboarding-finish" || canonicalJsonStringify(pending.operation) !== canonicalJsonStringify(operation)) fail("profile-onboarding-finish-pending");
            const revalidate = () => {
              const next = inspect();
              if (next.revision !== captured.revision || canonicalJsonStringify(next.credentials) !== canonicalJsonStringify(pending.credentials)) fail("profile-onboarding-finish-source-changed");
              const pepper = readPrivateFile(join(locator.stateRoot, "machine", "profile-pepper"), { label: "lock", maxBytes: 32 }),
                verifier = pending.verifiers.profiles.find(row => row.profileId === operation.profileId);
              if (pepper === undefined || verifier === undefined || emailKey(pepper.bytes, next.email) !== operation.emailKey
                || !passwordMatches(next.password, verifier)) fail("profile-onboarding-finish-verifier-changed");
            };
            revalidate(); prepareProfileOnboardingFinish(control, locator, pending, revalidate)(); return;
          }
          if (before.profiles.some(row => row.profileId === operation.profileId)) {
            const row = before.profiles.find(row => row.profileId === operation.profileId);
            if (row?.registration.operationId !== operation.operationId || row.registration.commandId !== operation.commandId
              || row.registration.writeId !== operation.writeId || row.registration.credentialRevision !== captured.revision
              || canonicalJsonStringify(row.registration.onboardingCompletion) !== canonicalJsonStringify(profileOnboardingCompletion(operation))) fail("profile-signup-intent-mismatch");
            return;
          }
          const verifierOwner = createProfileVerifiers(locator.stateRoot), prepared = verifierOwner.prepare(operation.profileId, captured.email, captured.password),
            verifier = verifyPreparedProfileVerifier(prepared, locator.stateRoot, operation.profileId, operation.emailKey),
            verifierPath = join(locator.stateRoot, "machine", "profile-verifiers.json"), priorVerifiers = readStrict(verifierPath, ProfileVerifierDocumentSchema);
          if (priorVerifiers.profiles.some(row => row.profileId === operation.profileId || row.emailKey === operation.emailKey)) fail("profile-onboarding-verifier-binding-invalid");
          const row = ProfileRegistryRowSchema.parse({ profileId: operation.profileId, ...deriveProfileNames(operation.firstName, operation.lastName),
            registration: { operationId: operation.operationId, commandId: operation.commandId, writeId: operation.writeId,
              credentialRevision: captured.revision, onboardingCompletion: profileOnboardingCompletion(operation) },
            createdAt: operation.createdAt, lastSignedInAt: operation.createdAt, credentialState: "saved", duoState: "ready", lifecycle: "ready" }),
            next = advanceProfileRegistryDocument(before, { profiles: [...before.profiles, row] }),
            prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema), root = join(locator.stateRoot, "profiles", operation.profileId);
          const intent = ProfilePublicationSchema.parse({ kind: "onboarding-finish", schemaVersion: 1, installationId: locator.installationId,
            prior, operation, priorDocument: before, document: next, priorVerifiers, verifiers: { ...priorVerifiers, profiles: [...priorVerifiers.profiles, verifier] },
            credentials: captured.credentials, pepper: preparedProfileVerifierPepperWitness(prepared, locator.stateRoot, operation.profileId, operation.emailKey), databases: profileAuthorityFileWitnesses(root) });
          if (intent.kind !== "onboarding-finish") fail("profile-onboarding-finish-invalid");
          const revalidate = () => {
            const next = inspect();
            if (next.revision !== captured.revision || canonicalJsonStringify(next.credentials) !== canonicalJsonStringify(captured.credentials)) fail("profile-onboarding-finish-source-changed");
            const pepper = readPrivateFile(join(locator.stateRoot, "machine", "profile-pepper"), { label: "lock", maxBytes: 32 });
            if (pepper === undefined || emailKey(pepper.bytes, next.email) !== operation.emailKey || !passwordMatches(next.password, verifier)) fail("profile-onboarding-finish-verifier-changed");
          };
          revalidate(); verifyPreparedProfileVerifier(prepared, locator.stateRoot, operation.profileId, operation.emailKey);
          current(); atomicJson(intentPath, intent);
          prepareProfileOnboardingFinish(control, locator, intent, revalidate)();
          return;
        } finally { scope.expire(); }
      }
      if (lstatMaybe(intentPath)) fail("profile-publication-pending");
      const next = ProfileRegistryDocumentSchema.parse(document);
      if (next.profiles.length !== before.profiles.length || next.profiles.some(row => {
        const original = before.profiles.find(prior => prior.profileId === row.profileId);
        return original === undefined || canonicalJsonStringify({ ...row, lifecycle: original.lifecycle, lastSignedInAt: original.lastSignedInAt }) !== canonicalJsonStringify(original);
      })) fail("profile-registry-registration-required");
      if (expected !== undefined && canonicalJsonStringify(before) !== canonicalJsonStringify(expected)
        || next.installationId !== before.installationId || next.revision !== before.revision + 1 || next.sessionGeneration < before.sessionGeneration) fail("profile-registry-publication-conflict");
      const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
      current(); atomicJson(intentPath, { kind: "profile", schemaVersion: 1, installationId: locator.installationId, prior, document: next });
      const path = join(locator.stateRoot, "machine", "profiles.json");
      current(); atomicJson(path, next);
      current(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, path, next, prior.completedRestores));
      current(); unlinkSync(intentPath); fsyncPath(control);
    });
  }

  function reclassifyDraft(profile: RuntimeAdmission, owner: InstallationLease): void {
    mutate(() => {
      assertHeld();
      if (mode !== "exclusive") fail("profile-incomplete-stopped-authority-required");
      const before = readMachineRegistry(control, locator), capture = requireRuntimeAdmission(profile).readIncompleteProfileRegistration(owner);
      const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
      const priorVerifiers = readProfileEvidence(join(locator.stateRoot, "machine", "profile-verifiers.json"), ProfileVerifierDocumentSchema);
      const intent = ProfilePublicationSchema.parse({ kind: "incomplete-profile-draft", schemaVersion: 1, installationId: locator.installationId, prior, capture,
        priorDocument: before, document: advanceProfileRegistryDocument(before, { profiles: before.profiles.filter(row => row.profileId !== capture.operation.profileId), activeProfileId: before.activeProfileId === capture.operation.profileId ? null : before.activeProfileId,
          sessionGeneration: before.sessionGeneration + 1 }), priorVerifiers,
        verifiers: { ...priorVerifiers, profiles: priorVerifiers.profiles.filter(row => row.profileId !== capture.operation.profileId) } });
      if (intent.kind !== "incomplete-profile-draft") fail("profile-incomplete-reclassification-invalid");
      if (canonicalJsonStringify(profile.readIncompleteProfileRegistration(owner, capture.operation)) !== canonicalJsonStringify(capture)) fail("profile-incomplete-source-changed");
      atomicJson(join(control, "profile-publication.json"), intent);
      prepareIncompleteProfileDraft(control, locator, intent)();
      readMachineRegistry(control, locator, false); assertHeld();
    });
  }
  const shared = Object.freeze({
    retainSourceClosure(error: unknown): void {
      if (rememberUnprovedSourceClosure(sourceFailures, error)) lifetime.retainSourceClosure(error);
    },
    lifetime,
    mode,
    locator: publicLocator,
    assertHeld,
    readCompletedRestores(profileId: string): readonly CompletedRestoreCustody[] {
      assertHeld();
      if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-machine-authority-changed");
      const before = profileObservation(control, locator);
      const publicationPath = join(control, "profile-publication.json");
      const publication = () => lstatMaybe(publicationPath) ? controlUpgradeFile(publicationPath) : null;
      const beforePublication = canonicalJsonStringify(publication());
      readMachineRegistry(control, locator, false);
      const id = z.uuid().parse(profileId), continuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
      if (continuity.installationId !== locator.installationId) fail("completed-restore-installation-mismatch");
      const rows = continuity.completedRestores.filter(row => row.profile.profileId === id).map(row => {
        assertCompletedRestoreCustody(locator, row);
        return CompletedRestoreCustodySchema.parse(row);
      });
      assertHeld();
      if (before !== profileObservation(control, locator) || beforePublication !== canonicalJsonStringify(publication())
        || !equalLocator(readLocator(control, workspace), locator)) fail("completed-restore-observation-changed");
      return rows;
    },
    beginOfflineMaintenance(): OfflineMaintenanceOperation {
      assertHeld();
      if (mode !== "exclusive" || !(lifetime instanceof RuntimeLifetimeLock)) fail("offline-maintenance-exclusive-root-required");
      if (offlineOperation !== undefined && isOfflineMaintenanceOperationActive(offlineOperation)) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-busy");
      offlineOperation = lifetime.beginOfflineMaintenance(workspace);
      return offlineOperation;
    },
    offlineMaintenanceOperation(): OfflineMaintenanceOperation {
      assertHeld();
      if (offlineOperation === undefined) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-unissued");
      assertOfflineMaintenanceOperation(offlineOperation, workspace);
      return offlineOperation;
    },
    assertOfflineMaintenance(operation: OfflineMaintenanceOperation) {
      assertHeld();
      if (offlineOperation !== operation) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-unissued");
      assertOfflineMaintenanceOperation(operation, workspace);
    },
    assertFixedProcessLockRoot(workspaceRoot: string, processLockRoot: string) {
      assertHeld();
      if (resolve(workspaceRoot) !== workspace || realpathSync(workspaceRoot) !== workspace
        || processLockRoot !== fixedLockRoot(workspace)) fail("fixed process lock root does not match installation");
      assertNoSymlinkComponents(processLockRoot);
      privateDirectory(processLockRoot);
      if (readInstallation(control, workspace).installationId !== locator.installationId) {
        fail("fixed process lock installation changed");
      }
    },
    readRelocationReceipts() {
      assertHeld();
      const pendingPath = join(control, "journal.json");
      if (lstatMaybe(pendingPath)) {
        const pending = readStrict(pendingPath, JournalSchema);
        if (pending.phase !== "restoring" || mode !== "exclusive"
          || pending.installationId !== locator.installationId
          || canonicalJsonStringify(pending.source) !== canonicalJsonStringify(locator)) fail("pending relocation has no settled receipt chain");
        return readReceiptChain(control, workspace, locator.installationId);
      }
      const current = readLocator(control, workspace);
      if (canonicalJsonStringify(current) !== canonicalJsonStringify(locator)) fail("admitted locator changed; reacquire lease");
      return readReceiptChain(control, workspace, locator.installationId);
    },
    requiresFlatStoreMigration() {
      assertHeld();
      if (!equalLocator(readLocator(control, workspace), locator)) fail("existing-data-owner-source-changed");
      if (lstatMaybe(join(control, "flat-start-clean.json"))) return true;
      const machine = lstatMaybe(join(locator.stateRoot, "machine")), continuity = lstatMaybe(join(control, "profile-registry.json"));
      if (machine !== undefined || continuity !== undefined) {
        readMachineRegistry(control, locator);
        if (lstatMaybe(join(locator.stateRoot, "state.db"))) fail("existing-data-source-ambiguous");
        return false;
      }
      if (lstatMaybe(join(locator.stateRoot, "profiles"))) fail("existing-data-source-ambiguous");
      if (readPrivateFile(join(locator.stateRoot, "state.db"), { label: "authority database", maxBytes: 512 * 1024 * 1024 }) === undefined) fail("existing-data-source-required");
      return true;
    },
    flatStoreMigrationPending() { assertHeld(); return lstatMaybe(join(control, "flat-start-clean.json")) !== undefined; },
    eraseFlatStoreCredentials(restore: OfflineMaintenanceOperation) {
      return mutate(() => {
      assertStoppedMachineMaintenance(this, restore);
      if (!this.requiresFlatStoreMigration() || this.flatStoreMigrationPending()) fail("flat-start-clean-source-required");
      const credentials = join(locator.stateRoot, "credentials");
      if (lstatMaybe(credentials)) {
        noSymlinkAncestry(credentials, new Map());
        unpublishedDraftAbortMembership(credentials);
        rmSync(credentials, { recursive: true }); fsyncPath(locator.stateRoot);
      }
      });
    },
    startCleanFlatStore(restore: OfflineMaintenanceOperation) {
      return mutate(() => {
      assertStoppedMachineMaintenance(this, restore);
      assertHeld();
      const reference = retainedStorageBackup(workspace, locator.installationId);
      if (reference === undefined) fail("flat-start-clean-backup-required");
      const backup = StorageBackupSchema.parse(JSON.parse(backupFile(reference.backupPath).bytes.toString("utf8")));
      if (backup.files.some(entry => entry.path === "profile/credentials" || entry.path.startsWith("profile/credentials/"))) fail("flat-start-clean-backup-credentials-refused");
      const intentPath = join(control, "flat-start-clean.json");
      const intent = { schemaVersion: 1 as const, installationId: locator.installationId, backup: reference };
      if (lstatMaybe(intentPath)) {
        const prior = readStrict(intentPath, FlatStartCleanIntentSchema);
        if (canonicalJsonStringify(prior) !== canonicalJsonStringify(intent)) fail("flat-start-clean-intent-changed");
      } else atomicJson(intentPath, intent);
      const source = SourceRecordSchema.parse(JSON.parse(backupFile(join(dirname(reference.backupPath), "source.json")).bytes.toString("utf8")));
      const sourceFiles = [...backup.files, ...source.databases.flatMap(database => database.file === undefined ? []
        : [{ ...database.file, path: `profile/state.db${database.suffix}` }])];
      const excluded = new Set([".runtime-owner.json", "locks", "machine"]);
      const observed = backupFileInventory(locator.stateRoot, "profile", excluded).filter(entry => entry.file.path !== "profile/artifacts/.runtime-owner.json");
      for (const entry of observed) {
        const saved = sourceFiles.find(file => file.path === entry.file.path);
        if (saved === undefined || saved.device !== entry.file.device || saved.inode !== entry.file.inode || saved.digest !== entry.file.digest) fail("flat-start-clean-source-changed");
      }
      for (const entry of observed) { unlinkSync(entry.path); fsyncPath(dirname(entry.path)); }
      const removeEmpty = (directory: string) => {
        for (const name of readdirSync(directory)) {
          if (directory === locator.stateRoot && excluded.has(name) || directory === locator.artifactRoot && name === ".runtime-owner.json") continue;
          const child = join(directory, name), info = lstatSync(child);
          if (!info.isDirectory() || info.isSymbolicLink()) fail("flat-start-clean-membership-changed");
          removeEmpty(child);
          if (child !== locator.artifactRoot) { rmdirSync(child); fsyncPath(directory); }
        }
      };
      removeEmpty(locator.stateRoot);
      initializeMachineRegistry(control, locator);
      readMachineRegistry(control, locator, false);
      unlinkSync(intentPath); fsyncPath(control);
      });
    },
    readProfileRegistry() {
      assertHeld();
      if (options?.stoppedControlForward === true
        && readProfileEvidence(join(locator.stateRoot, "machine", "profile-registry-version.json"), z.strictObject({ schemaVersion: z.number().int() })).schemaVersion === 5) {
        if (lstatMaybe(join(control, "profile-publication.json")) || lstatMaybe(join(control, "profile-control-upgrade.json"))) fail("profile-registry-publication-pending");
        const before = profileObservation(control, locator);
        const prior = readProfileEvidence(join(control, "profile-registry.json"), StoppedLogicalProfileContinuitySchema);
        const document = readProfileEvidence(join(locator.stateRoot, "machine", "profiles.json"), ProfileRegistryDocumentSchema);
        priorControlUpgradeEvidence(locator, prior, document);
        assertHeld();
        if (before !== profileObservation(control, locator)) fail("profile-registry-observation-changed");
        return document;
      }
      if (lstatMaybe(join(control, "profile-publication.json"))) {
        if (options?.readonlyControl === true) return readMachineRegistry(control, locator, false);
        return mutate(() => {
          assertHeld();
          if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-machine-authority-changed");
          return readMachineRegistry(control, locator);
        });
      }
      return withOperationProof(() => {
        const proven = provenProfileRegistry(control, locator);
        if (proven !== undefined) return proven;
        const { paths, witness } = captureProfileRegistryWitness(control, locator);
        if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-machine-authority-changed");
        const document = readMachineRegistry(control, locator, false);
        assertHeld();
        outermostOperationProof()?.slots.delete("symlink-free");
        if (witness !== profileRegistryStatWitness(control, locator, paths)
          || lstatMaybe(join(control, "profile-publication.json"))) fail("profile-registry-observation-changed");
        if (locator.generation !== 0 && !equalLocator(readLocator(control, workspace), locator)) fail("profile-machine-authority-changed");
        rememberProfileRegistry(control, locator, paths, witness, document);
        return document;
      });
    },
    reclassifyIncompleteProfile(profile: RuntimeAdmission) { reclassifyDraft(profile, this); },
    resumeIncompleteProfileDraft(profileId: string, restore: OfflineMaintenanceOperation): boolean {
      return mutate(() => {
        assertStoppedMachineMaintenance(this, restore);
        const path = join(control, "profile-publication.json");
        if (lstatMaybe(path) === undefined) return false;
        const intent = readStrict(path, ProfilePublicationSchema);
        if (intent.kind !== "incomplete-profile-draft" || intent.capture.operation.profileId !== z.uuid().parse(profileId)) fail("profile-incomplete-publication-owner-mismatch");
        prepareIncompleteProfileDraft(control, locator, intent)();
        readMachineRegistry(control, locator, false); assertHeld();
        return true;
      });
    },
    abortUnpublishedProfile(input: z.infer<typeof SignUpOperationSchema>, head?: z.infer<typeof CanonicalCredentialPublicationSourceSchema.shape.head>) {
      return mutate(() => {
        assertHeld(); lifetime.assertRuntimeAvailable();
        if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-draft-abort-machine-changed");
        const operation = SignUpOperationSchema.parse(input), document = readMachineRegistry(control, locator), intentPath = join(control, "profile-publication.json"),
          prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        let intent = lstatMaybe(intentPath) ? readStrict(intentPath, ProfilePublicationSchema) : undefined;
        if (intent === undefined) {
          if (head === undefined) {
            const original = readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`), SignUpOperationSchema);
            if (canonicalJsonStringify(original) !== canonicalJsonStringify(operation) || operation.onboarding?.abort === undefined) fail("profile-draft-abort-operation-changed");
            if (operation.credentials.phase !== "planned" || lstatMaybe(join(locator.stateRoot, "profiles", operation.profileId))) return false;
          }
          const root = join(locator.stateRoot, "profiles", operation.profileId);
          if (head !== undefined) assertCanonicalProfileBinding(join(root, "state.db"), { installationId: locator.installationId, profileId: operation.profileId });
          intent = ProfilePublicationSchema.parse({ kind: "draft-abort", schemaVersion: 1, installationId: locator.installationId, prior,
            capture: { operation, head, membership: head === undefined ? [] : unpublishedDraftAbortMembership(root), databases: head === undefined ? [] : profileAuthorityFileWitnesses(root) } });
          if (intent.kind !== "draft-abort") fail("profile-draft-abort-kind-invalid");
          prepareUnpublishedDraftAbort(control, locator, document, prior, intent);
          atomicJson(intentPath, intent);
        }
        if (intent.kind !== "draft-abort" || canonicalJsonStringify(intent.capture.operation) !== canonicalJsonStringify(operation)) fail("profile-draft-abort-operation-changed");
        prepareUnpublishedDraftAbort(control, locator, document, prior, intent)();
        readMachineRegistry(control, locator, false); assertHeld(); return true;
      });
    },
    captureProfileUpgradeHandoff(profileId: string) {
      if (mode !== "shared") fail("profile-upgrade-handoff-shared-required");
      const id = z.uuid().parse(profileId);
      const original = createHash("sha256").update(readProfileUpgradeAuthority(control, workspace, locator, id, assertHeld)).digest("hex");
      let consumed = false;
      return Object.freeze({ consume(next: InstallationLease): void {
        if (consumed) fail("profile-upgrade-handoff-consumed");
        consumed = true;
        if (!released) fail("profile-upgrade-handoff-release-required");
        assertInstallationLease(next);
        if (next.mode !== "exclusive" || next.readInstallationContext().workspace !== workspace || !equalLocator(next.locator, locator)) fail("profile-upgrade-handoff-installation-changed");
        if (createHash("sha256").update(readProfileUpgradeAuthority(control, workspace, locator, id, () => next.assertHeld())).digest("hex") !== original) fail("profile-upgrade-handoff-authority-changed");
      } });
    },
    captureStoppedProfileUpgrade(profileId: string) {
      if (mode !== "exclusive") fail("profile-stopped-upgrade-exclusive-required");
      const id = z.uuid().parse(profileId);
      const read = () => readProfileUpgradeAuthority(control, workspace, locator, id, assertHeld);
      const original = read();
      return Object.freeze({ assertHeld() {
        if (read() !== original) fail("profile-stopped-upgrade-authority-changed");
      } });
    },
    completeStoppedLogout(admission: RuntimeAdmission, input: z.infer<typeof LogoutOperationSchema>, restore: OfflineMaintenanceOperation, source: AuthorityDatabase): void {
      mutate(() => {
        assertStoppedLogoutMaintenance(this, restore);
        const operation = LogoutOperationSchema.parse(input);
        admission.assertPendingLogoutCompletionOwner(this, operation, restore);
        if (!(source instanceof AuthorityDatabase)) fail("profile-logout-native-completion-required");
        const operationPath = join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`), publicationPath = join(control, "profile-publication.json");
        let removed = lstatMaybe(operationPath) === undefined;
        const guard = () => {
          assertStoppedLogoutMaintenance(this, restore); source.assertPendingLogoutCompletion(admission, operation);
          if (removed ? lstatMaybe(operationPath) !== undefined : canonicalJsonStringify(readProfileEvidence(operationPath, LogoutOperationSchema)) !== canonicalJsonStringify(operation)) fail("profile-logout-completion-operation-changed");
        };
        guard();
        let document = readMachineRegistry(control, locator, false);
        const row = document.profiles.find(profile => profile.profileId === operation.profileId);
        if (document.activeProfileId !== null || document.sessionGeneration !== operation.sessionGeneration + 1
          || row === undefined || row.lifecycle !== "ready" && row.lifecycle !== "cancelling" || operation.settlement?.phase !== "done") fail("profile-logout-completion-epoch-changed");
        if (lstatMaybe(operationPath) === undefined) {
          if (row.lifecycle !== "ready" || lstatMaybe(publicationPath)) fail("profile-logout-completion-prefix-uncertain");
          return;
        }
        if (canonicalJsonStringify(readProfileEvidence(operationPath, LogoutOperationSchema)) !== canonicalJsonStringify(operation)) fail("profile-logout-completion-operation-changed");
        if (lstatMaybe(publicationPath)) {
          const pending = readStrict(publicationPath, ProfilePublicationSchema);
          if (pending.kind !== "profile" || pending.operation !== undefined && (pending.operation.kind !== "delete" || pending.operation.operationId !== operation.operationId)) fail("profile-logout-completion-publication-foreign");
          const current = readProfilePublicationSource(control, locator);
          guard(); prepareProfileRegistryPublication(control, locator, current.path, current.document, current.witness, pending)();
          document = readMachineRegistry(control, locator, false);
        }
        if (document.profiles.find(profile => profile.profileId === operation.profileId)?.lifecycle !== "ready") {
          const next = advanceProfileRegistryDocument(document, { profiles: document.profiles.map(profile => profile.profileId === operation.profileId ? { ...profile, lifecycle: "ready" } : profile) });
          const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
          const intent = ProfilePublicationSchema.parse({ kind: "profile", schemaVersion: 1, installationId: locator.installationId, prior, document: next });
          if (intent.kind !== "profile") fail("profile-logout-completion-publication-foreign");
          if (Buffer.byteLength(JSON.stringify(intent)) > 1_048_576) fail("profile-logout-settlement-evidence-too-large");
          guard(); atomicJson(publicationPath, intent);
          guard(); atomicJson(join(locator.stateRoot, "machine", "profiles.json"), next);
          guard(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), next, prior.completedRestores));
          guard(); unlinkSync(publicationPath); fsyncPath(control);
          document = next;
        }
        const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        const intent = ProfilePublicationSchema.parse({ kind: "profile", schemaVersion: 1, installationId: locator.installationId, prior, document,
          operation: { kind: "delete", operationId: operation.operationId } });
        if (Buffer.byteLength(JSON.stringify(intent)) > 1_048_576) fail("profile-logout-settlement-evidence-too-large");
        guard(); atomicJson(publicationPath, intent);
        guard(); unlinkSync(operationPath); removed = true; fsyncPath(dirname(operationPath));
        guard(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document, prior.completedRestores));
        guard(); unlinkSync(publicationPath); fsyncPath(control);
      });
    },
    assertColdPendingLogout(input: z.infer<typeof LogoutOperationSchema>): void {
      assertHeld();
      if (!(lifetime instanceof RuntimeLifetimeLock)) fail("profile-logout-cold-controller-required");
      const operation = LogoutOperationSchema.parse(input);
      if (coldLogoutObservations.get(operation.operationId) !== logoutIdentity(operation)) fail("profile-logout-cold-source-unobserved");
      const current = readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`), LogoutOperationSchema);
      if (logoutIdentity(current) !== logoutIdentity(operation)) fail("profile-logout-cold-source-changed");
      const path = join(locator.stateRoot, "profiles", operation.profileId, "state.db"), source = lstatSync(path);
      if (!source.isFile() || source.nlink !== 1 || privatePathRejects(path, source, "owner")
        || source.dev !== operation.source.database.device || source.ino !== operation.source.database.inode) fail("profile-logout-native-source-changed");
    },
    publishStoppedLogoutSettlement(admission: RuntimeAdmission, expected: z.infer<typeof LogoutOperationSchema>, input: z.infer<typeof LogoutOperationSchema>, restore: OfflineMaintenanceOperation, source: AuthorityDatabase): void {
      mutate(held => {
        const scope = new ActiveProfilePublicationRead(control, workspace, locator, expected.operationId, held, assertHeld);
        try {
          assertStoppedLogoutMaintenance(this, restore);
          requireRuntimeAdmission(admission, scope).assertPendingLogoutPublicationOwner(this, restore, scope);
          if (!(source instanceof AuthorityDatabase)) fail("profile-logout-native-publication-owner-required");
          const next = LogoutOperationSchema.parse(input);
          if (Buffer.byteLength(JSON.stringify(next)) > 1_048_576) fail("profile-logout-settlement-evidence-too-large");
          source.assertPendingLogoutPublication(admission, next);
          const path = join(locator.stateRoot, "machine", "operations", `${expected.operationId}.json`);
          const { settlement: beforeSettlement, ...beforeIdentity } = expected, { settlement: afterSettlement, ...afterIdentity } = next;
          if (canonicalJsonStringify(readProfileEvidence(path, LogoutOperationSchema)) !== canonicalJsonStringify(expected)
            || canonicalJsonStringify(afterIdentity) !== canonicalJsonStringify(beforeIdentity)) fail("profile-logout-settlement-operation-changed");
          const beforePhase = expected.settlement?.phase, afterPhase = next.settlement?.phase;
          if (!(beforePhase === undefined && afterPhase === "prepared" || beforePhase === "prepared" && afterPhase === "commit-intent"
            || beforePhase === "commit-intent" && afterPhase === "done")) fail("profile-logout-settlement-transition-refused");
          if (beforeSettlement !== undefined && afterSettlement !== undefined) {
            const { phase: _beforePhase, after: beforeAfter, ...beforeInputs } = beforeSettlement;
            const { phase: _afterPhase, after: afterAfter, ...afterInputs } = afterSettlement;
            if (canonicalJsonStringify(beforeInputs) !== canonicalJsonStringify(afterInputs) || beforeAfter !== undefined && beforeAfter !== afterAfter) fail("profile-logout-settlement-input-changed");
          }
          const document = readMachineRegistry(control, locator, false), row = document.profiles.find(profile => profile.profileId === expected.profileId);
          if (document.activeProfileId !== null || document.sessionGeneration !== expected.sessionGeneration + 1 || row?.lifecycle !== "cancelling") fail("profile-logout-settlement-epoch-changed");
          const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
          const intent = ProfilePublicationSchema.parse({ kind: "profile", schemaVersion: 1, installationId: locator.installationId, prior, document,
            operation: { kind: "write", operation: next } });
          if (intent.kind !== "profile") fail("profile-logout-settlement-transition-refused");
          if (Buffer.byteLength(JSON.stringify(intent)) > 1_048_576) fail("profile-logout-settlement-evidence-too-large");
          if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-publication-pending");
          atomicJson(join(control, "profile-publication.json"), intent);
          atomicJson(path, next);
          prepareProfileRegistryPublication(control, locator, join(locator.stateRoot, "machine", "profiles.json"), document, prior, intent)();
        } finally { scope.expire(); }
      });
    },
    capturePendingProfileLogout(input: z.infer<typeof LogoutOperationSchema>) {
      const operation = LogoutOperationSchema.parse(input);
      const observe = (document: ProfileRegistryDocument) => {
        assertHeld();
        if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-pending-logout-locator-changed");
        const row = document.profiles.find(entry => entry.profileId === operation.profileId);
        if (document.activeProfileId !== null || document.sessionGeneration !== operation.sessionGeneration + 1 || (row?.lifecycle !== "cancelling" && !(row?.lifecycle === "ready" && operation.settlement?.phase === "done")) || operation.phase === "complete") {
          fail("profile-pending-logout-unavailable");
        }
        const file = readPrivateFile(join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`), { label: "lock", maxBytes: 1_048_576 });
        if (file === undefined) fail("profile-pending-logout-operation-changed");
        const current = LogoutOperationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
        if (canonicalJsonStringify(current) !== canonicalJsonStringify(operation)) fail("profile-pending-logout-operation-changed");
        const observation = profileObservation(control, locator);
        const publication = readPrivateFile(join(control, "profile-publication.json"), { label: "lock", maxBytes: 1_048_576 });
        const pending = publication === undefined ? { absent: true } : { device: publication.identity.device, inode: publication.identity.inode,
          digest: createHash("sha256").update(publication.bytes).digest("hex") };
        assertHeld();
        return canonicalJsonStringify({ document, observation, pending, operationIdentity: file.identity });
      };
      const read = (publication?: ProfilePublicationRead) => {
        if (publication === undefined) return mutate(() => observe(readMachineRegistry(control, locator, false)));
        const document = readProfilePublicationRegistry(publication);
        publication.assertOperation(locator.stateRoot, operation.operationId);
        return observe(document);
      };
      const original = read();
      return Object.freeze({ assertHeld(publication?: ProfilePublicationRead) {
        if (read(publication) !== original) fail("profile-pending-logout-authority-changed");
      } });
    },
    publishProfileRegistry(expected: ProfileRegistryDocument, document: ProfileRegistryDocument) { publishRegistry(expected, document); },
    publishProfileRegistration(operation: z.infer<typeof SignUpOperationSchema>, profile: RuntimeAdmission) { publishRegistry(undefined, undefined, { operation, profile, lease: this }); },
    beginProfileSignUp(fields: Omit<z.infer<typeof SignUpOperationSchema>, "operationId" | "profileId" | "commandId" | "writeId" | "schemaVersion" | "kind" | "phase" | "onboarding" | "credentials">) {
      const profileId = randomUUID(), operationId = randomUUID();
      const operation = SignUpOperationSchema.parse({ ...fields, schemaVersion: 2, kind: "sign-up", phase: "applying",
        operationId, profileId, commandId: randomUUID(), writeId: randomUUID(),
        credentials: { operationId, keyId: randomUUID(), generation: 1, phase: "planned" },
        onboarding: { accountId: randomUUID(), generation: 1, attempts: [] } });
      publishOperation(operation, true);
      return operation;
    },
    publishProfileOperation(input: ProfileOperation | string) { publishOperation(input, false); },

    readInstallationContext() {
      const receipts = shared.readRelocationReceipts();
      return Object.freeze({ workspace, locator: publicLocator, receipts });
    },
    release() {
      assertSourceClosuresProved(sourceFailures);
      if (released) return;
      assertHeld();
      if (offlineOperation !== undefined && isOfflineMaintenanceOperationActive(offlineOperation)) throw new OfflineMaintenanceOperationUnavailableError("offline-maintenance-busy");
      admissions.delete(localAdmission);
      if (admissions.size === 0) installationAdmissions.delete(control);
      releaseExclusive?.();
      released = true;
    },
  });
  if (mode === "shared") { issuedLeases.add(shared); return shared; }
  let relocationStarted = options?.recoverRelocation !== undefined;
  let heldRestore = options?.recoverRelocation?.restoreAdmission;
  function journal(): RelocationJournal {
    const pending = readStrict(join(control, "journal.json"), JournalSchema);
    if (pending.phase === "adopting" || pending.phase === "restoring") fail("journal is not a relocation");
    if (pending.installationId !== locator.installationId || pending.fromGeneration !== locator.generation
      && pending.fromGeneration + 1 !== locator.generation) fail("relocation lease binding mismatch");
    validateJournal(workspace, pending, readReceiptChain(control, workspace, pending.installationId));
    return pending;
  }
  function assertOperation(pending: RelocationJournal): void {
    assertHeld();
    assertLocalRestoreHeld(heldRestore);
    if (!equalLocator(rawLocator(control, workspace), sourceLocator(pending))
      && !equalLocator(rawLocator(control, workspace), destinationLocator(pending))) fail("operation locator mismatch");
  }
  function attestStage(pending: RelocationJournal, verify: RelocationVerifier): VerifiedRelocationEvidence {
    const evidence = verifyStage(pending, sourceLocator(pending), verify);
    if (pending.phase !== "activating" && pending.phase !== "prepared" && pending.phase !== "preparing"
      && !sameEvidence(pending.evidence, evidence)) {
      fail("verified stage changed");
    }
    if (pending.phase === "activating" && (evidence.configSnapshotId !== pending.activationIntent.snapshot.configSnapshotId
      || evidence.configFingerprint !== pending.activationIntent.snapshot.fingerprint)) fail("verified stage activation mismatch");
    return evidence;
  }
  const exclusive: ExclusiveInstallationLease = Object.freeze({
    ...shared,
    captureProfileRestore(profileId, credentials) {
      assertHeld();
      this.readCompletedRestores(profileId);
      const binding = { installationId: locator.installationId, profileId }, root = join(locator.stateRoot, "profiles", profileId);
      readMachineRegistry(control, locator, false);
      if (lstatMaybe(join(control, "profile-publication.json")) || lstatMaybe(join(control, "journal.json"))) fail("profile-restore-operation-busy");
      const continuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
      assertProfileRestoreDatabaseBinding(join(root, "state.db"), binding);
      const context = ProfileRestoreContextSchema.parse({ binding, continuity, credentials });
      assertRestoreCredentialSnapshot(locator, context);
      return context;
    },
    assertProfileRestoreHeld(input, restore) {
      assertHeld(); assertLocalRestoreHeld(restore);
      const pending = readStrict(join(control, "journal.json"), AuthorityRestoreJournalSchema);
      if (pending.installationId !== locator.installationId || (pending.restoreAdmissionId !== restore.operationId && options?.recoverAuthorityRestore?.restoreAdmission !== restore)
        || canonicalJsonStringify(pending.restore) !== canonicalJsonStringify(input)
        || canonicalJsonStringify(pending.source) !== canonicalJsonStringify(locator)) fail("profile-restore-custody-mismatch");
      checkRestoreInput(locator, input);
      assertRestoreCredentialSnapshot(locator, input.profile);
      if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-restore-erasure-pending");
      if (pending.invalidation === undefined) {
        readMachineRegistry(control, locator, false);
        const current = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        if (canonicalJsonStringify(current) !== canonicalJsonStringify(input.profile.continuity)) {
          const completed = completedRestoreCustody(input, locator, "unchanged");
          const rows = input.profile.continuity.completedRestores;
          if (rows.some(row => row.operationId === completed.operationId)
            || canonicalJsonStringify(current) !== canonicalJsonStringify({ ...input.profile.continuity, completedRestores: [...rows, completed] })) fail("profile-restore-control-changed");
        }
      }
    },
    readAuthorityRestore(operationId) {
      assertHeld();
      const pending = readStrict(join(control, "journal.json"), AuthorityRestoreJournalSchema);
      if (pending.installationId !== locator.installationId || pending.restore.operationId !== operationId
        || canonicalJsonStringify(pending.source) !== canonicalJsonStringify(locator)) fail("restore recovery operation binding mismatch");
      return AuthorityRestoreInputSchema.parse(pending.restore);
    },
    beginAuthorityRestore(input, restore) {
      const parsed = AuthorityRestoreInputSchema.parse(input);
      assertHeld(); assertLocalRestoreHeld(restore); checkRestoreInput(locator, parsed);
      assertProfileRestoreDatabaseBinding(parsed.authorityPath, parsed.profile.binding);
      assertProfileRestoreDatabaseBinding(parsed.stagedPath, parsed.profile.binding);
      mutate(() => {
        assertHeld(); assertLocalRestoreHeld(restore);
        readMachineRegistry(control, locator, false);
        if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-restore-erasure-pending");
        const continuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(parsed.profile.continuity)) fail("profile-restore-control-changed");
        assertRestoreCredentialSnapshot(locator, parsed.profile);
        if (existsSync(join(control, "journal.json"))) fail("installation operation already pending");
        if (canonicalJsonStringify(rawLocator(control, workspace)) !== canonicalJsonStringify(locator)) fail("restore source locator changed");
        sameRestoreFile(parsed.authorityPath, parsed.live); sameRestoreFile(parsed.stagedPath, parsed.staged);
        assertRestoreSuspect(parsed);
        if (restoreFileBinding(parsed.manifestPath).sha256 !== parsed.manifestSha256
          || restoreFileBinding(parsed.backupPath).sha256 !== parsed.backupSha256) fail("restore backup binding mismatch");
        for (const row of parsed.companions) sameRestoreFile(`${parsed.authorityPath}${row.suffix}`, row.binding);
        for (const suffix of ["-wal", "-shm"] as const) {
          if (existsSync(`${parsed.authorityPath}${suffix}`) !== parsed.companions.some(row => row.suffix === suffix)) fail("restore companion inventory changed");
        }
        atomicJson(join(control, "journal.json"), AuthorityRestoreJournalSchema.parse({ schemaVersion: 2,
          phase: "restoring", installationId: locator.installationId, source: locator,
          restoreAdmissionId: restore.operationId, restore: parsed }));
      });
    },
    settleAuthorityRestore(input, outcome, verify, restore) {
      const parsed = AuthorityRestoreInputSchema.parse(input);
      assertHeld(); assertLocalRestoreHeld(restore);
      assertProfileRestoreDatabaseBinding(parsed.authorityPath, parsed.profile.binding);
      const verified = outcome === "replaced" ? z.strictObject({ authorityGeneration: GenerationSchema, authorityContentFingerprint: DigestSchema }).parse(verify()) : undefined;
      mutate(() => {
        assertHeld(); assertLocalRestoreHeld(restore);
        let pending = readStrict(join(control, "journal.json"), AuthorityRestoreJournalSchema);
        if (pending.installationId !== locator.installationId
          || canonicalJsonStringify(pending.source) !== canonicalJsonStringify(locator)
          || canonicalJsonStringify(pending.restore) !== canonicalJsonStringify(parsed)) fail("restore settlement operation binding mismatch");
        checkRestoreInput(locator, parsed);
        assertRestoreSuspect(parsed);
        const completed = completedRestoreCustody(parsed, locator, outcome);
        const previousCompleted = parsed.profile.continuity.completedRestores;
        const existingCompleted = previousCompleted.find(row => row.operationId === completed.operationId);
        if (existingCompleted !== undefined && canonicalJsonStringify(existingCompleted) !== canonicalJsonStringify(completed)) fail("completed-restore-operation-divergent");
        const completedRestores = existingCompleted === undefined ? [...previousCompleted, completed] : previousCompleted;
        if (restoreFileBinding(parsed.manifestPath).sha256 !== parsed.manifestSha256
          || restoreFileBinding(parsed.backupPath).sha256 !== parsed.backupSha256) fail("restore settlement backup binding mismatch");
        sameRestoreFile(parsed.authorityPath, outcome === "replaced" ? parsed.staged : parsed.live);
        for (const suffix of ["-wal", "-shm"] as const) {
          const row = parsed.companions.find(value => value.suffix === suffix);
          if (outcome === "unchanged" && row !== undefined) sameRestoreFile(`${parsed.authorityPath}${suffix}`, row.binding);
          else if (existsSync(`${parsed.authorityPath}${suffix}`)) fail("restore settlement companion outcome unproved");
        }
        if (outcome === "replaced") {
          if (verified?.authorityGeneration !== parsed.authorityGeneration
            || verified.authorityContentFingerprint !== parsed.authorityContentFingerprint) fail("restore settlement authority proof mismatch");
        }
        sameRestoreFile(parsed.authorityPath, outcome === "replaced" ? parsed.staged : parsed.live);
        assertRestoreSuspect(parsed);
        assertRestoreCredentialSnapshot(locator, parsed.profile);
        if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-restore-erasure-pending");
        const continuityPath = join(control, "profile-registry.json"), registryPath = join(locator.stateRoot, "machine", "profiles.json");
        const continuity = readStrict(continuityPath, ProfileContinuitySchema);
        if (outcome === "replaced") {
          if (pending.invalidation === undefined) {
            const document = readMachineRegistry(control, locator, false);
            if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(parsed.profile.continuity)) fail("profile-restore-control-changed");
            const next = advanceProfileRegistryDocument(document, { activeProfileId: null, sessionGeneration: document.sessionGeneration + 1 });
            pending = AuthorityRestoreJournalSchema.parse({ ...pending, invalidation: { priorDocument: document, document: next, continuity } });
            atomicJson(join(control, "journal.json"), pending);
          }
          const invalidation = pending.invalidation;
          if (invalidation === undefined) fail("profile-restore-invalidation-missing");
          if (invalidation.priorDocument.installationId !== locator.installationId || invalidation.document.installationId !== locator.installationId
            || canonicalJsonStringify(invalidation.continuity) !== canonicalJsonStringify(parsed.profile.continuity)
            || canonicalJsonStringify(profileRegistryWitness(locator.installationId, registryPath, invalidation.priorDocument, invalidation.continuity.completedRestores)) !== canonicalJsonStringify(invalidation.continuity)
            || canonicalJsonStringify(invalidation.document) !== canonicalJsonStringify(advanceProfileRegistryDocument(invalidation.priorDocument,
              { activeProfileId: null, sessionGeneration: invalidation.priorDocument.sessionGeneration + 1 }))) fail("profile-restore-invalidation-uncertain");
          const currentDocument = readStrict(registryPath, ProfileRegistryDocumentSchema);
          if (canonicalJsonStringify(currentDocument) !== canonicalJsonStringify(invalidation.document)
            && canonicalJsonStringify(currentDocument) !== canonicalJsonStringify(invalidation.priorDocument)) fail("profile-restore-invalidation-uncertain");
          const nextContinuity = profileRegistryWitness(locator.installationId, registryPath, invalidation.document, invalidation.continuity.completedRestores);
          if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(invalidation.continuity)
            && canonicalJsonStringify(continuity) !== canonicalJsonStringify(nextContinuity)
            && canonicalJsonStringify(continuity) !== canonicalJsonStringify({ ...nextContinuity, completedRestores })) fail("profile-restore-invalidation-control-changed");
          if (canonicalJsonStringify(currentDocument) !== canonicalJsonStringify(invalidation.document)) atomicJson(registryPath, invalidation.document);
          atomicJson(continuityPath, { ...nextContinuity, completedRestores });
        } else if (pending.invalidation !== undefined || canonicalJsonStringify(continuity) !== canonicalJsonStringify(parsed.profile.continuity)
          && canonicalJsonStringify(continuity) !== canonicalJsonStringify({ ...parsed.profile.continuity, completedRestores })) fail("profile-restore-unchanged-control-mismatch");
        sameRestoreFile(parsed.authorityPath, outcome === "replaced" ? parsed.staged : parsed.live);
        assertRestoreSuspect(parsed);
        const current = readStrict(continuityPath, ProfileContinuitySchema);
        if (canonicalJsonStringify(current.completedRestores) !== canonicalJsonStringify(previousCompleted)
          && canonicalJsonStringify(current.completedRestores) !== canonicalJsonStringify(completedRestores)) fail("completed-restore-history-changed");
        atomicJson(continuityPath, ProfileContinuitySchema.parse({ ...current, completedRestores }));
        unlinkSync(join(control, "journal.json")); fsyncPath(control);
      });
    },
    beginRelocation(destination, plan, restore) {
      assertHeld();
      assertLocalRestoreHeld(restore);
      if (lstatMaybe(join(control, "profile-registry.json"))
        && readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema).completedRestores.length !== 0) throw new ProfileStorageRelocationUnsupportedError();
      if (relocationStarted) fail("one relocation per exclusive lease; reacquire after settlement");
      const target = Object.freeze({ stateRoot: destination.stateRoot, artifactRoot: destination.artifactRoot });
      const operationId = randomUUID();
      const priorReceipts = readReceiptChain(control, workspace, locator.installationId);
      if (priorReceipts.length !== locator.generation) fail("relocation source receipt chain mismatch");
      const retentions = relocationRetentions(workspace, pairOf(locator), target, operationId, priorReceipts);
      const pinnedEntries = pinnedForOperation(retentions, locator.stateRoot, priorReceipts);
      const parsedPlan = PlanBindingSchema.parse(plan);
      checkPlan(parsedPlan, locator.installationId, locator.generation, pairOf(locator), target);
      if (existsSync(join(control, "journal.json"))) fail("relocation already pending");
      preflightPair(target);
      for (const role of ["state", "artifact"] as const) {
        if (target[`${role}Root`] === locator[`${role}Root`]) continue;
        const root = target[`${role}Root`];
        const allowed = role === "state" && inside(root, target.artifactRoot)
          ? relative(root, target.artifactRoot).split(/[\\/]/u)[0] : undefined;
        if (lstatMaybe(root) && readdirSync(root).some((name) => name !== allowed)) fail("destination is not fresh and eligible");
      }
      const current = rawLocator(control, workspace);
      if (!equalLocator(current, locator)) fail("exclusive locator changed; reacquire lease");
      for (const row of retentions) if (lstatMaybe(row.retained)) fail("retained sibling already exists");
      const sourceEpochs = epochsOf(locator);
      const destinationEpochs = { state: target.stateRoot === locator.stateRoot ? sourceEpochs.state : locator.generation + 1,
        artifact: target.artifactRoot === locator.artifactRoot ? sourceEpochs.artifact : locator.generation + 1 };
      writeJournal(control, { schemaVersion: 2, phase: "preparing", operationId, installationId: locator.installationId,
        fromGeneration: locator.generation, source: pairOf(locator), destination: target, sourceEpochs, destinationEpochs,
        plan: parsedPlan, restoreAdmissionId: restore.operationId, retentions, pinnedEntries });
      heldRestore = restore;
      relocationStarted = true;
      return operationId;
    },
    relocationInventory() {
      const pending = journal();
      assertOperation(pending);
      return Object.freeze({ operationId: pending.operationId, installationId: pending.installationId,
        fromGeneration: pending.fromGeneration, source: Object.freeze({ ...pending.source }),
        destination: Object.freeze({ ...pending.destination }), plan: Object.freeze({ ...pending.plan }), phase: pending.phase,
        ...(pending.phase === "preparing" ? {} : { preparation: Object.freeze({ ...pending.preparation }) }),
        ...(pending.phase === "preparing" || pending.phase === "prepared" ? {}
          : { activationIntent: Object.freeze({ ...pending.activationIntent }) }),
        ...("evidence" in pending ? { evidence: Object.freeze({ ...pending.evidence,
          source: Object.freeze({ ...pending.evidence.source }),
          destination: Object.freeze({ ...pending.evidence.destination }),
          plan: Object.freeze({ ...pending.evidence.plan }),
          managedStateEntries: Object.freeze(pending.evidence.managedStateEntries.map((entry) => Object.freeze({ ...entry }))) }) } : {}),
        pinnedEntries: Object.freeze([...pending.pinnedEntries]),
        retentions: Object.freeze(pending.retentions.map((row) => Object.freeze({ ...row }))) });
    },
    prepareDestinationRoots() {
      const pending = journal();
      assertOperation(pending);
      if (pending.phase !== "preparing" && pending.phase !== "prepared" && pending.phase !== "staged") {
        fail("destination preparation phase ended");
      }
      for (const role of ["state", "artifact"] as const) checkMarker(pending.source[`${role}Root`],
        pending.installationId, workspace, role, pending.sourceEpochs[role]);
      for (const role of ["state", "artifact"] as const) {
        assertOperation(pending);
        if (movedRole(pending, role)) prepareMovedDestinationRoot(workspace, pending, role);
        else checkMarker(pending.destination[`${role}Root`], pending.installationId, workspace, role,
          pending.sourceEpochs[role]);
        assertOperation(pending);
      }
    },
    verifiedSourceControlEntries() {
      const pending = journal();
      assertOperation(pending);
      if (pending.phase === "retaining") fail("partial source retention cannot be inventoried");
      const retained = pending.phase === "retained" || pending.phase === "switched";
      if (retained) checkRetainedSource(workspace, pending);
      const physical: RuntimePair = {
        stateRoot: retained && movedRole(pending, "state") ? retainedRoleRoot(pending, "state") : pending.source.stateRoot,
        artifactRoot: retained && movedRole(pending, "artifact") ? retainedRoleRoot(pending, "artifact") : pending.source.artifactRoot,
      };
      const controls = (role: "state" | "artifact"): string[] => {
        const root = physical[`${role}Root`];
        checkMarker(root, pending.installationId, workspace, role, pending.sourceEpochs[role]);
        const names = [MARKER];
        if (lstatMaybe(join(root, FENCE))) {
          if (!movedRole(pending, role)) fail("unmoved source has a relocation fence");
          checkFence(root, expectedFence(pending, role));
          names.push(FENCE);
        } else if (retained || pending.phase === "fenced") {
          if (movedRole(pending, role)) fail("moved source fence missing");
        }
        if (role === "state" && !(retained && movedRole(pending, "state"))) {
          if (inside(root, fixedLockRoot(workspace))) {
            privateDirectory(fixedLockRoot(workspace));
            names.push(relative(root, fixedLockRoot(workspace)).split(/[\\/]/u)[0] ?? "locks");
          }
          names.push(...pending.pinnedEntries);
        }
        return [...new Set(names)].sort();
      };
      const result = Object.freeze({ source: Object.freeze(physical),
        state: Object.freeze(controls("state")), artifact: Object.freeze(controls("artifact")) });
      assertOperation(pending);
      return result;
    },
    readPriorReceipts() {
      const pending = journal();
      assertOperation(pending);
      const receipts = readReceiptChain(control, workspace, pending.installationId);
      const pendingOwnReceipt = receipts.length === pending.fromGeneration + 1
        && pending.phase === "switched" && receipts.at(-1)?.operationId === pending.operationId;
      if (receipts.length !== pending.fromGeneration && !pendingOwnReceipt) fail("prior relocation receipt chain mismatch");
      const prior = pending.fromGeneration === 0 ? undefined : receipts[pending.fromGeneration - 1];
      const source = prior?.destination ?? {
        stateRoot: resolve(workspace, rebuildRuntimeIsolation.stateRoot),
        artifactRoot: resolve(workspace, rebuildRuntimeIsolation.artifactRoot),
      };
      const sourceEpochs = prior?.destinationEpochs ?? { state: 0, artifact: 0 };
      if (!equalPair(source, pending.source) || !equalEpochs(sourceEpochs, pending.sourceEpochs)) {
        fail("prior relocation receipt source mismatch");
      }
      return Object.freeze(receipts.slice(0, pending.fromGeneration));
    },
    recordVerifiedPreparation(verify) {
      const pending = journal();
      assertOperation(pending);
      const preparation = verifyPreparation(pending, verify);
      if (pending.phase === "preparing") {
        writeJournal(control, { ...pending, phase: "prepared", preparation });
      } else if (!samePreparation(pending.preparation, preparation)) fail("verified preparation changed");
    },
    recordActivationIntent(verify) {
      const pending = journal();
      assertOperation(pending);
      if (pending.phase === "preparing") fail("verified preparation required before activation intent");
      const intent = verifyActivationIntent(pending, verify(sourceLocator(pending), pending.destination,
        pending.operationId, pending.plan));
      if (pending.phase === "prepared") {
        ConfigSnapshotWriteSchema.parse(intent.snapshot);
        for (const role of ["state", "artifact"] as const) {
          if (movedRole(pending, role)) checkDestinationMarker(pending.destination[`${role}Root`], pending,
            workspace, role, pending.sourceEpochs[role]);
        }
        writeJournal(control, { ...pending, phase: "activating", activationIntent: intent });
      } else if (canonicalJsonStringify(pending.activationIntent) !== canonicalJsonStringify(intent)) {
        fail("activation intent changed");
      }
    },
    recordVerifiedStage(verify) {
      const pending = journal();
      assertOperation(pending);
      if (pending.phase !== "activating" && pending.phase !== "staged") fail("activation intent required before staging");
      const evidence = attestStage(pending, verify);
      if (pending.phase === "activating") {
        verifyManagedEntries(pending, evidence);
        for (const role of ["state", "artifact"] as const) {
          if (movedRole(pending, role)) checkDestinationMarker(pending.destination[`${role}Root`], pending,
            workspace, role, pending.sourceEpochs[role]);
        }
        writeJournal(control, { ...pending, phase: "staged", evidence });
      }
    },
    fenceRelocationSource() {
      const pending = journal();
      assertOperation(pending);
      if (pending.phase !== "staged" && pending.phase !== "fenced") fail("verified stage required before source fence");
      fenceMovedRoles(pending);
      if (pending.phase === "staged") writeJournal(control, { ...pending, phase: "fenced" });
    },
    retainRelocationSources() {
      let pending = journal();
      assertOperation(pending);
      if (pending.phase !== "fenced" && pending.phase !== "retaining" && pending.phase !== "retained") fail("source fence required before retention");
      if (pending.phase === "retained") { checkRetainedSource(workspace, pending); return; }
      if (pending.phase === "fenced") {
        for (const role of ["state", "artifact"] as const) if (movedRole(pending, role)) checkFence(pending.source[`${role}Root`], expectedFence(pending, role));
        pending = { ...pending, phase: "retaining" };
        writeJournal(control, pending);
      }
      for (const row of pending.retentions) {
        if (row.strategy === "lock-shell" || row.strategy === "witness-shell") retainEntryShell(workspace, pending, row);
        else retainWholeRoot(pending, row);
      }
      checkRetainedSource(workspace, pending);
      writeJournal(control, { ...pending, phase: "retained" });
    },
    switchRelocationLocator(verify) {
      const pending = journal();
      assertOperation(pending);
      if (pending.phase !== "retained" && pending.phase !== "switched") fail("retained source required before locator switch");
      attestStage(pending, verify);
      checkRetainedSource(workspace, pending);
      const next = destinationLocator(pending);
      const current = rawLocator(control, workspace);
      if (!equalLocator(current, next)) {
        if (!equalLocator(current, sourceLocator(pending))) fail("recovery locator mismatch");
        for (const role of ["state", "artifact"] as const) {
          if (!movedRole(pending, role)) continue;
          const root = pending.destination[`${role}Root`];
          const marker = readStrict(markerPath(root), MarkerSchema);
          if (marker.generation === pending.sourceEpochs[role]) {
            checkDestinationMarker(root, pending, workspace, role, pending.sourceEpochs[role]);
            atomicJson(markerPath(root), { ...marker, generation: pending.destinationEpochs[role] }, "data");
          } else checkMarker(root, pending.installationId, workspace, role, pending.destinationEpochs[role]);
        }
        atomicJson(join(control, "locator.json"), next);
      }
      if (pending.phase === "retained") writeJournal(control, { ...pending, phase: "switched" });
      return Object.freeze(next);
    },
    settleRelocation(verify) {
      const pending = journal();
      assertOperation(pending);
      if (pending.phase !== "switched") fail("relocation is not switched");
      attestStage(pending, verify);
      checkRetainedSource(workspace, pending);
      const current = rawLocator(control, workspace);
      if (!equalLocator(current, destinationLocator(pending))) fail("switched locator mismatch");
      for (const role of ["state", "artifact"] as const) {
        if (movedRole(pending, role)) checkDestinationMarker(current[`${role}Root`], pending,
          workspace, role, pending.destinationEpochs[role]);
        else checkMarker(current[`${role}Root`], pending.installationId, workspace, role, pending.destinationEpochs[role]);
      }
      const directory = join(control, RECEIPTS);
      if (!lstatMaybe(directory)) { mkdirSync(directory, { mode: 0o700 }); fsyncPath(control); }
      privateDirectory(directory);
      const path = receiptPath(control, current.generation, pending.operationId);
      const { phase: _phase, ...base } = pending;
      const receipt = CompletionReceiptSchema.parse({ ...base, toGeneration: current.generation, completedAt: systemClock.now().toISOString() });
      if (lstatMaybe(path)) {
        const existing = readStrict(path, CompletionReceiptSchema);
        const { completedAt: _existingTime, ...existingBody } = existing;
        const { completedAt: _receiptTime, ...receiptBody } = receipt;
        if (canonicalJsonStringify(existingBody) !== canonicalJsonStringify(receiptBody)) fail("completion receipt changed");
      } else atomicJson(path, receipt);
      readReceiptChain(control, workspace, pending.installationId);
      unlinkSync(join(control, "journal.json")); fsyncPath(control);
    },
  });
  issuedLeases.add(exclusive);
  return exclusive;
}

export function assertInstallationLease(value: Readonly<{ assertHeld(): void }>): asserts value is InstallationLease {
  if (!issuedLeases.has(value)) fail("unissued installation lease");
  value.assertHeld();
}

export interface StoppedProfileControlUpgradeAdmission {
  readonly installationId: string;
  machineControlCurrent(): boolean;
  upgradeIntentPresent(): boolean;
  registeredProfileIds(): readonly string[];
  profileInventory(profileId: string): StoppedControlProfileInventory;
  recordProfileInventory(claim: StoppedControlProfileInventory, proof: StoppedControlCredentialAttestation): void;
  run(plan: boolean): Promise<Readonly<{ state: "current" | "planned" | "upgraded"; runtimeAccess: "onboarding-incomplete" | "unchanged"; profileCount: number; receiptId?: string }>>;
  release(): void;
}

export interface StoppedControlProfileInventory { readonly profileId: string }

const stoppedControlInventories = new WeakMap<StoppedControlProfileInventory, Readonly<{
  binding: z.infer<typeof ProfileDatabaseBindingSchema>; stateRoot: string; artifactRoot: string; machineRoot: string; locator: RuntimeLocator;
  key: z.infer<typeof CredentialKeyWitnessSchema>; head: z.infer<typeof CredentialErasureHeadSchema>;
  duo: DuoContinuityRow; schemaVersion: 8 | 9 | 10 | 11; conversionOperationId: string; backupDirectory: string;
  pendingPlan(): CanonicalCredentialConversionPlan | undefined;
  assertCanonicalConversion(operationId: string, digest: string): void;
  assertCanonicalPublication(operationId: string, digest: string): void;
  assertHeld(): void; revalidateSource(): void; retainSourceClosure(error: unknown): void; readInstallationContext(): ReturnType<InstallationLease["readInstallationContext"]>;
}>>();

export function requireStoppedControlProfileInventory(value: StoppedControlProfileInventory) {
  const issued = stoppedControlInventories.get(value);
  if (issued === undefined) fail("profile-control-upgrade-inventory-unissued");
  issued.assertHeld();
  return issued;
}

function readControlUpgradeReceipt(path: string): z.infer<typeof ControlUpgradeReceiptSchema> {
  assertNoSymlinkComponents(path);
  const file = readPrivateFile(path, { label: "lock", maxBytes: 128 * 1024 * 1024 });
  if (file === undefined) fail("profile-control-upgrade-evidence-missing");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
  if (!z.looseObject({ schemaVersion: z.literal(2) }).safeParse(value).success) fail("profile-control-upgrade-pending-conversion-unsupported");
  return ControlUpgradeReceiptSchema.parse(value);
}

function controlUpgradeFile(path: string, maxBytes = 1_048_576) {
  assertNoSymlinkComponents(path);
  const file = readPrivateFile(path, { label: "lock", maxBytes });
  if (file === undefined) fail("profile-control-upgrade-evidence-missing");
  return { device: file.identity.device, inode: file.identity.inode, digest: createHash("sha256").update(file.bytes).digest("hex") };
}

function sameControlUpgradeFile(path: string, expected: z.infer<typeof ControlUpgradeFileSchema>, maxBytes = 1_048_576): boolean {
  return lstatMaybe(path) !== undefined && canonicalJsonStringify(controlUpgradeFile(path, maxBytes)) === canonicalJsonStringify(expected);
}

function assertPriorRegistryLogicalBinding(locator: RuntimeLocator, prior: z.infer<typeof StoppedProfileContinuitySchema>, document: z.infer<typeof StoppedProfileRegistryDocumentSchema>): void {
  if (prior.schemaVersion === 4 ? document.schemaVersion !== 3 || document.installationId !== locator.installationId
    || prior.revision !== document.revision : document.schemaVersion !== 2) fail("profile-control-upgrade-prior-mismatch");
  const operations = profileOperationInventory(locator.stateRoot);
  const logicalOperations = prior.operations.map(({ operationId, digest }) => ({ operationId, digest }));
  if (prior.installationId !== locator.installationId || prior.generation !== document.sessionGeneration
    || prior.digest !== createHash("sha256").update(canonicalJsonStringify(document)).digest("hex")
    || canonicalJsonStringify(logicalOperations) !== canonicalJsonStringify(operations)) fail("profile-control-upgrade-prior-mismatch");
}

function priorControlUpgradeEvidence(locator: RuntimeLocator, prior: z.infer<typeof StoppedProfileContinuitySchema>, document = readProfileEvidence(join(locator.stateRoot, "machine", "profiles.json"), StoppedProfileRegistryDocumentSchema), plans: readonly { profileId: string; plan: CanonicalCredentialConversionPlan }[] = []): string {
  if (document.profiles.some(row => row.credentialState === "wiped")) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED", { cause: new Error("profile-control-upgrade-wiped-credentials-unproved") });
  const machine = join(locator.stateRoot, "machine");
  if (document.profiles.some(row => row.lifecycle !== "ready" || row.credentialState !== "saved")) fail("profile-control-upgrade-pending-conversion-unsupported");
  assertPriorRegistryLogicalBinding(locator, prior, document);
  const currentDocument = ProfileRegistryDocumentSchema.parse({ ...document, schemaVersion: 3, installationId: locator.installationId, revision: 1 });
  if (plans.length !== 0 && (plans.length !== document.profiles.length || new Set(plans.map(row => row.profileId)).size !== plans.length
    || plans.some(row => !document.profiles.some(profile => profile.profileId === row.profileId)))) fail("profile-control-upgrade-plan-membership");
  if (plans.length === 0 && prior.schemaVersion === 1 && lstatMaybe(join(machine, "duo-credentials"))) fail("profile-control-upgrade-duo-material-present");
  if (plans.length === 0 && prior.schemaVersion !== 1) assertDuoMembership(locator, currentDocument, prior.duo);
  for (const profile of document.profiles) {
    const suspects = join(locator.stateRoot, "profiles", profile.profileId, "backups", "suspects");
    assertNoSymlinkComponents(suspects);
    if (prior.schemaVersion >= 3 && "completedRestores" in prior) {
      for (const record of prior.completedRestores.filter(row => row.profile.profileId === profile.profileId)) assertCompletedRestoreCustody(locator, record);
    } else if (lstatMaybe(suspects)) {
      privateDirectory(suspects);
      if (readdirSync(suspects).length !== 0) fail("profile-control-upgrade-suspect-custody-unproved");
    }
  }
  const known = new Set(["profiles.json", "profile-registry-version.json", "profile-verifiers.json", "profile-pepper", "credential-keys", "erasures", "operations", ...(prior.schemaVersion !== 1 || plans.length !== 0 ? ["duo-credentials"] : []), ...(plans.length !== 0 ? ["credential-operations"] : [])]);
  privateDirectory(machine);
  if (readdirSync(machine).some(name => !known.has(name))) fail("profile-control-upgrade-machine-membership-unknown");
  const verifiers = readProfileEvidence(join(machine, "profile-verifiers.json"), ProfileVerifierDocumentSchema);
  if (verifiers.profiles.length !== document.profiles.length || new Set(verifiers.profiles.map(row => row.profileId)).size !== verifiers.profiles.length
    || verifiers.profiles.some(row => !document.profiles.some(profile => profile.profileId === row.profileId))) fail("profile-control-upgrade-verifier-membership");
  const pepper = readPrivateFile(join(machine, "profile-pepper"), { label: "lock", maxBytes: 32 });
  if (pepper === undefined || pepper.bytes.length !== 32) fail("profile-control-upgrade-pepper-invalid");
  const pendingOperations = profileOperationInventory(locator.stateRoot).map(row => readProfileEvidence(join(machine, "operations", `${row.operationId}.json`), ProfileOperationSchema));
  if (pendingOperations.some(operation => operation.kind !== "logout" || operation.phase !== "complete")) fail("profile-control-upgrade-operation-pending");
  assertErasureMembership(currentDocument, prior.erasures);
  if (plans.length === 0) assertProfileCredentialKeyMembership(locator, prior.erasures);
  const profiles = prior.erasures.map(row => {
    if (row.credentialKey === undefined) fail("profile-control-upgrade-credential-conversion-required");
    const root = join(locator.stateRoot, "profiles", row.profileId), path = join(root, "state.db");
    assertCanonicalProfileBinding(path, { installationId: locator.installationId, profileId: row.profileId });
    const metadata = lstatSync(path);
    const conversion = plans.find(plan => plan.profileId === row.profileId)?.plan.operation;
    const credentialFiles = [join(locator.stateRoot, "machine", "credential-keys", `${row.profileId}.json`),
      join(root, "credentials", "protected.json"), join(root, "credentials", "chatgpt-account.json")].map(path => {
      const file = readPrivateFile(path, { label: "protected.json", maxBytes: 25 * 1024 * 1024 });
      const actual = file === undefined ? { state: "absent" as const } : { state: "present" as const,
        ...file.identity, digest: createHash("sha256").update(file.bytes).digest("hex") };
      if (conversion === undefined) return { path, file: actual };
      const head = dirname(path) === join(machine, "credential-keys");
      const planned = head ? conversion.priorHead : conversion.files.find(file => file.kind === (basename(path) === "protected.json" ? "protected" : "chatgpt"))?.prior;
      if (planned === undefined) fail("profile-control-upgrade-plan-membership");
      const published = head ? Buffer.from(canonicalJsonStringify(conversion.head)) : Buffer.from(conversion.files.find(file => file.kind === (basename(path) === "protected.json" ? "protected" : "chatgpt"))?.bytes ?? "", "base64");
      if (canonicalJsonStringify(actual) !== canonicalJsonStringify(planned) && (file === undefined || !file.bytes.equals(published))) fail("profile-control-upgrade-credential-source-changed");
      return { path, file: planned };
    });
    return { profileId: row.profileId, credentialFiles, database: { device: metadata.dev, inode: metadata.ino,
      size: metadata.size, modified: metadata.mtimeMs, changed: metadata.ctimeMs } };
  });
  return canonicalJsonStringify({ prior, profiles, verifiers: controlUpgradeFile(join(machine, "profile-verifiers.json")), pepper: controlUpgradeFile(join(machine, "profile-pepper")) });
}

export function inspectFlatOfflineRunMaintenance(workspacePath: string) {
  const workspace = realpathSync(workspacePath), control = join(workspace, CONTROL);
  if (resolve(workspacePath) !== workspace) fail("worker-process-recovery-workspace-unsafe");
  assertNoSymlinkComponents(control); privateDirectory(control);
  const locator = readLocator(control, workspace), state = join(workspace, rebuildRuntimeIsolation.stateRoot),
    artifacts = join(workspace, rebuildRuntimeIsolation.artifactRoot), locks = fixedLockRoot(workspace);
  if (locator.stateRoot !== state || locator.artifactRoot !== artifacts
    || [join(state, "machine"), join(state, "profiles"), ...["journal.json", "profile-registry.json", "profile-flat-claim.json", "profile-publication.json", "profile-owner-claims"]
      .map(name => join(control, name))].some(path => lstatMaybe(path) !== undefined)) fail("worker-process-recovery-flat-source-unproved");
  const witnesses = [join(control, "installation.json"), join(control, "locator.json"), join(state, MARKER), join(artifacts, MARKER)]
    .map(path => readProcessCustodyFile(path).witness);
  return { workspace, installationId: locator.installationId, processLockRoot: locks, witnesses,
    roots: [state, artifacts, locks].map(path => {
      assertNoSymlinkComponents(path);
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || privatePathRejects(path, stat, "group-write")) fail("worker-process-recovery-root-unsafe");
      return { path, device: stat.dev, inode: stat.ino, mode: stat.mode, owner: stat.uid };
    }) };
}

export function assertStoppedMachineMaintenance(lease: InstallationLease, restore: OfflineMaintenanceOperation): void {
  assertInstallationLease(lease);
  if (lease.mode !== "exclusive") fail("profile-control-upgrade-runtime-active");
  const workspace = lease.readInstallationContext().workspace;
  assertRestoreHeld(workspace, restore);
  if (!(lease.lifetime instanceof RuntimeLifetimeLock)) fail("offline-maintenance-exclusive-root-required");
  lease.lifetime.assertOfflineMaintenance(restore, workspace);
  if (!equalLocator(readLocator(join(workspace, CONTROL), workspace), lease.locator)) fail("profile-control-upgrade-locator-changed");
}

function convertedProfileRegistry(locator: RuntimeLocator, prior: z.infer<typeof StoppedProfileRegistryDocumentSchema>): ProfileRegistryDocument {
  if (prior.schemaVersion === 3) {
    if (prior.installationId !== locator.installationId) fail("profile-registry-installation-mismatch");
    return prior;
  }
  return ProfileRegistryDocumentSchema.parse({ ...prior, schemaVersion: 3, installationId: locator.installationId, revision: 1 });
}
function convertedProfileControl(locator: RuntimeLocator, prior: z.infer<typeof StoppedProfileContinuitySchema>, document: ProfileRegistryDocument) {
  return profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document,
    prior.schemaVersion >= 3 && "completedRestores" in prior ? prior.completedRestores : []);
}
function validateStoppedControlUpgrade(control: string, locator: RuntimeLocator, receipt: z.infer<typeof ControlUpgradeReceiptSchema>) {
  const backupDirectory = join(control, "profile-control-upgrades"), registryPath = join(locator.stateRoot, "machine", "profiles.json"),
  controlPath = join(control, "profile-registry.json"), markerPath = join(locator.stateRoot, "machine", "profile-registry-version.json");
  if (receipt.installationId !== locator.installationId
    || canonicalJsonStringify(convertedProfileRegistry(locator, receipt.priorDocument)) !== canonicalJsonStringify(receipt.document)
    || canonicalJsonStringify(convertedProfileControl(locator, receipt.prior, receipt.document)) !== canonicalJsonStringify(receipt.current)
    || priorControlUpgradeEvidence(locator, receipt.prior, receipt.priorDocument, receipt.credentials) !== receipt.sourceEvidence) fail("profile-control-upgrade-source-changed");
  const prefix = join(backupDirectory, receipt.operationId);
  privateDirectory(backupDirectory);
  const expectedNames = [...receipt.retained.map(row => row.name), ...receipt.backups.filter(row => lstatMaybe(join(backupDirectory, row.directory))).map(row => row.directory), ...["registry", "control", "marker"].map(role => `${receipt.operationId}.${role}.before.json`),
    ...["registry.stage", "control.stage", "marker.stage", "receipt.json"].filter(suffix => lstatMaybe(`${prefix}.${suffix}`)).map(suffix => `${receipt.operationId}.${suffix}`)];
  if (canonicalJsonStringify(readdirSync(backupDirectory).sort()) !== canonicalJsonStringify(expectedNames.sort())) fail("profile-control-upgrade-backup-membership");
  for (const row of receipt.backups) {
    if (row.directory !== `${receipt.operationId}.${row.profileId}.authority` || !receipt.document.profiles.some(profile => profile.profileId === row.profileId)) fail("profile-control-upgrade-backup-membership");
    const directory = join(backupDirectory, row.directory);
    if (row.verifiedBackup !== undefined && lstatMaybe(directory) === undefined) fail("profile-control-upgrade-backup-changed");
    if (lstatMaybe(directory) !== undefined) {
      assertNoSymlinkComponents(directory); privateDirectory(directory);
      if (row.verifiedBackup !== undefined) {
        const name = row.verifiedBackup.manifest.backupFileName;
        if (canonicalJsonStringify(readdirSync(directory).sort()) !== canonicalJsonStringify([name, `${name}.manifest.json`].sort())
          || controlUpgradeFile(join(directory, `${name}.manifest.json`), 64_000).digest !== row.verifiedBackup.manifestSha256
          || row.verifiedBackup.manifest.byteSize > 512 * 1024 * 1024
          || controlUpgradeFile(join(directory, name), 512 * 1024 * 1024).digest !== row.verifiedBackup.manifest.sha256) fail("profile-control-upgrade-backup-changed");
      }
    }
  }
  for (const row of receipt.retained) if (!sameControlUpgradeFile(join(backupDirectory, row.name), row.file, 16 * 1024 * 1024)) fail("profile-control-upgrade-retained-changed");
  for (const [role, expected] of [["registry", receipt.registryBackup], ["control", receipt.controlBackup], ["marker", receipt.markerBackup]] as const) {
    if (!sameControlUpgradeFile(`${prefix}.${role}.before.json`, expected)) fail("profile-control-upgrade-backup-changed");
  }
  if (canonicalJsonStringify(readProfileEvidence(`${prefix}.registry.before.json`, StoppedProfileRegistryDocumentSchema)) !== canonicalJsonStringify(receipt.priorDocument)
    || canonicalJsonStringify(readProfileEvidence(`${prefix}.control.before.json`, StoppedProfileContinuitySchema)) !== canonicalJsonStringify(receipt.prior)) fail("profile-control-upgrade-backup-diverged");
  readProfileEvidence(`${prefix}.marker.before.json`, z.strictObject({ schemaVersion: z.literal(receipt.prior.schemaVersion + 1) }));
  const stages = [[registryPath, `${prefix}.registry.stage`, receipt.priorRegistry, receipt.registryStage],
    [controlPath, `${prefix}.control.stage`, receipt.priorControl, receipt.controlStage],
    [markerPath, `${prefix}.marker.stage`, receipt.priorMarker, receipt.markerStage]] as const;
  let unpublished = false;
  for (const [path, stage, before, after] of stages) {
    if (lstatMaybe(stage)) {
      unpublished = true;
      if (!sameControlUpgradeFile(path, before) || !sameControlUpgradeFile(stage, after)) fail("profile-control-upgrade-publication-uncertain");
    } else if (unpublished || !sameControlUpgradeFile(path, after)) fail("profile-control-upgrade-publication-uncertain");
  }
  const staged = (role: string, path: string) => lstatMaybe(`${prefix}.${role}.stage`) ? `${prefix}.${role}.stage` : path;
  if (canonicalJsonStringify(readProfileEvidence(staged("registry", registryPath), ProfileRegistryDocumentSchema)) !== canonicalJsonStringify(receipt.document)
    || canonicalJsonStringify(readProfileEvidence(staged("control", controlPath), ProfileContinuitySchema)) !== canonicalJsonStringify(receipt.current)) fail("profile-control-upgrade-stage-diverged");
  readProfileEvidence(staged("marker", markerPath), z.strictObject({ schemaVersion: z.literal(6) }));
  return stages;
}

export function acquireStoppedProfileControlUpgrade(workspacePath: string, restore: OfflineMaintenanceOperation, lifetime: RuntimeLifetimeLock, heldLease?: InstallationLease): StoppedProfileControlUpgradeAdmission {
  if (!(lifetime instanceof RuntimeLifetimeLock)) fail("runtime-lifetime-required");
  lifetime.assertHeld();
  const workspace = realpathSync(workspacePath);
  if (resolve(workspacePath) !== workspace) fail("profile-control-upgrade-workspace-invalid");
  assertRestoreHeld(workspace, restore);
  lifetime.assertOfflineMaintenance(restore, workspace);
  const ownsLease = heldLease === undefined;
  if (heldLease !== undefined) {
    assertInstallationLease(heldLease);
    if (heldLease.lifetime !== lifetime) fail("runtime-lifetime-mismatch");
    if (heldLease.mode !== "exclusive") fail("profile-control-upgrade-runtime-active");
    const heldContext = heldLease.readInstallationContext();
    if (realpathSync(heldContext.workspace) !== workspace) fail("profile-control-upgrade-workspace-invalid");
  }
  const lease = heldLease ?? acquireInstallation(workspace, "exclusive", lifetime, { stoppedControlForward: true, offlineOperation: restore }), locator = lease.locator, control = join(workspace, CONTROL);
  const markerPath = join(locator.stateRoot, "machine", "profile-registry-version.json"), controlPath = join(control, "profile-registry.json");
  const intentPath = join(control, "profile-control-upgrade.json"), backupDirectory = join(control, "profile-control-upgrades");
  const conversionOperationId = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath).operationId : randomUUID();
  const inventorySnapshots = new Set<ReturnType<typeof createReadonlyAuthoritySnapshot>>();
  const issuedInventoryClaims = new Set<StoppedControlProfileInventory>();
  const inventoryProofs = new Map<string, { claim: StoppedControlProfileInventory; proof: StoppedControlCredentialAttestation }>();
  const publicationProofs = (profiles: readonly z.infer<typeof ProfileRegistryRowSchema>[]): (() => void)[] => profiles.map(profile => {
    const entry = inventoryProofs.get(profile.profileId);
    if (entry === undefined) fail("profile-control-upgrade-inventory-required");
    const inventory = readStoppedCredentialConversion(entry.proof, entry.claim);
    return () => { inventory.revalidate(); };
  });
  function held(): void {
    lease.assertHeld(); assertRestoreHeld(workspace, restore);
    if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-control-upgrade-locator-changed");
    if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-control-upgrade-publication-pending");
  }
  const registryPath = join(locator.stateRoot, "machine", "profiles.json");
  function finish(receipt: z.infer<typeof ControlUpgradeReceiptSchema>, afterPublication: readonly (() => void)[]): void {
    held();
    const stages = validateStoppedControlUpgrade(control, locator, receipt);
    const prefix = join(backupDirectory, receipt.operationId);
    for (const [path, stage] of stages) {
      if (lstatMaybe(stage)) renameSync(stage, path);
      fsyncPath(dirname(path)); fsyncPath(backupDirectory);
    }
    for (const [path, , , after] of stages) if (!sameControlUpgradeFile(path, after)) fail("profile-control-upgrade-readback-failed");
    if (priorControlUpgradeEvidence(locator, receipt.prior, receipt.priorDocument, receipt.credentials) !== receipt.sourceEvidence) fail("profile-control-upgrade-source-changed");
    for (const revalidate of afterPublication) revalidate();
    if (lstatMaybe(`${prefix}.receipt.json`)) {
      if (canonicalJsonStringify(readControlUpgradeReceipt(`${prefix}.receipt.json`)) !== canonicalJsonStringify(receipt)) fail("profile-control-upgrade-receipt-changed");
    } else atomicJson(`${prefix}.receipt.json`, receipt);
    unlinkSync(intentPath); fsyncPath(control);
    readMachineRegistry(control, locator, false);
    held();
  }
  return Object.freeze({ installationId: locator.installationId,
    machineControlCurrent(): boolean {
      held();
      const observedMarker = readProfileEvidence(markerPath, z.strictObject({ schemaVersion: z.number().int() }));
      if (![2, 3, 4, 5, 6].includes(observedMarker.schemaVersion)) fail("profile-control-upgrade-pending-conversion-unsupported");
      return observedMarker.schemaVersion === 6;
    },
    upgradeIntentPresent(): boolean {
      held();
      return lstatMaybe(intentPath) !== undefined;
    },
    registeredProfileIds(): readonly string[] {
      held();
      if (this.machineControlCurrent() && !this.upgradeIntentPresent()) return readMachineRegistry(control, locator, false).profiles.map((row) => row.profileId);
      const pending = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath).prior : undefined;
      return (pending ?? readProfileEvidence(controlPath, StoppedProfileContinuitySchema)).erasures.map((row) => row.profileId);
    },
    profileInventory(profileId: string): StoppedControlProfileInventory {
      held();
      const pending = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath) : undefined;
      const prior = pending?.prior ?? readProfileEvidence(controlPath, StoppedProfileContinuitySchema);
      if (pending === undefined) readProfileEvidence(markerPath, z.strictObject({ schemaVersion: z.literal(prior.schemaVersion + 1) }));
      else if ((!sameControlUpgradeFile(registryPath, pending.priorRegistry) && !sameControlUpgradeFile(registryPath, pending.registryStage))
        || (!sameControlUpgradeFile(controlPath, pending.priorControl) && !sameControlUpgradeFile(controlPath, pending.controlStage))
        || (!sameControlUpgradeFile(markerPath, pending.priorMarker) && !sameControlUpgradeFile(markerPath, pending.markerStage))) fail("profile-control-upgrade-publication-uncertain");
      if (!prior.erasures.some(row => row.profileId === z.uuid().parse(profileId))) fail("profile-control-upgrade-profile-unavailable");
      const priorDocument = pending?.priorDocument ?? readProfileEvidence(registryPath, StoppedProfileRegistryDocumentSchema);
      const evidence = priorControlUpgradeEvidence(locator, prior, priorDocument, pending?.credentials), controlIdentity = controlUpgradeFile(controlPath), markerIdentity = controlUpgradeFile(markerPath);
      const snapshot = createReadonlyAuthoritySnapshot(join(locator.stateRoot, "profiles", profileId, "state.db"));
      inventorySnapshots.add(snapshot);
      const revalidateSource = () => {
        held(); snapshot.assertUnchanged();
        if (priorControlUpgradeEvidence(locator, prior, priorDocument, lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath).credentials : undefined) !== evidence) fail("profile-control-upgrade-inventory-source-changed");
      };
      const assertHeld = () => {
        held(); snapshot.assertUnchanged();
        if (lstatMaybe(intentPath)) {
          const receipt = readControlUpgradeReceipt(intentPath);
          if (receipt.operationId !== conversionOperationId) fail("profile-control-upgrade-inventory-expired");
          validateStoppedControlUpgrade(control, locator, receipt);
        } else if (!sameControlUpgradeFile(controlPath, controlIdentity) || !sameControlUpgradeFile(markerPath, markerIdentity)) fail("profile-control-upgrade-inventory-expired");
        revalidateSource();
      };
      const binding = ProfileDatabaseBindingSchema.parse({ installationId: locator.installationId, profileId });
      const databaseBinding = readProfileDatabaseBinding(join(locator.stateRoot, "profiles", profileId, "state.db"));
      if (databaseBinding.state !== "bound" || ![8, 9, 10, 11].includes(databaseBinding.schemaVersion)
        || canonicalJsonStringify(databaseBinding.binding) !== canonicalJsonStringify(binding)) fail("profile-control-upgrade-database-schema-unsupported");
      const schemaVersion = z.union([z.literal(8), z.literal(9), z.literal(10), z.literal(11)]).parse(databaseBinding.schemaVersion);
      const pendingPlan = () => {
        held();
        const receipt = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath) : undefined;
        if (receipt !== undefined && receipt.operationId !== conversionOperationId) fail("profile-control-upgrade-inventory-expired");
        return receipt?.credentials.find(row => row.profileId === profileId)?.plan;
      };
      const assertCanonicalConversion = (operationId: string, digest: string) => {
        held(); snapshot.assertUnchanged();
        const plan = pendingPlan();
        if (plan === undefined || operationId !== conversionOperationId || plan.operation.operationId !== operationId || plan.digest !== digest) fail("profile-control-upgrade-conversion-owner-mismatch");
      };
      const assertCanonicalPublication = (operationId: string, digest: string) => {
        assertCanonicalConversion(operationId, digest);
        const receipt = readControlUpgradeReceipt(intentPath);
        if (receipt.phase !== "publishing" || receipt.backups.length !== receipt.document.profiles.length
          || receipt.backups.some(row => row.verifiedBackup === undefined)) fail("profile-control-upgrade-verified-backup-required");
      };
      const stateRoot = join(locator.stateRoot, "profiles", profileId), issued = Object.freeze({ profileId });
      const credential = prior.erasures.find(row => row.profileId === profileId);
      if (credential?.credentialKey === undefined) fail("profile-control-upgrade-credential-conversion-required");
      stoppedControlInventories.set(issued, Object.freeze({ binding: Object.freeze(binding), stateRoot, artifactRoot: join(stateRoot, "artifacts"), machineRoot: locator.stateRoot,
        key: credential.credentialKey, head: credential.head,
        duo: prior.schemaVersion === 1 ? { state: "never-initialized" as const, profileId, revision: 0 as const } : prior.duo.find(row => row.profileId === profileId) ?? fail("duo-profile-membership-mismatch"),
        schemaVersion, conversionOperationId, backupDirectory: join(backupDirectory, `${conversionOperationId}.${profileId}.authority`), pendingPlan, assertCanonicalConversion, assertCanonicalPublication, locator: Object.freeze({ ...locator }), assertHeld, revalidateSource,
        retainSourceClosure: error => lease.retainSourceClosure(error), readInstallationContext: () => { assertHeld(); return lease.readInstallationContext(); } }));
      assertHeld(); issuedInventoryClaims.add(issued);
      return issued;
    },
    recordProfileInventory(claim: StoppedControlProfileInventory, proof: StoppedControlCredentialAttestation): void {
      held();
      if (!issuedInventoryClaims.has(claim) || inventoryProofs.has(claim.profileId)) fail("profile-control-upgrade-attestation-owner-mismatch");
      readStoppedCredentialConversion(proof, claim);
      inventoryProofs.set(claim.profileId, { claim, proof });
    },
    async run(plan: boolean) {
      try {
      const prepared = withInstallationControl(control, () => {
        held();
        const pending = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath) : undefined;
        const registrations = pending?.priorDocument ?? readProfileEvidence(registryPath,
          z.union([ProfileRegistryDocumentSchema, StoppedProfileRegistryDocumentSchema]));
        const runtimeAccess = registrations.profiles.some(row => row.registration.onboardingCompletion === undefined)
          ? "onboarding-incomplete" as const : "unchanged" as const;
        if (pending !== undefined) {
          if (plan) fail("profile-control-upgrade-recovery-required");
          publicationProofs(pending.document.profiles);
          return { receipt: pending, runtimeAccess };
        }
        if (this.machineControlCurrent()) return { state: "current" as const, runtimeAccess, profileCount: readMachineRegistry(control, locator, false).profiles.length };
        const prior = readProfileEvidence(controlPath, StoppedProfileContinuitySchema);
        const priorDocument = readProfileEvidence(registryPath, StoppedProfileRegistryDocumentSchema);
        const sourceEvidence = priorControlUpgradeEvidence(locator, prior, priorDocument);
        const document = convertedProfileRegistry(locator, priorDocument), current = convertedProfileControl(locator, prior, document);
        const retained = lstatMaybe(backupDirectory) ? readdirSync(backupDirectory).sort().map(name => ({ name, file: controlUpgradeFile(join(backupDirectory, name), 16 * 1024 * 1024) })) : [];
        const operationId = conversionOperationId;
        ControlUpgradeReceiptSchema.shape.retained.parse(retained);
        if (Buffer.byteLength(JSON.stringify({ prior, current, priorDocument, document, sourceEvidence, retained })) + 4096 > 16 * 1024 * 1024) fail("profile-control-upgrade-evidence-too-large");
        const preparedCredentials = document.profiles.map(profile => {
          const entry = inventoryProofs.get(profile.profileId);
          if (entry === undefined) fail("profile-control-upgrade-inventory-required");
          return { profileId: profile.profileId, plan: readStoppedCredentialConversion(entry.proof, entry.claim).plan };
        });
        const afterPublication = publicationProofs(document.profiles);
        if (plan) return { state: "planned" as const, runtimeAccess, profileCount: document.profiles.length };
        if (!lstatMaybe(backupDirectory)) { mkdirSync(backupDirectory, { mode: 0o700 }); fsyncPath(control); }
        privateDirectory(backupDirectory);
        const prefix = join(backupDirectory, operationId);
        const originals = [registryPath, controlPath, markerPath].map(path => {
          const file = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
          if (file === undefined) fail("profile-control-upgrade-evidence-missing");
          return file;
        });
        const before = [controlUpgradeFile(registryPath), controlUpgradeFile(controlPath), controlUpgradeFile(markerPath)] as const;
        for (const [index, role] of ["registry", "control", "marker"].entries()) {
          const file = originals[index]; if (file === undefined) fail("profile-control-upgrade-evidence-missing");
          writePrivateStage(`${prefix}.${role}.before.json`, file.bytes);
          if (controlUpgradeFile(`${prefix}.${role}.before.json`).digest !== before[index]?.digest) fail("profile-control-upgrade-backup-diverged");
        }
        writePrivateStage(`${prefix}.registry.stage`, Buffer.from(JSON.stringify(document)));
        writePrivateStage(`${prefix}.control.stage`, Buffer.from(JSON.stringify(current)));
        writePrivateStage(`${prefix}.marker.stage`, Buffer.from(JSON.stringify({ schemaVersion: 6 })));
        fsyncPath(backupDirectory);
        const receipt = ControlUpgradeReceiptSchema.parse({ schemaVersion: 2, operationId, installationId: locator.installationId,
          phase: "backing-up", credentials: preparedCredentials,
          backups: document.profiles.map(profile => ({ profileId: profile.profileId, directory: `${operationId}.${profile.profileId}.authority` })),
          prior, current, priorDocument, document, retained, priorRegistry: before[0], priorControl: before[1], priorMarker: before[2],
          registryBackup: controlUpgradeFile(`${prefix}.registry.before.json`), controlBackup: controlUpgradeFile(`${prefix}.control.before.json`), markerBackup: controlUpgradeFile(`${prefix}.marker.before.json`),
          registryStage: controlUpgradeFile(`${prefix}.registry.stage`), controlStage: controlUpgradeFile(`${prefix}.control.stage`), markerStage: controlUpgradeFile(`${prefix}.marker.stage`), sourceEvidence });
        if (!sameControlUpgradeFile(registryPath, receipt.priorRegistry) || !sameControlUpgradeFile(controlPath, receipt.priorControl) || !sameControlUpgradeFile(markerPath, receipt.priorMarker)
          || priorControlUpgradeEvidence(locator, prior, priorDocument) !== sourceEvidence) fail("profile-control-upgrade-source-changed");
        if (Buffer.byteLength(JSON.stringify(receipt)) > 128 * 1024 * 1024) fail("profile-control-upgrade-evidence-too-large");
        for (const revalidate of afterPublication) revalidate();
        atomicJson(intentPath, receipt);
        return { receipt, runtimeAccess };
      });
      if (!("receipt" in prepared)) return prepared;
      let receipt = prepared.receipt;
      if (receipt === undefined) fail("profile-control-upgrade-evidence-missing");
      for (const row of receipt.backups) {
        const entry = inventoryProofs.get(row.profileId);
        if (entry === undefined) fail("profile-control-upgrade-inventory-required");
        const inventory = readStoppedCredentialConversion(entry.proof, entry.claim), admission = inventory.admission;
        inventory.revalidate();
        const sourceInfo = requireStoppedControlProfileInventory(entry.claim), databasePath = join(sourceInfo.stateRoot, "state.db");
        const before = inspectAuthorityBackupReadOnly(admission, databasePath, sourceInfo.schemaVersion);
        const directory = join(backupDirectory, row.directory);
        let manifest = row.verifiedBackup?.manifest;
        if (manifest === undefined) {
          if (lstatMaybe(directory) !== undefined && readdirSync(directory).length !== 0) {
            const names = readdirSync(directory);
            const manifests = names.filter(name => /^authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite\.manifest\.json$/u.test(name));
            const name = manifests[0];
            if (names.length !== 2 || manifests.length !== 1 || name === undefined || !names.includes(name.slice(0, -14))) fail("profile-control-upgrade-backup-recovery-required");
            manifest = AuthorityBackupManifestSchema.parse((await verifyBackupManifestAtPath(admission, join(directory, name))).manifest);
          } else {
            const source = openAuthorityBackupSourceReadOnly(admission, databasePath, 250, sourceInfo.schemaVersion);
            let primary: { error: unknown } | undefined;
            try {
              const report = await new AuthorityBackupService(admission, source, { directory }).request({ trigger: "schema-migration", requiredGeneration: before.authorityGeneration });
              manifest = AuthorityBackupManifestSchema.parse(report.manifests[0]);
            } catch (error) { primary = { error }; }
            if (primary !== undefined && hasUnprovedSourceClosure(primary.error)) {
              admission.retainSourceClosure(primary.error); retainUnprovedSourceOwners(primary.error, { admission: { admission, source }, restore }); throw primary.error;
            }
            try { source.close(); }
            catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { admission: { admission, source }, restore }); }
            if (primary !== undefined) throw primary.error;
          }
        }
        if (manifest === undefined) fail("profile-control-upgrade-backup-recovery-required");
        const verified = await verifyBackupManifestAtPath(admission, join(directory, `${manifest.backupFileName}.manifest.json`));
        const copy = admission.verifiedReadOnlyCopy(verified.backupPath, manifest.sha256);
        try {
          const observed = inspectAuthorityBackupReadOnly(copy, verified.backupPath, sourceInfo.schemaVersion);
          if (observed.installationId !== sourceInfo.binding.installationId || observed.profileId !== sourceInfo.binding.profileId
            || observed.schemaVersion !== before.schemaVersion || observed.authorityGeneration !== before.authorityGeneration
            || observed.authorityContentFingerprint !== before.authorityContentFingerprint) fail("profile-control-upgrade-backup-source-mismatch");
        } finally { copy.release(); }
        inventory.revalidate();
        const verifiedBackup = { manifest: AuthorityBackupManifestSchema.parse(manifest), manifestSha256: controlUpgradeFile(verified.manifestPath, 64_000).digest };
        receipt = ControlUpgradeReceiptSchema.parse({ ...receipt, backups: receipt.backups.map(backup => backup.profileId === row.profileId ? { ...backup, verifiedBackup } : backup) });
        withInstallationControl(control, () => { held(); const currentReceipt = ControlUpgradeReceiptSchema.parse(receipt); validateStoppedControlUpgrade(control, locator, currentReceipt); atomicJson(intentPath, currentReceipt); });
      }
      receipt = ControlUpgradeReceiptSchema.parse({ ...receipt, phase: "publishing" });
      withInstallationControl(control, () => { held(); const currentReceipt = ControlUpgradeReceiptSchema.parse(receipt); validateStoppedControlUpgrade(control, locator, currentReceipt); atomicJson(intentPath, currentReceipt); });
      for (const row of receipt.credentials) {
        const entry = inventoryProofs.get(row.profileId);
        if (entry === undefined) fail("profile-control-upgrade-inventory-required");
        publishStoppedCanonicalCredentials(readStoppedCredentialConversion(entry.proof, entry.claim).admission, entry.claim, row.plan);
      }
      withInstallationControl(control, () => finish(receipt, publicationProofs(receipt.document.profiles)));
      return { state: "upgraded" as const, runtimeAccess: prepared.runtimeAccess, profileCount: receipt.document.profiles.length, receiptId: receipt.operationId };
      } catch (error) {
        if (hasUnprovedSourceClosure(error)) { lease.retainSourceClosure(error); retainUnprovedSourceOwners(error, { admission: { lease, inventoryProofs, inventorySnapshots }, restore }); }
        throw error;
      }
    },
    release() {
      try {
        for (const snapshot of inventorySnapshots) {
          snapshot.dispose();
          inventorySnapshots.delete(snapshot);
        }
        for (const entry of inventoryProofs.values()) releaseStoppedCredentialConversion(entry.proof);
        inventoryProofs.clear(); issuedInventoryClaims.clear();
        if (ownsLease) { restore.release(); lease.release(); }
      } catch (error) {
        if (hasUnprovedSourceClosure(error)) {
          lease.retainSourceClosure(error);
          retainUnprovedSourceOwners(error, { admission: { lease, inventorySnapshots, inventoryProofs }, restore });
          throw error;
        }
        const failure = retainAuthoritySourceClosure([error], { admission: { lease, inventorySnapshots, inventoryProofs }, restore });
        lease.retainSourceClosure(failure);
        throw failure;
      }
    },
  });
}
