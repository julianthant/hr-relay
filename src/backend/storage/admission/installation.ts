import { appendProfileSelectionChange } from "../events/local-debug-log.js";
import { FileIdentitySchema } from "../../../models/storage/file-identity.js";
import { fileStatus, descriptorStatus, privateFileNumber, fileModified, fileChanged, fileTimestampMilliseconds } from "../file-identity.js";
import { assertMaintenanceCustodyAvailable } from "../maintenance/custody-availability.js";
import { assertAccountDeletionRetainedBackups, AccountDeletionRefusedError, captureAccountDeletion, publishAccountDeletion, resumeAccountDeletion } from "../maintenance/account-deletion.js";
import { createHash,randomBytes,randomUUID } from "node:crypto";
import {
closeSync,constants,existsSync,fstatSync,
lstatSync,openSync,readFileSync,
readdirSync,realpathSync,renameSync,rmSync,rmdirSync,unlinkSync,writeFileSync
} from "node:fs";
import { basename,dirname,isAbsolute,join,relative,resolve } from "node:path";
import { z } from "zod";
import { ConfigSchema } from "../../../models/config/schema.js";
import { LogoutOperationSchema,ProfileDatabaseBindingSchema,ProfileOnboardingCompletionSchema,ProfileRegistryDocumentSchema,ProfileRegistryRowSchema,ProfileVerifierDocumentSchema,SignUpOperationSchema,advanceProfileRegistryDocument,assertFinishedProfileOnboarding,deriveProfileNames,type ProfileOperation,type ProfileRegistryDocument,type ProfileSelectionChangeReason } from "../../../models/profiles/profile.js";
import { CanonicalCredentialConversionPlanSchema,CanonicalCredentialHeadSchema,CanonicalCredentialOperationSchema,CanonicalCredentialPublicationSourceSchema,CanonicalCredentialRestoreSnapshotSchema,CredentialMaintenanceHold,captureCanonicalCredentialStartupLocks,publishStoppedCanonicalCredentials,type CanonicalCredentialConversionPlan } from "../configuration/canonical-credential-store.js";
import { credentialKeyCustody } from "../configuration/credential-key-custody.js";
import { sameDirectory, fileIdentityObservation, capturePriorPrivateFileLock,noSymlinkAncestry,outermostOperationProof,readPrivateFile,removeExactPath,unpublishedDraftAbortMembership,withOperationProof,withPrivateFileLock,type PrivateFileLock,type DirectoryIdentity } from "../configuration/credential-safe-file.js";
import { emailKey,passwordMatches } from "../configuration/synthetic-verifier.js";
import { createProfileVerifiers,preparedProfileVerifierPepperWitness,verifyPreparedProfileVerifier } from "../configuration/verifier-store.js";
import { SourceRecordSchema,file as backupFile,hash as backupHash,profileAuthorityFileWitnesses,retainedStorageBackup } from "../maintenance/existing-data-backup-files.js";
import { FlatStartCleanIntentSchema,assertFlatStartCleanCredentials,assertFlatStartCleanFiles,flatStartCleanPlan,readFlatStartCleanSource,type FlatStartCleanIntent } from "../maintenance/flat-start-clean.js";
import type { StoppedBackupClosure } from "../maintenance/profile-inventory.js";
import { createPrivateDirectory,fsyncPath,privatePathRejects,replacePrivateFile,writePrivateStage } from "../private-path.js";
import { AuthoritySourceClosureUnprovedError,assertSourceClosuresProved,hasUnprovedSourceClosure,rememberUnprovedSourceClosure,retainAuthoritySourceClosure,retainUnprovedSourceOwners } from "../source-closure.js";
import { AuthorityDatabase,type StartupLogoutConversion } from "../sqlite/authority-database.js";
import { inspectAuthorityBackupReadOnly,openAuthorityBackupSourceReadOnly } from "../sqlite/backup-inspection.js";
import { AuthorityBackupService,verifyBackupManifestAtPath } from "../sqlite/backup-service.js";
import { assertCanonicalProfileBinding,assertProfileRestoreDatabaseBinding,readProfileDatabaseBinding } from "../sqlite/profile-local-databases.js";
import { AuthorityBackupManifestSchema } from "../sqlite/recovery-contracts.js";
import { OPENABLE_AUTHORITY_SCHEMA_VERSIONS } from "../sqlite/migrations.js";
import { requireRuntimeAdmission } from "./admission-identity.js";
import type { RuntimeAdmission, StartupRegistrationProof } from "./admission.js";
import { OfflineMaintenanceOperationUnavailableError,RuntimeLifetimeLock,WorkerRuntimeLifetimeLock,assertOfflineMaintenanceOperation,isOfflineMaintenanceOperationActive,type OfflineMaintenanceOperation } from "./lifetime-lock.js";
import { assertNoOldBuildRuntimeArtifacts,assertNoSymlinkComponents,lstatMaybe } from "./process-root.js";

import { systemClock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { encodePrivate } from "../../../rules/validation/private-equal.js";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { BrowserRootsSchema,StoppedBrowserRootsV1Schema,parseStoppedBrowserRootUpgradeSource,type BrowserRootsDocument,type StoppedBrowserRootsDocument } from "../browser-root-contract.js";
import type { BrowserProfileProbeFactory } from "../browser-roots.js";
import { StoppedCredentialErasureHeadSchema as CredentialErasureHeadSchema,StoppedCredentialKeyWitnessSchema as CredentialKeyWitnessSchema,StoppedDuoContinuityRowSchema as DuoContinuityRowSchema,readStoppedCredentialConversion,releaseStoppedCredentialConversion,type StoppedDuoContinuityRow as DuoContinuityRow,type StoppedControlCredentialAttestation } from "../configuration/credential-conversion.js";
import { captureCanonicalProfileBinding } from "../sqlite/profile-local-databases.js";
import { createReadonlyAuthoritySnapshot } from "../sqlite/readonly-authority-snapshot.js";

import { FixedLayoutIntentSchema,assertFixedLayoutConfiguring,assertFixedLayoutEntries,assertFixedLayoutMove,fixedLayoutBindingEntries,fixedLayoutEntries,fixedLayoutSourceFence,publishFixedLayoutIntent,readFixedLayoutIntent,type FixedLayoutIntent } from "../maintenance/fixed-layout.js";
import { restoreRetainedFilesDigest, assertRestoreRootMembership } from "../maintenance/automatic-restore-files.js";
import { proveProfileRootsUnused } from "../maintenance/process-closure.js";
import { verifyStoppedBackupManifestAtPath } from "../sqlite/backup-service.js";
import { offlineMaintenanceWorkspace } from "./lifetime-lock.js";


const ProfileOperationSchema = z.union([SignUpOperationSchema, LogoutOperationSchema]);
const ProfileOperationMutationSchema = z.union([z.strictObject({ kind: z.literal("write"), operation: ProfileOperationSchema }), z.strictObject({ kind: z.literal("delete"), operationId: z.uuid() })]);
const ProfileErasureHeadSchema = z.lazy(() => z.strictObject({ profileId: z.uuid(), originOperationId: z.uuid(), head: CredentialErasureHeadSchema, credentialKey: CredentialKeyWitnessSchema.optional() }));
const PriorRestoreFileBindingSchema = z.strictObject({ dev: z.number().int().nonnegative(), ino: z.number().int().nonnegative(),
  byteSize: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/u) });
const CompletedRestoreCustodySchema = z.strictObject({ operationId: z.uuid(), profile: ProfileDatabaseBindingSchema,
  sourceGeneration: z.number().int().nonnegative(), outcome: z.enum(["unchanged", "replaced"]),
  suspect: z.strictObject({ relativePath: z.string().min(1), file: PriorRestoreFileBindingSchema }),
  companions: z.array(z.strictObject({ suffix: z.enum(["-wal", "-shm"]), file: PriorRestoreFileBindingSchema })).max(2)
    .refine(rows => new Set(rows.map(row => row.suffix)).size === rows.length),
});
type CompletedRestoreCustody = z.infer<typeof CompletedRestoreCustodySchema>;
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
const StoppedCanonicalProfileContinuitySchema = z.strictObject({ schemaVersion: z.literal(5), installationId: z.uuid(),
  digest: z.string().regex(/^[0-9a-f]{64}$/u), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  operations: z.array(z.strictObject({ operationId: z.uuid(), digest: z.string().regex(/^[0-9a-f]{64}$/u) })),
  completedRestores: z.array(CompletedRestoreCustodySchema).max(10_000).refine(rows => new Set(rows.map(row => row.operationId)).size === rows.length) })
  .refine(value => value.completedRestores.every(row => row.profile.installationId === value.installationId));
const StoppedRestoreProfileContinuitySchema = z.strictObject({ ...StoppedCanonicalProfileContinuitySchema.shape, schemaVersion: z.literal(6) })
  .refine(value => value.completedRestores.every(row => row.profile.installationId === value.installationId));
const StoppedProfileContinuitySchema = z.union([StoppedPriorProfileContinuitySchema, StoppedCurrentProfileContinuitySchema, StoppedLogicalProfileContinuitySchema, StoppedCanonicalProfileContinuitySchema, StoppedRestoreProfileContinuitySchema]);
const ProfileContinuitySchema = z.strictObject({ schemaVersion: z.literal(7),
  installationId: StoppedCanonicalProfileContinuitySchema.shape.installationId, digest: StoppedCanonicalProfileContinuitySchema.shape.digest,
  revision: StoppedCanonicalProfileContinuitySchema.shape.revision, generation: StoppedCanonicalProfileContinuitySchema.shape.generation,
  operations: StoppedCanonicalProfileContinuitySchema.shape.operations });
const RestoreFileBindingSchema = z.strictObject({ byteSize: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/u) });
const ProfileAuthorityFilesSchema = z.array(z.strictObject({ suffix: z.enum(["", "-wal", "-shm", "-journal"]),
  file: CanonicalCredentialPublicationSourceSchema.shape.head.optional() }));
const DraftMembershipSchema = z.array(z.strictObject({ path: z.string(), directory: z.boolean(), ...FileIdentitySchema.shape, size: z.number(),
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
const LocatorSchema = z.strictObject({ schemaVersion: z.literal(3), installationId: z.uuid(), generation: z.literal(0) });
const RuntimeLocatorSchema = LocatorSchema.extend(PairSchema.shape);
const DefaultLayoutSourceLocatorSchema = z.discriminatedUnion("schemaVersion", [
  z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(), generation: z.literal(0), ...PairSchema.shape }),
  z.strictObject({ schemaVersion: z.literal(2), installationId: z.uuid(), generation: z.literal(0), ...PairSchema.shape,
    stateRootGeneration: z.literal(0), artifactRootGeneration: z.literal(0) }),
  LocatorSchema,
]);
const defaultLayoutSources = new Map<string, RuntimeLifetimeLock>();

export async function withDefaultLayoutSource<Result>(workspace: string, lifetime: RuntimeLifetimeLock,
  run: () => Promise<Result>): Promise<Result> {
  lifetime.assertExclusiveWorkspaceTarget(workspace);
  if (defaultLayoutSources.has(workspace)) fail("fixed-layout-source-busy");
  defaultLayoutSources.set(workspace, lifetime);
  try { return await run(); }
  finally { defaultLayoutSources.delete(workspace); }
}

const MarkerCommon = { installationId: z.uuid(), workspace: z.string(), role: z.enum(["state", "artifact"]), generation: z.number().int().nonnegative() };
const MarkerSchema = z.discriminatedUnion("schemaVersion", [
  z.strictObject({ schemaVersion: z.literal(1), ...MarkerCommon }),
  z.strictObject({ schemaVersion: z.literal(2), ...MarkerCommon, operationId: z.uuid() }),
]);
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const ControlUpgradeFileSchema = FileIdentitySchema.extend({ digest: DigestSchema });

const ControlUpgradeCredentialPlansSchema = z.array(z.strictObject({ profileId: z.uuid(), plan: CanonicalCredentialConversionPlanSchema })).max(10_000);
const ControlUpgradeBackupsSchema = z.array(z.strictObject({ profileId: z.uuid(), directory: z.string().regex(/^[0-9a-f-]{36}\.[0-9a-f-]{36}\.authority$/u),
  verifiedBackup: z.strictObject({ manifest: AuthorityBackupManifestSchema, manifestSha256: DigestSchema }).optional() })).max(10_000);
const RetainedControlUpgradeEntrySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("file"), name: z.string().regex(/^[0-9a-f-]{36}\.(?:registry|control|marker)\.before\.json$|^[0-9a-f-]{36}\.receipt\.json$/u), file: ControlUpgradeFileSchema }),
  z.strictObject({ kind: z.literal("authority-directory"), name: z.string().regex(/^[0-9a-f-]{36}\.[0-9a-f-]{36}\.authority$/u),
    ...FileIdentitySchema.shape,
    files: z.array(z.strictObject({ name: z.string().regex(/^authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite(?:\.manifest\.json)?$/u), file: ControlUpgradeFileSchema })).length(2) }),
]);
const ControlUpgradeCommonSchema = z.strictObject({ schemaVersion: z.literal(3), operationId: z.uuid(), installationId: z.uuid(),
  browsers: z.lazy(() => BrowserRootsSchema),
  prior: StoppedProfileContinuitySchema, current: ProfileContinuitySchema,
  priorDocument: StoppedProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema,
  priorRegistry: ControlUpgradeFileSchema, registryBackup: ControlUpgradeFileSchema, registryStage: ControlUpgradeFileSchema,
  priorControl: ControlUpgradeFileSchema, priorMarker: ControlUpgradeFileSchema,
  controlBackup: ControlUpgradeFileSchema, markerBackup: ControlUpgradeFileSchema,
  controlStage: ControlUpgradeFileSchema, markerStage: ControlUpgradeFileSchema,
  retained: z.array(RetainedControlUpgradeEntrySchema),
  sourceEvidence: z.string().max(16 * 1024 * 1024) });

const ControlUpgradeReceiptSchema = z.discriminatedUnion("phase", [
  ControlUpgradeCommonSchema.extend({ phase: z.literal("preparing"), credentials: z.tuple([]), backups: z.tuple([]) }),
  ControlUpgradeCommonSchema.extend({ phase: z.enum(["backing-up", "publishing"]), browserStage: ControlUpgradeFileSchema, credentials: ControlUpgradeCredentialPlansSchema, backups: ControlUpgradeBackupsSchema }),
]);
const PredecessorControlUpgradeCommonSchema = ControlUpgradeCommonSchema.extend({ browsers: StoppedBrowserRootsV1Schema });
const StoppedControlUpgradeReceiptSchema = z.union([ControlUpgradeReceiptSchema, z.discriminatedUnion("phase", [
  PredecessorControlUpgradeCommonSchema.extend({ phase: z.literal("preparing"), credentials: z.tuple([]), backups: z.tuple([]) }),
  PredecessorControlUpgradeCommonSchema.extend({ phase: z.enum(["backing-up", "publishing"]), browserStage: ControlUpgradeFileSchema, credentials: ControlUpgradeCredentialPlansSchema, backups: ControlUpgradeBackupsSchema }),
])]);
type StoppedControlUpgradeReceipt = z.infer<typeof StoppedControlUpgradeReceiptSchema>;
const GenerationSchema = z.number().int().nonnegative();
const ProfileRestoreContextSchema = z.lazy(() => z.strictObject({ binding: ProfileDatabaseBindingSchema, continuity: ProfileContinuitySchema,
  credentials: CanonicalCredentialRestoreSnapshotSchema }));
export type ProfileRestoreContext = z.infer<typeof ProfileRestoreContextSchema>;
export const AuthorityRestoreInputSchema = z.strictObject({ operationId: z.uuid(), profile: ProfileRestoreContextSchema,
  authorityPath: z.string().min(1), stagedPath: z.string().min(1), suspectPath: z.string().min(1),
  manifestPath: z.string().min(1), manifestSha256: DigestSchema,
  backupPath: z.string().min(1), backupSha256: DigestSchema,
  sourceDatabaseIdentity: DigestSchema, authorityGeneration: GenerationSchema,
  authorityContentFingerprint: DigestSchema,
  browserMembershipDigest: DigestSchema, retainedFilesDigest: DigestSchema, unresolvedWriteDigest: DigestSchema, backupTime: z.iso.datetime(), restoredAt: z.iso.datetime(),
  live: RestoreFileBindingSchema, staged: RestoreFileBindingSchema, suspect: RestoreFileBindingSchema,
  companions: z.array(z.strictObject({ suffix: z.enum(["-wal", "-shm"]), binding: RestoreFileBindingSchema, suspect: RestoreFileBindingSchema })).max(2) });
export const AuthorityRestoreJournalSchema = z.strictObject({ schemaVersion: z.literal(3), phase: z.literal("restoring"),
  installationId: z.uuid(), source: RuntimeLocatorSchema, restoreAdmissionId: z.uuid(),
  restore: AuthorityRestoreInputSchema,
  invalidation: z.strictObject({ priorDocument: ProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema, continuity: ProfileContinuitySchema }).optional() });
export type AuthorityRestoreInput = z.infer<typeof AuthorityRestoreInputSchema>;
export type AuthorityRestoreVerification = Readonly<{ authorityGeneration: number; authorityContentFingerprint: string }>;
export type AuthorityRestoreVerifier = () => AuthorityRestoreVerification;
const JournalSchema = z.discriminatedUnion("phase", [
  AuthorityRestoreJournalSchema,
  z.strictObject({ schemaVersion: z.literal(1), phase: z.literal("adopting"), installationId: z.uuid() }),

]);
export type RuntimePair = z.infer<typeof PairSchema>;
export type RuntimeLocator = z.infer<typeof RuntimeLocatorSchema>;
export type ExistingAuthorityEvidence = Readonly<{ kind: "verified-existing"; pair: RuntimePair; authorityGeneration: number; databaseIdentity: string }>;
export type AuthorityVerifier = (pair: RuntimePair) => ExistingAuthorityEvidence;
export type FreshInitializationWitness = Readonly<{ installationId: string; pair: RuntimePair; assertHeld(): void }>;
export type FreshInitializer = (witness: FreshInitializationWitness) => void;
export type InstallationLease = Readonly<{ retainSourceClosure(error: unknown): void; lifetime: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock; mode: "shared" | "exclusive"; locator: RuntimeLocator;
  assertHeld(): void; assertFixedProcessLockRoot(workspaceRoot: string, processLockRoot: string): void;
  beginOfflineMaintenance(): OfflineMaintenanceOperation;
  offlineMaintenanceOperation(): OfflineMaintenanceOperation;
  assertOfflineMaintenance(operation: OfflineMaintenanceOperation): void;
  readProfileRegistry(): ProfileRegistryDocument;
  requiresFlatStoreMigration(): boolean;
  flatStoreMigrationPending(): boolean;
  readFlatStartCleanIntent(): FlatStartCleanIntent | undefined;
  prepareFlatStartClean(restore: OfflineMaintenanceOperation, timing: FlatStartCleanIntent["timing"]): void;
  startCleanFlatStore(restore: OfflineMaintenanceOperation, backup: RuntimeAdmission, closure: StoppedBackupClosure): Promise<void>;
  deleteProfileAccount(profileId: string, epoch: number): void;
  abortUnpublishedProfile(operation: z.infer<typeof SignUpOperationSchema>, head?: z.infer<typeof CanonicalCredentialPublicationSourceSchema.shape.head>): boolean;
  reclassifyIncompleteProfile(profile: RuntimeAdmission): void;
  resumeIncompleteProfileDraft(profileId: string, restore: OfflineMaintenanceOperation): boolean;
  assertColdPendingLogout(operation: z.infer<typeof LogoutOperationSchema>): void;
  capturePendingProfileLogout(operation: z.infer<typeof LogoutOperationSchema>): Readonly<{ assertHeld(publication?: ProfilePublicationRead): void }>;
  readStartupProfileIds(): readonly string[];
  captureStoppedProfileUpgrade(profileId: string, purpose: "manual" | "startup" | "layout"): Readonly<{
    assertHeld(): void; logout?: z.infer<typeof LogoutOperationSchema>;
    settleLogout(conversion: StartupLogoutConversion): void;
  }>;
  publishProfileRegistration(operation: z.infer<typeof SignUpOperationSchema>, profile: RuntimeAdmission, proof?: StartupRegistrationProof): void;
  publishProfileRegistry(expected: ProfileRegistryDocument, document: ProfileRegistryDocument, reason?: ProfileSelectionChangeReason): void;
  beginProfileSignUp(fields: Omit<z.infer<typeof SignUpOperationSchema>, "operationId" | "profileId" | "commandId" | "writeId" | "schemaVersion" | "kind" | "phase" | "onboarding" | "credentials">): z.infer<typeof SignUpOperationSchema>;
  publishProfileOperation(operation: ProfileOperation | string): void;
  completeStoppedLogout(admission: RuntimeAdmission, operation: z.infer<typeof LogoutOperationSchema>, restore: OfflineMaintenanceOperation, source: AuthorityDatabase): void;
  publishStoppedLogoutSettlement(admission: RuntimeAdmission, expected: z.infer<typeof LogoutOperationSchema>, next: z.infer<typeof LogoutOperationSchema>, restore: OfflineMaintenanceOperation, source: AuthorityDatabase): void;
  readInstallationContext(): Readonly<{ workspace: string; locator: RuntimeLocator }>;
  release(): void }>;
export type ExclusiveInstallationLease = InstallationLease & Readonly<{
  captureProfileRestore(profileId: string, credentials: z.infer<typeof CanonicalCredentialRestoreSnapshotSchema>): ProfileRestoreContext;
  assertProfileRestoreHeld(input: AuthorityRestoreInput, restore: OfflineMaintenanceOperation): void;
  readAuthorityRestore(operationId: string): AuthorityRestoreInput;
  beginAuthorityRestore(input: AuthorityRestoreInput, restore: OfflineMaintenanceOperation): void;
  settleAuthorityRestore(input: AuthorityRestoreInput, verify: AuthorityRestoreVerifier, restore: OfflineMaintenanceOperation): void;
}>;

const CONTROL = ".tracker/control";
const MARKER = ".runtime-owner.json";
const FENCE = ".runtime-source-fence.json";
export const RUNTIME_ROOT_AUTHORITY_ENTRY_NAMES = Object.freeze([MARKER,FENCE]);

const issuedLeases = new WeakSet<object>();

export type FixedLayoutPublication = Readonly<{ operationId: string }>;
const fixedLayoutPublications = new WeakMap<FixedLayoutPublication, { lifetime: RuntimeLifetimeLock; intent: FixedLayoutIntent; consumed: boolean }>();

export function fixedLayoutBindings(lease: InstallationLease, targetWorkspace: string): FixedLayoutIntent["bindings"] {
  assertInstallationLease(lease); lease.assertHeld();
  const context = lease.readInstallationContext(), control = join(context.workspace, CONTROL);
  return [
    ...(["state", "artifact"] as const).map(role => ({ role, content: `${JSON.stringify({
      ...readStrict(markerPath(role === "state" ? lease.locator.stateRoot : lease.locator.artifactRoot), MarkerSchema), workspace: targetWorkspace,
    })}\n` })),
    { role: "installation", content: `${JSON.stringify({ ...readStrict(join(control, "installation.json"), InstallationSchema), workspace: targetWorkspace })}\n` },
    { role: "locator", content: `${JSON.stringify(LocatorSchema.parse({ schemaVersion: 3, installationId: lease.locator.installationId, generation: 0 }))}\n` },
  ];
}

function issueFixedLayoutPublication(lifetime: RuntimeLifetimeLock, intent: FixedLayoutIntent): FixedLayoutPublication {
  const proof = Object.freeze({ operationId: intent.operationId });
  fixedLayoutPublications.set(proof, { lifetime, intent: readFixedLayoutIntent(intent.targetWorkspace) ?? (() => { throw new Error("fixed-layout-journal-missing"); })(), consumed: false });
  return proof;
}

export async function prepareFixedLayoutPublication(lease: InstallationLease, machine: RuntimeAdmission, operation: OfflineMaintenanceOperation,
  input: FixedLayoutIntent, sources: readonly Readonly<{ admission: RuntimeAdmission; closure: StoppedBackupClosure }>[]): Promise<FixedLayoutPublication> {
  const { assertStoppedBackupClosure } = await import("../maintenance/profile-inventory.js");
  assertInstallationLease(lease); lease.assertHeld(); lease.assertOfflineMaintenance(operation);
  requireRuntimeAdmission(machine).assertExclusive();
  assertMaintenanceCustodyAvailable("layout-migration");
  if (!(lease.lifetime instanceof RuntimeLifetimeLock)) fail("fixed-layout-root-required");
  const intent = FixedLayoutIntentSchema.parse(input), context = lease.readInstallationContext(), profiles = machine.readStartupProfileIds();
  if (intent.phase !== "moving" || intent.sourceWorkspace !== context.workspace || intent.operationId !== operation.operationId
    || intent.installationId !== lease.locator.installationId || sources.length !== profiles.length
    || intent.profiles.length !== profiles.length
    || canonicalJsonStringify(intent.bindings) !== canonicalJsonStringify(fixedLayoutBindings(lease, intent.targetWorkspace))) fail("fixed-layout-source-unbound");
  for (const name of ["journal.json", "profile-publication.json", "flat-start-clean.json", "profile-control-upgrade.json"]) if (lstatMaybe(join(context.workspace, CONTROL, name))) fail("fixed-layout-source-operation-pending");
  for (const profileId of profiles) {
    const source = sources.filter(source => source.admission.profileBinding.profileId === profileId), plan = intent.profiles.find(plan => plan.profileId === profileId);
    if (source.length !== 1 || source[0] === undefined || plan === undefined) fail("fixed-layout-profile-membership-mismatch");
    source[0].admission.assertReadyStoppedProfileLayoutOwner(machine);
    assertStoppedBackupClosure(source[0].closure, source[0].admission, operation);
    const manifestPath = join(source[0].admission.stateRoot, "backups", "authority", `${plan.backupFileName}.manifest.json`);
    const backup = verifyStoppedBackupManifestAtPath(source[0].admission, manifestPath);
    if (backup.manifest.installationId !== intent.installationId || backup.manifest.profileId !== profileId
      || backup.manifest.sha256 !== plan.backupSha256 || backupHash(backupFile(manifestPath, "managed data").bytes) !== plan.backupManifestSha256
      || backup.manifest.authorityGeneration !== plan.preAuthorityGeneration
      || backup.manifest.authorityContentFingerprint !== plan.preAuthorityContentFingerprint) fail("fixed-layout-backup-changed");
  }
  proveProfileRootsUnused([lease.locator.stateRoot]);
  assertFixedLayoutEntries(intent.data, fixedLayoutEntries(lease.locator.stateRoot));
  assertFixedLayoutEntries(intent.control, fixedLayoutEntries(join(context.workspace, CONTROL)));
  lease.assertOfflineMaintenance(operation); publishFixedLayoutIntent(operation, intent);
  assertFixedLayoutMove(intent);
  return issueFixedLayoutPublication(lease.lifetime, intent);
}

export function recoverFixedLayoutPublication(targetWorkspace: string, lifetime: RuntimeLifetimeLock): FixedLayoutPublication {
  const intent = readFixedLayoutIntent(targetWorkspace);
  if (intent === undefined || intent.phase === "complete") fail("fixed-layout-recovery-missing");
  lifetime.assertExclusiveWorkspaceTarget(intent.sourceWorkspace);
  assertMaintenanceCustodyAvailable("layout-migration");
  const operation = lifetime.beginOfflineMaintenance(intent.sourceWorkspace);
  let retain = false;
  try {
    assertNoOldBuildRuntimeArtifacts(intent.sourceWorkspace);
    if (intent.phase === "moving") assertFixedLayoutMove(intent); else assertFixedLayoutConfiguring(intent);
    proveProfileRootsUnused([join(intent.sourceWorkspace, rebuildRuntimeIsolation.stateRoot), join(targetWorkspace, rebuildRuntimeIsolation.stateRoot)]);
    return issueFixedLayoutPublication(lifetime, intent);
  } catch (error) {
    retain = hasUnprovedSourceClosure(error);
    if (retain) {
      const failure = retainAuthoritySourceClosure([error], { restore: operation });
      lifetime.retainSourceClosure(failure); throw failure;
    }
    throw error;
  } finally { if (!retain) operation.release(); }
}

function moveFixedLayoutFiles(operation: OfflineMaintenanceOperation, intent: FixedLayoutIntent): FixedLayoutIntent {
  if (offlineMaintenanceWorkspace(operation) !== intent.sourceWorkspace || intent.phase !== "moving"
    || canonicalJsonStringify(readFixedLayoutIntent(intent.targetWorkspace)) !== canonicalJsonStringify(intent)) throw new Error("fixed-layout-move-unbound");
  publishFixedLayoutIntent(operation, intent);
  const source = join(intent.sourceWorkspace, ".tracker"), target = join(intent.targetWorkspace, ".tracker");
  const held = () => { operation.assertHeld(); assertFixedLayoutMove(intent); proveProfileRootsUnused([join(source, "data"), join(target, "data")]); operation.assertHeld(); };
  held();
  if (lstatSync(join(target, "data"), { throwIfNoEntry: false }) === undefined) {
    renameSync(join(source, "data"), join(target, "data")); fsyncPath(source); fsyncPath(target);
  }
  held();
  if (lstatSync(join(source, "data"), { throwIfNoEntry: false }) === undefined) {
    createPrivateDirectory(join(source, "data"), { mode: 0o700 }); fsyncPath(source);
  }
  const fence = join(source, "data", ".runtime-source-fence.json");
  if (lstatSync(fence, { throwIfNoEntry: false }) === undefined) {
    if (readdirSync(join(source, "data")).length !== 0) throw new Error("fixed-layout-source-fence-unknown");
    writePrivateStage(fence, Buffer.from(fixedLayoutSourceFence(intent))); fsyncPath(dirname(fence));
  }
  held();
  if (lstatSync(join(target, "control"), { throwIfNoEntry: false }) === undefined) {
    renameSync(join(source, "control"), join(target, "control")); fsyncPath(source); fsyncPath(target);
  }
  held();
  for (const binding of fixedLayoutBindingEntries(intent)) {
    held(); const path = join(target, binding.tree, binding.path);
    if (backupHash(backupFile(path, "managed data").bytes) === binding.after) continue;
    const stage = join(dirname(path), `.fixed-layout-${intent.operationId}.stage`);
    if (lstatSync(stage, { throwIfNoEntry: false }) === undefined) writePrivateStage(stage, Buffer.from(binding.content));
    else if (backupHash(backupFile(stage, "managed data").bytes) !== binding.after) throw new Error("fixed-layout-binding-stage-changed");
    replacePrivateFile(stage, path); fsyncPath(dirname(path));
  }
  operation.assertHeld(); assertFixedLayoutMove(intent, true);
  return publishFixedLayoutIntent(operation, { ...intent, phase: "configuring" });
}


export function consumeFixedLayoutPublication(proof: FixedLayoutPublication, lifetime: RuntimeLifetimeLock): string {
  const source = fixedLayoutPublications.get(proof);
  if (source === undefined || source.lifetime !== lifetime || source.consumed) fail("fixed-layout-publication-unissued");
  const intent = source.intent;
  lifetime.assertExclusiveWorkspaceTarget(intent.sourceWorkspace);
  assertMaintenanceCustodyAvailable("layout-migration");
  if (activeAdmissions(join(intent.sourceWorkspace, CONTROL)).length !== 0 || activeAdmissions(join(intent.targetWorkspace, CONTROL)).length !== 0
    || canonicalJsonStringify(readFixedLayoutIntent(intent.targetWorkspace)) !== canonicalJsonStringify(intent)) fail("fixed-layout-publication-changed");
  const operation = lifetime.beginOfflineMaintenance(intent.sourceWorkspace);
  let retain = false;
  try {
    assertNoOldBuildRuntimeArtifacts(intent.sourceWorkspace);
    if (intent.phase === "moving") moveFixedLayoutFiles(operation, intent);
    else if (intent.phase !== "configuring") fail("fixed-layout-publication-phase-invalid");
    const current = readFixedLayoutIntent(intent.targetWorkspace);
    if (current === undefined || current.phase !== "configuring") fail("fixed-layout-publication-missing");
    assertFixedLayoutConfiguring(current);
    proveProfileRootsUnused([join(intent.sourceWorkspace, rebuildRuntimeIsolation.stateRoot), join(intent.targetWorkspace, rebuildRuntimeIsolation.stateRoot)]);
    source.consumed = true;
  } catch (error) {
    retain = hasUnprovedSourceClosure(error);
    if (retain) {
      const failure = retainAuthoritySourceClosure([error], { restore: operation });
      lifetime.retainSourceClosure(failure); throw failure;
    }
    throw error;
  } finally { if (!retain) operation.release(); }
  return intent.targetWorkspace;
}

function fail(reason: string): never { throw new Error(`runtime-control: ${reason}`); }
function epochsOf(_locator: RuntimeLocator): { state: number; artifact: number } {
  return { state: 0, artifact: 0 };
}
function equalPair(left: RuntimePair, right: RuntimePair): boolean {
  return left.stateRoot === right.stateRoot && left.artifactRoot === right.artifactRoot;
}
function fixedLockRoot(workspace: string): string { return resolve(workspace, rebuildRuntimeIsolation.processLockRoot); }
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
function assertKnownDefaults(workspace: string, pair: RuntimePair): void {
  validatePair(workspace, pair);
  if (pair.stateRoot !== resolve(workspace, rebuildRuntimeIsolation.stateRoot) || pair.artifactRoot !== resolve(workspace, rebuildRuntimeIsolation.artifactRoot)) fail("first adoption requires the known default root pair");
}
function privateDirectory(path: string): void {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || privatePathRejects(path, stat, "directory-0700")) fail(`unsafe directory ${path}`);
}
function dataDirectory(path: string): void {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isDirectory() || privatePathRejects(path, stat, "owner-write-only")) fail(`unsafe data root ${path}`);
}
function privateFile(path: string): void {
  const stat = lstatSync(path, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n || privatePathRejects(path, stat, "file-0600")) fail(`unsafe file ${path}`);
}
function readStrict<T>(path: string, schema: z.ZodType<T>): T {
  privateFile(path);
  const expected = lstatSync(path, { bigint: true });
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let result: { value: T } | undefined;
  let primary: { error: unknown } | undefined;
  let descriptorIdentity = expected;
  try {
    const stat = fstatSync(fd, { bigint: true }); descriptorIdentity = stat;
    if (!stat.isFile() || stat.nlink !== 1n || privatePathRejects(path, stat, "file-0600")) fail(`unsafe file ${path}`);
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
function prepareRegistryWrite(locator: RuntimeLocator, before: ProfileRegistryDocument, document: ProfileRegistryDocument,
  reason: ProfileSelectionChangeReason): () => void {
  const changed = before.activeProfileId !== document.activeProfileId;
  const change = { stateRoot: locator.stateRoot, reason, oldGeneration: before.sessionGeneration, newGeneration: document.sessionGeneration };
  if (changed) appendProfileSelectionChange({ ...change, now: systemClock.now(), phase: "started" });
  return () => {
    atomicJson(join(locator.stateRoot, "machine", "profiles.json"), document);
    if (changed) appendProfileSelectionChange({ ...change, now: systemClock.now(), phase: "settled" });
  };
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
  if (!lstatMaybe(path)) { createPrivateDirectory(path, { recursive: true, mode: 0o700 }); fsyncPath(resolve(path, "..")); }
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
function installMarker(root: string, installationId: string, workspace: string, role: "state" | "artifact", generation: number,
  operationId?: string): void {
  ensureRoot(root);
  if (lstatMaybe(markerPath(root))) fail(`root already owned: ${role}`);
  atomicJson(markerPath(root), operationId === undefined
    ? { schemaVersion: 1, installationId, workspace, role, generation }
    : { schemaVersion: 2, installationId, workspace, role, generation, operationId }, "data");
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
function equalLocator(left: RuntimeLocator, right: RuntimeLocator): boolean {
  return left.installationId === right.installationId && left.generation === right.generation
    && equalPair(left, right) && canonicalJsonStringify(epochsOf(left)) === canonicalJsonStringify(epochsOf(right));
}
function restoreFileBinding(path: string): z.infer<typeof RestoreFileBindingSchema> {
  const custody = fileStatus(path);
  if (!custody.isFile() || custody.isSymbolicLink() || privateFileNumber(custody.nlink) !== 1
    || privatePathRejects(path, custody, "group-write")) fail("unsafe restore data file");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = descriptorStatus(fd), bytes = readFileSync(fd), after = descriptorStatus(fd), current = fileStatus(path);
    if (before.dev !== after.dev || before.ino !== after.ino || privateFileNumber(before.size) !== bytes.length
      || after.size !== before.size || fileModified(after) !== fileModified(before)
      || current.dev !== before.dev || current.ino !== before.ino) fail("restore file custody changed");
    return RestoreFileBindingSchema.parse({ byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") });
  } finally { closeSync(fd); }
}
function sameRestoreFile(path: string, expected: z.infer<typeof RestoreFileBindingSchema>): void {
  if (canonicalJsonStringify(restoreFileBinding(path)) !== canonicalJsonStringify(expected)) fail("restore file binding mismatch");
}
function assertRestoreSuspect(input: AuthorityRestoreInput): void {
  assertRestoreRootMembership(dirname(input.authorityPath), input.operationId);
  if (restoreRetainedFilesDigest(dirname(input.authorityPath)) !== input.retainedFilesDigest) fail("restore-retained-files-changed");
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
  const suspect = fileStatus(path);
  if (!sameDirectory({ device: suspect.dev, inode: suspect.ino }, { device: record.suspect.file.dev, inode: record.suspect.file.ino })
    || canonicalJsonStringify(restoreFileBinding(path)) !== canonicalJsonStringify({ byteSize: record.suspect.file.byteSize, sha256: record.suspect.file.sha256 })) fail("completed-restore-source-changed");
  for (const suffix of ["-wal", "-shm"] as const) {
    const companion = record.companions.find(row => row.suffix === suffix);
    if (companion === undefined) {
      if (lstatMaybe(`${path}${suffix}`)) fail("completed-restore-companion-inventory-mismatch");
    } else {
      const current = fileStatus(`${path}${suffix}`);
      if (!sameDirectory({ device: current.dev, inode: current.ino }, { device: companion.file.dev, inode: companion.file.ino })
        || canonicalJsonStringify(restoreFileBinding(`${path}${suffix}`)) !== canonicalJsonStringify({ byteSize: companion.file.byteSize, sha256: companion.file.sha256 })) fail("completed-restore-source-changed");
    }
  }
  if (lstatMaybe(`${path}-journal`)) fail("completed-restore-companion-inventory-mismatch");
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
function readLocator(control: string, workspace: string,
  restoreRecovery?: { operationId: string; restoreAdmission: OfflineMaintenanceOperation }): RuntimeLocator {
  const locator = rawLocator(control, workspace);
  assertKnownDefaults(workspace, locator);
  if (locator.generation !== 0) fail("fixed-layout-generation-unsupported");
  if (existsSync(join(control, "journal.json"))) {
    const journal = readStrict(join(control, "journal.json"), JournalSchema);
    if (journal.phase !== "restoring" || restoreRecovery === undefined
      || journal.restore.operationId !== restoreRecovery.operationId || journal.installationId !== locator.installationId
      || canonicalJsonStringify(journal.source) !== canonicalJsonStringify(locator)) fail(`unfinished ${journal.phase} operation; exact offline restore recovery required`);
    assertRestoreHeld(workspace, restoreRecovery.restoreAdmission);
    checkRestoreInput(locator, journal.restore);
  } else if (restoreRecovery !== undefined) fail("restore-recovery-journal-missing");
  const epochs = epochsOf(locator);
  checkMarker(locator.stateRoot, locator.installationId, workspace, "state", epochs.state);
  checkMarker(locator.artifactRoot, locator.installationId, workspace, "artifact", epochs.artifact);
  if (existsSync(join(locator.stateRoot, FENCE)) || existsSync(join(locator.artifactRoot, FENCE))) fail("locator points to a fenced source");
  return locator;
}
function rawLocator(control: string, workspace: string): RuntimeLocator {
  const installation = readInstallation(control, workspace);
  if (!lstatMaybe(join(control, "locator.json"))) fail("installation locator missing; offline recovery required");
  const current = defaultLayoutSources.get(workspace);
  if (current !== undefined) { current.assertHeld(); current.bindWorkspace(workspace); }
  const persisted = current === undefined ? readStrict(join(control, "locator.json"), LocatorSchema)
    : readStrict(join(control, "locator.json"), DefaultLayoutSourceLocatorSchema);
  if (persisted.installationId !== installation.installationId) fail("locator installation mismatch");
  const pair = { stateRoot: resolve(workspace, rebuildRuntimeIsolation.stateRoot), artifactRoot: resolve(workspace, rebuildRuntimeIsolation.artifactRoot) };
  if (persisted.schemaVersion !== 3) assertKnownDefaults(workspace, persisted);
  return RuntimeLocatorSchema.parse({ schemaVersion: 3, installationId: persisted.installationId, generation: 0, ...pair });
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

function profileRegistryWitness(installationId: string, path: string, document: ProfileRegistryDocument) {
  privateFile(path);
  if (document.installationId !== installationId) fail("profile-registry-installation-mismatch");
  return ProfileContinuitySchema.parse({ schemaVersion: 7, installationId, revision: document.revision,
    digest: createHash("sha256").update(canonicalJsonStringify(document)).digest("hex"),
    generation: document.sessionGeneration, operations: profileOperationInventory(dirname(dirname(path))) });
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
    if (!sameDirectory(file.identity, anchor.file)
      || createHash("sha256").update(bytes).digest("hex") !== anchor.file.digest) fail("profile-credential-key-unowned");
  }
}


function readProfilePublicationSource(control: string, locator: RuntimeLocator) {
  if (lstatMaybe(join(control, "device-recertification.json"))) fail("device-recertification-pending");
  const path = join(locator.stateRoot, "machine", "profiles.json");
  if (lstatMaybe(join(control, "profile-control-upgrade.json"))) fail("profile-control-upgrade-pending");
  assertNoSymlinkComponents(path);
  readProfileEvidence(join(locator.stateRoot, "machine", "profile-registry-version.json"), z.strictObject({ schemaVersion: z.literal(8) }));
  const document = readProfileEvidence(path, ProfileRegistryDocumentSchema);
  readProfileEvidence(join(locator.stateRoot, "machine", "profile-verifiers.json"), ProfileVerifierDocumentSchema);
  const pepperPath = join(locator.stateRoot, "machine", "profile-pepper");
  const pepper = readPrivateFile(pepperPath, { label: "lock", maxBytes: 32 });
  if (pepper === undefined || pepper.bytes.byteLength !== 32) fail("profile-verifier-evidence-invalid");
  const witnessPath = join(control, "profile-registry.json");
  const witness = readProfileEvidence(witnessPath, ProfileContinuitySchema);
  return { path, document, witnessPath, witness };
}

function finishAccountDeletion(control: string, locator: RuntimeLocator, assertHeld: () => void, stoppedForward = false): void {
  const journal = join(control, "account-deletion.json");
  try { resumeAccountDeletion(locator, journal, assertHeld, {
    validate(prior, next) {
      const source = readProfilePublicationSource(control, locator);
      const same = (left: unknown, right: unknown) => canonicalJsonStringify(left) === canonicalJsonStringify(right);
      if (profileOperationInventory(locator.stateRoot).length !== 0 || lstatMaybe(join(control, "profile-publication.json"))
        || !same(source.document, prior) && !same(source.document, next)
        || !same(source.witness, profileRegistryWitness(locator.installationId, source.path, prior))
          && !same(source.witness, profileRegistryWitness(locator.installationId, source.path, next))) fail("account-deletion-registry-changed");
    },
    publish() {
      const source = readProfilePublicationSource(control, locator);
      atomicJson(source.witnessPath, profileRegistryWitness(locator.installationId, source.path, source.document));
      dropProfileRegistryProof(control, locator);
    },
  }, stoppedForward); } catch (cause) { throw new AccountDeletionRefusedError(cause); }
}

function readMachineRegistry(control: string, locator: RuntimeLocator, recoverPublication = true, publicationOperationId?: string): ProfileRegistryDocument {
  if (lstatMaybe(join(control, "account-deletion.json"))) fail("account-deletion-pending");
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
    if (intent.kind === "incomplete-profile-draft") prepareIncompleteProfileDraft(control, locator, intent);
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
    const expected = profileRegistryWitness(locator.installationId, path, document);
    if (canonicalJsonStringify(witness) !== canonicalJsonStringify(intent.prior)
      && canonicalJsonStringify(witness) !== canonicalJsonStringify(expected)) fail("profile-publication-control-changed");
    return document;
  }
  if (canonicalJsonStringify(profileRegistryWitness(locator.installationId, path, document)) !== canonicalJsonStringify(witness)) fail("profile-registry-continuity-mismatch");
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
  const published = profileRegistryWitness(locator.installationId, path, document);
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
  if (key === undefined || touch === undefined) fail("profile-onboarding-incomplete");
  return ProfileOnboardingCompletionSchema.parse({ generation: draft.generation, ...draft.finish,
    key: { receiptDigest: createHash("sha256").update(canonicalJsonStringify(key)).digest("hex"),
      confirmation: key.operatorConfirmedAt === undefined ? key.portal?.acceptance : "operator" },
    touch: { receiptDigest: createHash("sha256").update(canonicalJsonStringify(touch)).digest("hex"),
      softwareInterceptionDisabled: true, ...(touch.operatorConfirmedAt === undefined ? {} : { operatorConfirmedAt: touch.operatorConfirmedAt }) } });
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
  if (pepper === undefined || pepper.bytes.length !== 32 || !sameDirectory(pepper.identity, intent.pepper)
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
    && (!after || canonicalJsonStringify(continuity) !== canonicalJsonStringify(profileRegistryWitness(locator.installationId, registryPath, document)))) fail("profile-onboarding-finish-control-changed");
  return () => {
    revalidate(); if (verifierBefore) atomicJson(verifierPath, verifiers);
    revalidate(); if (before) prepareRegistryWrite(locator, priorDocument, document, "profile-registry-published")();
    revalidate(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, registryPath, document));
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
  const next = profileRegistryWitness(locator.installationId, registryPath, currentDocument);
  if (canonicalJsonStringify(current) !== canonicalJsonStringify(prior) && (!isNext || !operationPresent || canonicalJsonStringify(current) !== canonicalJsonStringify(next))) fail("profile-incomplete-control-changed");
  return () => {
    const revalidate = () => { prepareIncompleteProfileDraft(control, locator, intent); };
    revalidate(); if (!operationPresent) atomicJson(operationPath, operation);
    revalidate(); if (verifierPrior) atomicJson(verifierPath, verifiers);
    revalidate(); if (isPrior) prepareRegistryWrite(locator, currentDocument, document, "profile-incomplete-reclassified")();
    revalidate(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, registryPath, document));
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
  const headFile = capture.head === undefined ? undefined : readPrivateFile(headPath, { label: "lock", maxBytes: 25 * 1024 * 1024 });
  if (capture.head === undefined) {
    if (operation.credentials.phase !== "planned" || operation.onboarding?.attempts.length !== 0 || capture.membership.length !== 0 || capture.databases.length !== 0
      || lstatMaybe(root) || lstatMaybe(headPath)) fail("profile-draft-abort-uninitialized-source-changed");
    credentialKeyCustody.assertAbsent({ installationId: locator.installationId, profileId: operation.profileId, keyId: operation.credentials.keyId });
  } else if (headFile === undefined) {
    if (lstatMaybe(root)) fail("profile-draft-abort-head-changed");
    credentialKeyCustody.assertAbsent({ installationId: locator.installationId, profileId: operation.profileId, keyId: operation.credentials.keyId });
  } else {
    if (canonicalJsonStringify({ ...fileIdentityObservation(headFile.identity, { preserveSafeNumbers: true }), digest: createHash("sha256").update(headFile.bytes).digest("hex") }) !== canonicalJsonStringify(capture.head)) fail("profile-draft-abort-head-changed");
    const head = CanonicalCredentialHeadSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(headFile.bytes)));
    if (head.state !== "erased" || head.installationId !== locator.installationId || head.profileId !== operation.profileId
      || head.key.installationId !== head.installationId || head.key.profileId !== head.profileId || head.key.keyId !== operation.credentials.keyId
      || head.operationId !== abort.operationId || head.generation !== abort.generation) fail("profile-draft-abort-head-changed");
  }
  if (lstatMaybe(join(locator.stateRoot, "machine", "credential-operations", `${operation.profileId}.json`))
    || lstatMaybe(join(locator.stateRoot, "machine", "duo-credentials", `${operation.profileId}.json`))) fail("profile-draft-abort-credential-operation-pending");
  const current = profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document);
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
      if (original === undefined || !sameDirectory(original, entry) || original.mode !== entry.mode
        || original.directory !== entry.directory || !entry.directory && (original.size !== entry.size || original.modified !== entry.modified || original.changed !== entry.changed)) fail("profile-draft-abort-membership-changed");
    }
    for (const database of profileAuthorityFileWitnesses(root)) if (database.file !== undefined
      && canonicalJsonStringify(database) !== canonicalJsonStringify(capture.databases.find(file => file.suffix === database.suffix))) fail("profile-draft-abort-database-changed");
    if (lstatMaybe(join(root, "credentials", "protected.json")) || lstatMaybe(join(root, "credentials", "chatgpt-account.json"))) fail("profile-draft-abort-credentials-remain");
  }
  return () => {
    if (rootPresent) { rmSync(root, { recursive: true }); fsyncPath(dirname(root)); }
    if (headFile !== undefined) { unlinkSync(headPath); fsyncPath(dirname(headPath)); }
    if (operationPresent) { unlinkSync(operationPath); fsyncPath(dirname(operationPath)); }
    atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document));
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
  const directories = [operations];
  const roots = [control, locator.stateRoot, locator.artifactRoot, machine, ...directories];
  for (const directory of roots) assertNoSymlinkComponents(directory);
  const membership = profileRegistryStatWitness(control, locator, directories);
  const paths = [...profileEvidencePaths(control, locator), ...roots,
    join(dirname(control), "fixed-layout.json"),
    ...["profile-publication.json", "journal.json", "profile-control-upgrade.json", "device-recertification.json"].map(name => join(control, name)),
    join(locator.stateRoot, FENCE), join(locator.artifactRoot, FENCE),
    ...directories.flatMap(directory => lstatMaybe(directory) === undefined ? [] : readdirSync(directory).sort().map(name => join(directory, name)))];
  const witness = profileRegistryStatWitness(control, locator, paths);
  if (membership !== profileRegistryStatWitness(control, locator, directories)) fail("profile-registry-observation-changed");
  return { paths, witness };
}
const BROWSER_ROOTS_STAGE = /^\.browser-roots\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/u;
function profileRegistryStatWitness(control: string, locator: RuntimeLocator, paths: readonly string[]): string {
  for (const directory of [control, locator.stateRoot, locator.artifactRoot]) assertNoSymlinkComponents(directory);
  return paths.map(path => {
    const stat = lstatSync(path, { bigint: true, throwIfNoEntry: false });
    // Peer mutex turnover changes control membership without changing registry evidence.
    if (stat !== undefined && path === control) return [stat.dev, stat.ino, stat.mode, stat.uid].join(":");
    if (stat !== undefined && path === join(locator.stateRoot, "machine")) {
      const members = readdirSync(path).filter(name => name !== ".browser-roots.lock"
        && !BROWSER_ROOTS_STAGE.test(name)).sort();
      return [stat.dev, stat.ino, stat.mode, stat.uid, JSON.stringify(members)].join(":");
    }
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
    return { path, ...fileIdentityObservation(file.identity),
      digest: createHash("sha256").update(file.bytes).digest("hex") };
  });
  return canonicalJsonStringify({ files, operations });
}

function readProfileUpgradeAuthority(control: string, workspace: string, locator: RuntimeLocator, id: string, assertHeld: () => void, purpose: "manual" | "startup" | "layout"): string {
  assertHeld();
  if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-stopped-upgrade-locator-changed");
  const before = profileObservation(control, locator);
  const document = readMachineRegistry(control, locator, false);
  const row = document.profiles.find(entry => entry.profileId === id);
  const signups = purpose !== "manual" ? profileOperationInventory(locator.stateRoot).map(entry =>
    readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${entry.operationId}.json`), ProfileOperationSchema))
    .filter((operation): operation is z.infer<typeof SignUpOperationSchema> => operation.kind === "sign-up" && operation.profileId === id) : [];
  const signup = signups[0];
  if (purpose === "manual" ? row?.lifecycle !== "ready" || row.credentialState !== "saved"
    : signups.length > 1 || row === undefined && signup === undefined || row !== undefined && row.credentialState !== "saved" && signup === undefined) fail("profile-stopped-upgrade-ready-required");
  const key = join(locator.stateRoot, "machine", "credential-keys", `${id}.json`);
  const headFile = readPrivateFile(key, { label: "lock", maxBytes: 25 * 1024 * 1024 });
  if (headFile === undefined) {
    if (signup?.credentials.phase !== "planned") fail("profile-stopped-upgrade-key-required");
  } else {
    const head = CanonicalCredentialHeadSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(headFile.bytes)));
    if (head.installationId !== locator.installationId || head.profileId !== id) fail("profile-stopped-upgrade-key-required");
    if (head.state === "active") {
      if (head.key.installationId !== head.installationId || head.key.profileId !== head.profileId) fail("profile-stopped-upgrade-key-required");
      credentialKeyCustody.read(head.key);
    } else if (signup?.onboarding?.abort === undefined) fail("profile-stopped-upgrade-key-required");
  }
  const pending = join(locator.stateRoot, "machine", "credential-operations", `${id}.json`);
  const credentialOperation = readPrivateFile(pending, { label: "lock", maxBytes: 100 * 1024 * 1024 });
  if (credentialOperation !== undefined) {
    if (signup === undefined) fail("profile-stopped-upgrade-credential-operation-pending");
    const operation = CanonicalCredentialOperationSchema.parse(JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(credentialOperation.bytes)));
    if (operation.installationId !== locator.installationId || operation.profileId !== id
      || operation.operationId !== (operation.kind === "create" ? signup.credentials.operationId : signup.onboarding?.abort?.operationId)) fail("profile-stopped-upgrade-credential-operation-pending");
  }
  const files = [key, join(locator.stateRoot, "profiles", id, "credentials", "protected.json"),
    join(locator.stateRoot, "profiles", id, "credentials", "chatgpt-account.json"), join(locator.stateRoot, "machine", "duo-credentials", `${id}.json`), ...(purpose !== "manual" ? [pending] : [])].map(path => {
      const file = path === pending ? credentialOperation : readPrivateFile(path, { label: "protected.json", maxBytes: 25 * 1024 * 1024 });
      if (file === undefined) {
        if (path !== pending && signup?.credentials.phase !== "planned" && signup?.onboarding?.abort === undefined) fail("profile-stopped-upgrade-evidence-required");
        return { path, state: "absent" };
      }
      return { path, identity: fileIdentityObservation(file.identity), digest: createHash("sha256").update(file.bytes).digest("hex") };
    });
  if (profileObservation(control, locator) !== before || lstatMaybe(join(control, "profile-publication.json"))) fail("profile-stopped-upgrade-observation-changed");
  assertHeld();
  const directories = [control, join(locator.stateRoot, "machine"), join(locator.stateRoot, "machine", "credential-keys"),
    join(locator.stateRoot, "machine", "credential-operations"), join(locator.stateRoot, "machine", "operations")].map(path => {
      privateDirectory(path);
      const info = fileStatus(path);
      return { path, ...fileIdentityObservation({ device: info.dev, inode: info.ino }, { preserveSafeNumbers: true }), mode: privateFileNumber(info.mode), owner: privateFileNumber(info.uid) };
    });
  return canonicalJsonStringify({ document, observation: before, files, directories });
}

function flatStartCleanPepper(control: string, locator: RuntimeLocator, intent: FlatStartCleanIntent) {
  const stage = join(control, `.flat-start-clean-${intent.operationId}.pepper`), target = join(locator.stateRoot, "machine", "profile-pepper");
  noSymlinkAncestry(dirname(stage), new Map()); noSymlinkAncestry(dirname(target), new Map());
  const prepared = readPrivateFile(stage, { label: "lock", maxBytes: 32 }), published = readPrivateFile(target, { label: "lock", maxBytes: 32 });
  const pepper = prepared ?? published;
  if (pepper?.bytes.length !== 32 || backupHash(pepper.bytes) !== intent.pepperDigest || prepared !== undefined && published !== undefined
    || intent.phase === "erasing" && prepared === undefined) fail("flat-start-clean-pepper-changed");
  return { stage, target };
}

function initializeMachineRegistry(control: string, locator: RuntimeLocator, flat?: FlatStartCleanIntent): void {
  const directory = join(locator.stateRoot, "machine");
  if (!lstatMaybe(directory)) { createPrivateDirectory(directory, { mode: 0o700 }); fsyncPath(locator.stateRoot); }
  privateDirectory(directory);
  const allowed = ["browser-roots.json", "profile-registry-version.json", "profiles.json", "profile-verifiers.json", "profile-pepper"];
  if (readdirSync(directory).some(name => !allowed.includes(name))) fail("profile-machine-initialization-membership-refused");
  const publish = (path: string, value: unknown) => {
    if (!lstatMaybe(path)) atomicJson(path, value);
    else if (canonicalJsonStringify(readStrict(path, z.unknown())) !== canonicalJsonStringify(value)) fail("profile-machine-initialization-changed");
  };
  const document = ProfileRegistryDocumentSchema.parse({ schemaVersion: 3, installationId: locator.installationId, revision: 0, profiles: [], activeProfileId: null, sessionGeneration: 0 });
  publish(join(directory, "browser-roots.json"), BrowserRootsSchema.parse({ schemaVersion: 3, installationId: locator.installationId, revision: 0, nextHandle: 1, nextGeneration: 1, roots: [] }));
  publish(join(directory, "profile-registry-version.json"), { schemaVersion: 8 });
  publish(join(directory, "profiles.json"), document);
  publish(join(directory, "profile-verifiers.json"), { schemaVersion: 1, profiles: [] });
  const pepperPath = join(directory, "profile-pepper");
  if (flat !== undefined) {
    const { stage, target } = flatStartCleanPepper(control, locator, flat);
    if (!lstatMaybe(target)) { renameSync(stage, target); fsyncPath(control); fsyncPath(directory); }
  } else if (!lstatMaybe(pepperPath)) writeFileSync(pepperPath, randomBytes(32), { mode: 0o600, flag: "wx" });
  const pepper = readPrivateFile(pepperPath, { label: "lock", maxBytes: 32 });
  if (pepper?.bytes.length !== 32) fail("profile-machine-pepper-invalid");
  fsyncPath(pepperPath); fsyncPath(directory);
  publish(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(directory, "profiles.json"), document));
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
    createPrivateDirectory(processLockRoot, { mode: 0o700 });
    privateDirectory(processLockRoot);
    fsyncPath(dirname(processLockRoot));
    initializeMachineRegistry(control, { schemaVersion: 3, installationId, generation: 0, ...pair });
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
  const persisted = LocatorSchema.parse({ schemaVersion: 3, installationId, generation: 0 });
  const locator = RuntimeLocatorSchema.parse({ ...persisted, ...pair });
  atomicJson(join(control, "locator.json"), persisted);
  unlinkSync(join(control, "journal.json")); fsyncPath(control);
  return locator;
}
function upgradeRestoreControl(control: string, locator: RuntimeLocator): void {
  if ((installationAdmissions.get(control)?.size ?? 0) !== 0) fail("restore-control-upgrade-admission-busy");
  const path = join(control, "profile-registry.json"), markerPath = join(locator.stateRoot, "machine", "profile-registry-version.json"),
    intentPath = join(control, "restore-control-upgrade.json"), registryPath = join(locator.stateRoot, "machine", "profiles.json");
  const schema = z.strictObject({ schemaVersion: z.literal(1), prior: StoppedRestoreProfileContinuitySchema, current: ProfileContinuitySchema });
  let intent = lstatMaybe(intentPath) ? readStrict(intentPath, schema) : undefined;
  if (intent === undefined) {
    const marker = readStrict(markerPath, z.strictObject({ schemaVersion: z.number().int() }));
    if (marker.schemaVersion !== 7) return;
    for (const name of ["journal.json", "profile-publication.json", "profile-control-upgrade.json"]) if (lstatMaybe(join(control, name))) fail("restore-control-upgrade-pending-unsupported");
    const prior = readStrict(path, StoppedRestoreProfileContinuitySchema), document = readStrict(registryPath, ProfileRegistryDocumentSchema);
    assertPriorRegistryLogicalBinding(locator, prior, document);
    for (const row of prior.completedRestores) assertCompletedRestoreCustody(locator, row);
    intent = schema.parse({ schemaVersion: 1, prior, current: profileRegistryWitness(locator.installationId, registryPath, document) });
    atomicJson(intentPath, intent);
  }
  const document = readStrict(registryPath, ProfileRegistryDocumentSchema), actual = readStrict(path, z.union([StoppedRestoreProfileContinuitySchema, ProfileContinuitySchema]));
  if (canonicalJsonStringify(profileRegistryWitness(locator.installationId, registryPath, document)) !== canonicalJsonStringify(intent.current)
    || canonicalJsonStringify(actual) !== canonicalJsonStringify(intent.prior) && canonicalJsonStringify(actual) !== canonicalJsonStringify(intent.current)) fail("restore-control-upgrade-source-changed");
  const marker = readStrict(markerPath, z.strictObject({ schemaVersion: z.union([z.literal(7), z.literal(8)]) }));
  if (marker.schemaVersion === 8 && actual.schemaVersion !== 7) fail("restore-control-upgrade-prefix-invalid");
  atomicJson(path, intent.current); atomicJson(markerPath, { schemaVersion: 8 });
  unlinkSync(intentPath); fsyncPath(control);
}

function preflightProfileFormats(control: string, workspace: string, stoppedForward: boolean, restoreOperationId?: string): void {
  if (!lstatMaybe(join(control, "installation.json"))) return;
  const locator = rawLocator(control, workspace), machine = join(locator.stateRoot, "machine");
  const completed = join(control, "flat-start-clean-complete.json");
  if (lstatMaybe(completed)) {
    const intent = readStrict(completed, FlatStartCleanIntentSchema);
    if (intent.phase !== "complete" || intent.installationId !== locator.installationId) fail("flat-start-clean-completion-invalid");
    flatStartCleanPepper(control, locator, intent);
  }
  const clean = join(control, "flat-start-clean.json");
  if (lstatMaybe(clean)) {
    const intent = readStrict(clean, FlatStartCleanIntentSchema);
    readFlatStartCleanSource(workspace, locator.installationId, intent);
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
      if (version.kind === "logout" && version.schemaVersion !== 3) throw new CredentialMaintenanceHold("CREDENTIAL_CONVERSION_UNSUPPORTED", {
        cause: new Error(version.phase === "complete" ? "profile-control-upgrade-legacy-logout-completion-unproved" : "profile-control-upgrade-legacy-logout-epoch-unproved") });
    }
  }
  if (restoreOperationId !== undefined) {
    const pending = readProfileEvidence(join(control, "journal.json"), JournalSchema);
    if (pending.phase !== "restoring" || pending.restore.operationId !== restoreOperationId || pending.installationId !== locator.installationId) fail("profile-restore-context-unavailable");
  }
  if (stoppedForward) upgradeRestoreControl(control, locator);
  const marker = readProfileEvidence(join(machine, "profile-registry-version.json"), z.strictObject({ schemaVersion: z.number().int() }));
  if (marker.schemaVersion === 8) {
    if (!stoppedForward && lstatMaybe(join(control, "browser-root-upgrade.json"))) fail("browser-root-upgrade-pending");
    const browsers = stoppedForward || restoreOperationId !== undefined ? parseStoppedBrowserRootUpgradeSource(readProfileEvidence(join(machine, "browser-roots.json"), z.unknown()))
      : readProfileEvidence(join(machine, "browser-roots.json"), BrowserRootsSchema);
    if (browsers.installationId !== locator.installationId) fail("browser-registry-installation-mismatch");
  }
  const pending = join(control, "profile-control-upgrade.json");
  if (lstatMaybe(join(control, "device-recertification.json"))) fail("profile-control-upgrade-pending-conversion-unsupported");
  if (lstatMaybe(pending)) {
    if (!stoppedForward) fail("profile-control-upgrade-pending");
    for (const name of ["profile-publication.json", "journal.json"]) if (lstatMaybe(join(control, name))) fail("profile-control-upgrade-pending-conversion-unsupported");
    validateStoppedControlUpgrade(control, locator, readControlUpgradeReceipt(pending));
    return;
  }
  if (marker.schemaVersion === 8) {
    const document = readProfileEvidence(join(machine, "profiles.json"), ProfileRegistryDocumentSchema);
    const continuity = readProfileEvidence(join(control, "profile-registry.json"), ProfileContinuitySchema);
    if (document.installationId !== locator.installationId || continuity.installationId !== locator.installationId) fail("profile-registry-installation-mismatch");
    if (lstatMaybe(join(control, "profile-publication.json"))) {
      const file = readPrivateFile(join(control, "profile-publication.json"), { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined) fail("profile-control-upgrade-pending-conversion-unsupported");
      const intent = ProfilePublicationSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
      if (!intent.success) fail("profile-control-upgrade-pending-conversion-unsupported");
      if (intent.data.kind === "incomplete-profile-draft") prepareIncompleteProfileDraft(control, locator, intent.data);
    }
    if (lstatMaybe(join(control, "journal.json"))) {
      const file = readPrivateFile(join(control, "journal.json"), { label: "lock", maxBytes: 1_048_576 });
      if (file === undefined || !JournalSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes))).success) fail("profile-control-upgrade-pending-conversion-unsupported");
    }
    if (!lstatMaybe(join(control, "profile-publication.json")) && !lstatMaybe(join(control, "journal.json")) && !lstatMaybe(join(control, "account-deletion.json"))
      && canonicalJsonStringify(profileRegistryWitness(locator.installationId, join(machine, "profiles.json"), document)) !== canonicalJsonStringify(continuity)) fail("profile-registry-continuity-mismatch");
    return;
  }
  if (!stoppedForward) fail("profile-control-upgrade-required");
  if (![2, 3, 4, 5, 6].includes(marker.schemaVersion)) fail("profile-control-upgrade-pending-conversion-unsupported");
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

const startupLogoutObservations = new WeakMap<RuntimeLifetimeLock | WorkerRuntimeLifetimeLock, Map<string, string>>();

function logoutIdentity(operation: z.infer<typeof LogoutOperationSchema>): string {
  const { phase: _phase, settlement: _settlement, ...identity } = operation;
  return canonicalJsonStringify(identity);
}

export function acquireInstallation(workspacePath: string, mode: "shared", lifetime: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock, options?: { machine?: true; readonlyControl?: true }): InstallationLease;
export function acquireInstallation(workspacePath: string, mode: "exclusive", lifetime: RuntimeLifetimeLock, options?: { offlineOperation?: OfflineMaintenanceOperation; readonlyControl?: true; stoppedControlForward?: true; defaultPair?: RuntimePair; verifyExisting?: AuthorityVerifier; initializeFresh?: FreshInitializer; machine?: true; recoverAuthorityRestore?: { operationId: string; restoreAdmission: OfflineMaintenanceOperation } }): ExclusiveInstallationLease;
export function acquireInstallation(workspacePath: string, mode: "shared" | "exclusive", lifetime: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock, options?: { offlineOperation?: OfflineMaintenanceOperation; readonlyControl?: true; stoppedControlForward?: true; defaultPair?: RuntimePair; verifyExisting?: AuthorityVerifier; initializeFresh?: FreshInitializer; machine?: true; recoverAuthorityRestore?: { operationId: string; restoreAdmission: OfflineMaintenanceOperation } }): InstallationLease | ExclusiveInstallationLease {
  const workspace = realpathSync(workspacePath);
  if (!(lifetime instanceof RuntimeLifetimeLock) && !(lifetime instanceof WorkerRuntimeLifetimeLock)) fail("runtime-lifetime-required");
  lifetime.assertHeld();
  if (resolve(workspacePath) !== workspace) fail("installation workspace must be canonical");
  const layout = readFixedLayoutIntent(workspace);
  if (layout !== undefined && layout.phase !== "complete"
    && (layout.phase !== "configuring" || options?.stoppedControlForward !== true || options.offlineOperation === undefined)) fail("fixed-layout-startup-recovery-required");
  if ((mode === "exclusive" || options?.stoppedControlForward === true) && !(lifetime instanceof RuntimeLifetimeLock)) fail("exclusive-root-lifetime-required");
  if (options?.stoppedControlForward === true && mode !== "exclusive") fail("stopped-control-forward-exclusive-required");
  if (lifetime instanceof RuntimeLifetimeLock) {
    if (mode !== "exclusive" && options?.offlineOperation !== undefined) fail("offline-maintenance-exclusive-root-required");
    lifetime.assertAdmissionOperation(options?.offlineOperation, workspace);
    if (options?.offlineOperation !== undefined) assertNoOldBuildRuntimeArtifacts(workspace);
  }
  const coldLogoutObservations = startupLogoutObservations.get(lifetime) ?? new Map<string, string>();
  startupLogoutObservations.set(lifetime, coldLogoutObservations);
  if (options?.stoppedControlForward === true) {
    if (options.offlineOperation === undefined || !(lifetime instanceof RuntimeLifetimeLock)) fail("offline-maintenance-exclusive-root-required");
    lifetime.assertOfflineMaintenance(options.offlineOperation, workspace);
  }
  if (options?.recoverAuthorityRestore !== undefined) {
    if (!(lifetime instanceof RuntimeLifetimeLock) || mode !== "exclusive" || options.offlineOperation !== options.recoverAuthorityRestore.restoreAdmission) fail("offline-maintenance-exclusive-root-required");
    lifetime.assertOfflineMaintenance(options.recoverAuthorityRestore.restoreAdmission, workspace);
  }
  try { preflightProfileFormats(join(workspace, CONTROL), workspace, options?.stoppedControlForward === true, options?.recoverAuthorityRestore?.operationId); }
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
      if (marker?.schemaVersion === 8 && !lstatMaybe(join(control, "profile-control-upgrade.json"))) {
        if (lstatMaybe(join(control, "account-deletion.json"))) {
          finishAccountDeletion(control, priorLocator, () => {
            lifetime.assertStartupWorkspace(workspace);
            if (options?.stoppedControlForward === true) {
              if (options.offlineOperation === undefined) fail("offline-maintenance-exclusive-root-required");
              lifetime.assertOfflineMaintenance(options.offlineOperation, workspace);
            }
          }, options?.stoppedControlForward === true);
        }
        const pending = lstatMaybe(join(control, "profile-publication.json")) === undefined ? undefined
          : readProfileEvidence(join(control, "profile-publication.json"), ProfilePublicationSchema);
        if (pending?.kind === "profile") {
          const source = readProfilePublicationSource(control, priorLocator);
          prepareProfileRegistryPublication(control, priorLocator, source.path, source.document, source.witness, pending);
        } else readMachineRegistry(control, priorLocator, false);
        for (const entry of profileOperationInventory(priorLocator.stateRoot)) {
          const operation = readProfileEvidence(join(machine, "operations", `${entry.operationId}.json`), ProfileOperationSchema);
          if (operation.kind !== "logout" || operation.phase === "complete") continue;
          const source = fileStatus(join(priorLocator.stateRoot, "profiles", operation.profileId, "state.db"));
          if (!source.isFile() || privateFileNumber(source.nlink) !== 1 || privatePathRejects(join(priorLocator.stateRoot, "profiles", operation.profileId, "state.db"), source, "owner")
            || !sameDirectory({ device: source.dev, inode: source.ino }, operation.source.database)) fail("profile-logout-native-source-changed");
          lifetime.assertStartupWorkspace(workspace);
          coldLogoutObservations.set(operation.operationId, logoutIdentity(operation));
        }
        const registered = new Set(readProfilePublicationSource(control, priorLocator).document.profiles.map(row => row.profileId));
        const operating = new Set(profileOperationInventory(priorLocator.stateRoot)
          .map(entry => readProfileEvidence(join(machine, "operations", `${entry.operationId}.json`), ProfileOperationSchema).profileId));
        const publishing = lstatMaybe(join(control, "profile-publication.json")) !== undefined;
        removals.push(...captureCanonicalCredentialStartupLocks(lifetime, workspace, priorLocator.stateRoot, priorLocator.installationId,
          profileId => !publishing && !registered.has(profileId) && !operating.has(profileId)));
      }
      for (const name of [".profile-ops.lock", ".profile-registry.lock"]) {
        if (lstatMaybe(join(machine, name)) === undefined) continue;
        if (!equalLocator(readLocator(control, workspace, options?.recoverAuthorityRestore), priorLocator)) fail("profile-machine-authority-changed");
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
      // Startup custody admits no live browser-registry writer, so its lock is a dead holder's and a remaining stage was never renamed in.
      if (lstatMaybe(machine) !== undefined) {
        const rootsLock = capturePriorPrivateFileLock(machine, ".browser-roots.lock");
        if (rootsLock !== undefined) removals.push(rootsLock);
        for (const name of readdirSync(machine)) if (BROWSER_ROOTS_STAGE.test(name)) {
          const path = join(machine, name), stage = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
          if (stage !== undefined) removals.push(() => { removeExactPath(path, stage.identity, false, "directory-integrity: browser-roots stage changed"); fsyncPath(machine); });
        }
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
    if (lstatMaybe(parent) === undefined) { createPrivateDirectory(parent, { mode: 0o700 }); fsyncPath(workspace); }
    privateDirectory(parent);
    createPrivateDirectory(control, { mode: 0o700 }); fsyncPath(parent);
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
    const resolved = existsSync(join(control, "installation.json")) ? readLocator(control, workspace, mode === "exclusive" ? options?.recoverAuthorityRestore : undefined) : (mode === "exclusive" && options?.defaultPair ? adopt(control, workspace, options.defaultPair, options.verifyExisting, options.initializeFresh, options.machine) : fail("installation locator missing"));
    if (options?.machine === true) readMachineRegistry(control, resolved, options.readonlyControl !== true);
    return resolved;
  }); } catch (error) {
    if (hasUnprovedSourceClosure(error)) lifetime.retainSourceClosure(error);
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
      if (!lstatMaybe(directory)) { current(); createPrivateDirectory(directory, { mode: 0o700 }); fsyncPath(dirname(directory)); }
      privateDirectory(directory);
      const id = operation.kind === "write" ? operation.operation.operationId : operation.operationId, path = join(directory, `${id}.json`);
      current();
      if (operation.kind === "write") atomicJson(path, operation.operation);
      else if (lstatMaybe(path)) { privateFile(path); unlinkSync(path); fsyncPath(directory); }
      current(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document));
      current(); unlinkSync(join(control, "profile-publication.json")); fsyncPath(control);
    });
  }

  function publishRegistry(expected: ProfileRegistryDocument | undefined, document: ProfileRegistryDocument | undefined,
    registration?: { operation: z.infer<typeof SignUpOperationSchema>; profile: RuntimeAdmission; lease: InstallationLease; proof?: StartupRegistrationProof },
    reason: ProfileSelectionChangeReason = "profile-registry-published"): void {
    mutate(held => {
      const current = () => { assertHeld(); lifetime.assertRuntimeAvailable(); held.assertHeld(); };
      current();
      if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-machine-authority-changed");
      const before = readMachineRegistry(control, locator), intentPath = join(control, "profile-publication.json");
      if (registration !== undefined) {
        const { operation } = registration, scope = new ActiveProfilePublicationRead(control, workspace, locator, operation.operationId, held, current);
        try {
          const inspect = () => { current(); return requireRuntimeAdmission(registration.profile, scope).readProfileRegistration(registration.lease, operation, scope, registration.proof); };
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
          assertCanonicalProfileBinding(join(locator.stateRoot, "profiles", operation.profileId, "state.db"),
            { installationId: locator.installationId, profileId: operation.profileId });
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
        return original === undefined || canonicalJsonStringify({ ...row, lifecycle: original.lifecycle, lastSignedInAt: original.lastSignedInAt,
          firstName: original.firstName, lastName: original.lastName, initials: original.initials, timekeeperName: original.timekeeperName }) !== canonicalJsonStringify(original);
      })) fail("profile-registry-registration-required");
      if (expected !== undefined && canonicalJsonStringify(before) !== canonicalJsonStringify(expected)
        || next.installationId !== before.installationId || next.revision !== before.revision + 1 || next.sessionGeneration < before.sessionGeneration) fail("profile-registry-publication-conflict");
      const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
      const publish = prepareRegistryWrite(locator, before, next, reason);
      current(); atomicJson(intentPath, { kind: "profile", schemaVersion: 1, installationId: locator.installationId, prior, document: next });
      const path = join(locator.stateRoot, "machine", "profiles.json");
      current(); publish();
      current(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, path, next));
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
    readFlatStartCleanIntent() {
      assertHeld();
      const path = join(control, "flat-start-clean.json");
      if (!lstatMaybe(path)) return undefined;
      const intent = readStrict(path, FlatStartCleanIntentSchema);
      readFlatStartCleanSource(workspace, locator.installationId, intent);
      flatStartCleanPepper(control, locator, intent);
      return intent;
    },
    prepareFlatStartClean(restore: OfflineMaintenanceOperation, timing: FlatStartCleanIntent["timing"]) {
      return mutate(() => {
        assertStoppedMachineMaintenance(this, restore);
        if (!this.requiresFlatStoreMigration() || this.flatStoreMigrationPending()) fail("flat-start-clean-source-required");
        const reference = retainedStorageBackup(workspace, locator.installationId);
        if (reference === undefined) fail("flat-start-clean-backup-required");
        const bytes = backupFile(join(dirname(reference.backupPath), "source.json")).bytes;
        const source = SourceRecordSchema.parse(JSON.parse(bytes.toString("utf8")));
        const pepper = randomBytes(32);
        const intent = FlatStartCleanIntentSchema.parse({ schemaVersion: 2, kind: "flat-start-clean", installationId: locator.installationId,
          operationId: source.operationId, sourceDigest: backupHash(bytes), backup: reference, credentialLayout: "flat-plaintext",
          pepperDigest: backupHash(pepper), timing, phase: "erasing", cursor: 0, pending: false });
        readFlatStartCleanSource(workspace, locator.installationId, intent);
        assertFlatStartCleanFiles(source, intent); assertFlatStartCleanCredentials(source);
        const stage = join(control, `.flat-start-clean-${intent.operationId}.pepper`);
        if (lstatMaybe(stage)) fail("flat-start-clean-pepper-stage-exists");
        atomicJson(join(control, "flat-start-clean.json"), intent);
        writePrivateStage(stage, pepper); fsyncPath(control);
      });
    },
    async startCleanFlatStore(restore: OfflineMaintenanceOperation, backup: RuntimeAdmission, closure: StoppedBackupClosure) {
      const { assertStoppedBackupClosure } = await import("../maintenance/profile-inventory.js");
      return mutate(() => {
        const assertClosed = () => {
          assertStoppedMachineMaintenance(this, restore);
          if (!backup.isFlatBackup() || backup.stateRoot !== locator.stateRoot || backup.artifactRoot !== locator.artifactRoot) fail("flat-start-clean-source-refused");
          assertStoppedBackupClosure(closure, backup, restore);
        };
        assertClosed();
        const intentPath = join(control, "flat-start-clean.json");
        const pending = this.readFlatStartCleanIntent();
        if (pending === undefined) fail("flat-start-clean-backup-required");
        let intent: FlatStartCleanIntent = pending;
        const source = readFlatStartCleanSource(workspace, locator.installationId, intent), plan = flatStartCleanPlan(source);
        const current = () => {
          assertStoppedMachineMaintenance(this, restore);
          const observed = this.readFlatStartCleanIntent();
          if (observed === undefined || canonicalJsonStringify(observed) !== canonicalJsonStringify(intent)) fail("flat-start-clean-intent-changed");
          assertFlatStartCleanFiles(source, intent); assertClosed();
        };
        current();
        while (intent.cursor < plan.length) {
          if (!intent.pending) { intent = { ...intent, pending: true }; atomicJson(intentPath, intent); }
          current();
          const member = plan[intent.cursor];
          if (member === undefined) fail("flat-start-clean-cursor-invalid");
          const path = join(locator.stateRoot, ...member.path.split("/").slice(1));
          if (lstatMaybe(path)) {
            if (member.kind === "directory") rmdirSync(path); else unlinkSync(path);
          }
          fsyncPath(dirname(path));
          intent = { ...intent, cursor: intent.cursor + 1, pending: false }; atomicJson(intentPath, intent);
          current();
        }
        if (intent.phase === "erasing") { intent = { ...intent, phase: "publishing" }; atomicJson(intentPath, intent); }
        current(); initializeMachineRegistry(control, locator, intent);
        current();
        const document = readMachineRegistry(control, locator, false);
        const registryDigest = backupHash(Buffer.from(canonicalJsonStringify(document)));
        if (intent.result !== undefined && intent.result.registryDigest !== registryDigest) fail("flat-start-clean-result-changed");
        intent = { ...intent, phase: "complete", result: { registryDigest } };
        atomicJson(intentPath, intent);
        const completed = join(control, "flat-start-clean-complete.json");
        if (lstatMaybe(completed)) fail("flat-start-clean-completion-exists");
        renameSync(intentPath, completed); fsyncPath(control);
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
    deleteProfileAccount(profileId: string, epoch: number): void {
      assertHeld();
      assertMaintenanceCustodyAvailable("account-deletion");
      const restore = this.beginOfflineMaintenance();
      try { mutate(() => {
        const guard = () => assertStoppedMachineMaintenance(this, restore);
        guard();
        const journal = join(control, "account-deletion.json");
        if (lstatMaybe(journal)) fail("account-deletion-pending");
        const document = readMachineRegistry(control, locator);
        if (profileOperationInventory(locator.stateRoot).length !== 0
          || lstatMaybe(join(locator.stateRoot, "machine", "credential-operations", `${z.uuid().parse(profileId)}.json`))) fail("account-deletion-operation-pending");
        assertAccountDeletionRetainedBackups(control, locator, profileId);
        assertCanonicalProfileBinding(join(locator.stateRoot, "profiles", profileId, "state.db"), { installationId: locator.installationId, profileId });
        const plan = captureAccountDeletion(locator, document, profileId, epoch);
        guard(); publishAccountDeletion(journal, plan);
        finishAccountDeletion(control, locator, guard);
        readMachineRegistry(control, locator, false);
      }); } finally { restore.release(); }
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
    readStartupProfileIds() {
      if (mode !== "exclusive") fail("profile-stopped-upgrade-exclusive-required");
      assertHeld();
      const document = readMachineRegistry(control, locator, false);
      const pending = profileOperationInventory(locator.stateRoot).map(entry =>
        readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${entry.operationId}.json`), ProfileOperationSchema));
      return [...new Set([...document.profiles.map(row => row.profileId), ...pending.filter(operation => operation.kind === "sign-up"
        && (operation.credentials.phase !== "planned" || lstatMaybe(join(locator.stateRoot, "profiles", operation.profileId, "state.db")) !== undefined
          || lstatMaybe(join(locator.stateRoot, "machine", "credential-keys", `${operation.profileId}.json`)) !== undefined)).map(operation => operation.profileId)])];
    },
    captureStoppedProfileUpgrade(profileId: string, purpose: "manual" | "startup" | "layout") {
      if (mode !== "exclusive") fail("profile-stopped-upgrade-exclusive-required");
      const id = z.uuid().parse(profileId);
      assertHeld();
      const read = () => readProfileUpgradeAuthority(control, workspace, locator, id, assertHeld, purpose);
      const logout = purpose !== "manual" ? profileOperationInventory(locator.stateRoot).map(entry =>
        readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${entry.operationId}.json`), ProfileOperationSchema))
        .find((operation): operation is z.infer<typeof LogoutOperationSchema> => operation.kind === "logout" && operation.profileId === id && operation.phase !== "complete") : undefined;
      if (purpose === "startup" && logout?.settlement !== undefined) assertMaintenanceCustodyAvailable("schema-upgrade");
      let original = read();
      const guard = () => {
        if (read() !== original) fail("profile-stopped-upgrade-authority-changed");
      };
      return Object.freeze({ assertHeld: guard, ...(logout === undefined ? {} : { logout }), settleLogout: (conversion: StartupLogoutConversion) => {
        if (purpose !== "startup" || logout === undefined) fail("profile-startup-logout-required");
        mutate(held => {
          guard(); held.assertHeld();
          const { expected, next } = AuthorityDatabase.consumeStartupLogoutConversion(conversion, this);
          if (canonicalJsonStringify(expected) !== canonicalJsonStringify(logout)
            || canonicalJsonStringify(readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${logout.operationId}.json`), LogoutOperationSchema)) !== canonicalJsonStringify(expected)) fail("profile-startup-logout-source-changed");
          const { settlement: _before, ...beforeIdentity } = logout, { settlement: _after, ...afterIdentity } = next;
          if (canonicalJsonStringify(beforeIdentity) !== canonicalJsonStringify(afterIdentity)) fail("profile-startup-logout-identity-changed");
          const document = readMachineRegistry(control, locator, false), prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
          const intent = ProfilePublicationSchema.parse({ kind: "profile", schemaVersion: 1, installationId: locator.installationId, prior, document,
            operation: { kind: "write", operation: LogoutOperationSchema.parse(next) } });
          if (intent.kind !== "profile" || Buffer.byteLength(JSON.stringify(intent)) > 1_048_576) fail("profile-startup-logout-publication-refused");
          atomicJson(join(control, "profile-publication.json"), intent);
          atomicJson(join(locator.stateRoot, "machine", "operations", `${next.operationId}.json`), next);
          prepareProfileRegistryPublication(control, locator, join(locator.stateRoot, "machine", "profiles.json"), document, prior, intent)();
          original = read();
        });
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
          guard(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), next));
          guard(); unlinkSync(publicationPath); fsyncPath(control);
          document = next;
        }
        const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        const intent = ProfilePublicationSchema.parse({ kind: "profile", schemaVersion: 1, installationId: locator.installationId, prior, document,
          operation: { kind: "delete", operationId: operation.operationId } });
        if (Buffer.byteLength(JSON.stringify(intent)) > 1_048_576) fail("profile-logout-settlement-evidence-too-large");
        guard(); atomicJson(publicationPath, intent);
        guard(); unlinkSync(operationPath); removed = true; fsyncPath(dirname(operationPath));
        guard(); atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document));
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
      const path = join(locator.stateRoot, "profiles", operation.profileId, "state.db"), source = fileStatus(path);
      if (!source.isFile() || privateFileNumber(source.nlink) !== 1 || privatePathRejects(path, source, "owner")
        || !sameDirectory({ device: source.dev, inode: source.ino }, operation.source.database)) fail("profile-logout-native-source-changed");
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
        const pending = publication === undefined ? { absent: true } : { ...fileIdentityObservation(publication.identity),
          digest: createHash("sha256").update(publication.bytes).digest("hex") };
        assertHeld();
        return canonicalJsonStringify({ document, observation, pending, operationIdentity: fileIdentityObservation(file.identity) });
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
    publishProfileRegistry(expected: ProfileRegistryDocument, document: ProfileRegistryDocument, reason?: ProfileSelectionChangeReason) { publishRegistry(expected, document, undefined, reason); },
    publishProfileRegistration(operation: z.infer<typeof SignUpOperationSchema>, profile: RuntimeAdmission, proof?: StartupRegistrationProof) { publishRegistry(undefined, undefined, { operation, profile, lease: this, proof }); },
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
      assertHeld();
      return Object.freeze({ workspace, locator: publicLocator });
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
  const exclusive: ExclusiveInstallationLease = Object.freeze({
    ...shared,
    captureProfileRestore(profileId, credentials) {
      assertHeld();
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
        if (canonicalJsonStringify(current) !== canonicalJsonStringify(input.profile.continuity)) fail("profile-restore-control-changed");
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
        atomicJson(join(control, "journal.json"), AuthorityRestoreJournalSchema.parse({ schemaVersion: 3,
          phase: "restoring", installationId: locator.installationId, source: locator,
          restoreAdmissionId: restore.operationId, restore: parsed }));
      });
    },
    settleAuthorityRestore(input, verify, restore) {
      const parsed = AuthorityRestoreInputSchema.parse(input);
      assertHeld(); assertLocalRestoreHeld(restore);
      assertProfileRestoreDatabaseBinding(parsed.authorityPath, parsed.profile.binding);
      const verified = z.strictObject({ authorityGeneration: GenerationSchema, authorityContentFingerprint: DigestSchema }).parse(verify());
      mutate(() => {
        assertHeld(); assertLocalRestoreHeld(restore);
        let pending = readStrict(join(control, "journal.json"), AuthorityRestoreJournalSchema);
        if (pending.installationId !== locator.installationId
          || canonicalJsonStringify(pending.source) !== canonicalJsonStringify(locator)
          || canonicalJsonStringify(pending.restore) !== canonicalJsonStringify(parsed)) fail("restore settlement operation binding mismatch");
        checkRestoreInput(locator, parsed);
        assertRestoreSuspect(parsed);
        if (restoreFileBinding(parsed.manifestPath).sha256 !== parsed.manifestSha256
          || restoreFileBinding(parsed.backupPath).sha256 !== parsed.backupSha256) fail("restore settlement backup binding mismatch");
        sameRestoreFile(parsed.authorityPath, parsed.staged);
        for (const suffix of ["-wal", "-shm"] as const) {
          if (existsSync(`${parsed.authorityPath}${suffix}`)) fail("restore settlement companion outcome unproved");
        }
        if (verified.authorityGeneration !== parsed.authorityGeneration
          || verified.authorityContentFingerprint !== parsed.authorityContentFingerprint) fail("restore settlement authority proof mismatch");
        sameRestoreFile(parsed.authorityPath, parsed.staged);
        assertRestoreSuspect(parsed);
        assertRestoreCredentialSnapshot(locator, parsed.profile);
        if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-restore-erasure-pending");
        const continuityPath = join(control, "profile-registry.json"), registryPath = join(locator.stateRoot, "machine", "profiles.json");
        const continuity = readStrict(continuityPath, ProfileContinuitySchema);
        if (pending.invalidation === undefined) {
          const document = readMachineRegistry(control, locator, false);
          if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(parsed.profile.continuity)) fail("profile-restore-control-changed");
          const next = advanceProfileRegistryDocument(document, { sessionGeneration: document.sessionGeneration + 1 });
          pending = AuthorityRestoreJournalSchema.parse({ ...pending, invalidation: { priorDocument: document, document: next, continuity } });
          atomicJson(join(control, "journal.json"), pending);
        }
        const invalidation = pending.invalidation;
        if (invalidation === undefined) fail("profile-restore-invalidation-missing");
        if (invalidation.priorDocument.installationId !== locator.installationId || invalidation.document.installationId !== locator.installationId
          || canonicalJsonStringify(invalidation.continuity) !== canonicalJsonStringify(parsed.profile.continuity)
          || canonicalJsonStringify(profileRegistryWitness(locator.installationId, registryPath, invalidation.priorDocument)) !== canonicalJsonStringify(invalidation.continuity)
          || canonicalJsonStringify(invalidation.document) !== canonicalJsonStringify(advanceProfileRegistryDocument(invalidation.priorDocument,
            { sessionGeneration: invalidation.priorDocument.sessionGeneration + 1 }))) fail("profile-restore-invalidation-uncertain");
        const currentDocument = readStrict(registryPath, ProfileRegistryDocumentSchema);
        if (canonicalJsonStringify(currentDocument) !== canonicalJsonStringify(invalidation.document)
          && canonicalJsonStringify(currentDocument) !== canonicalJsonStringify(invalidation.priorDocument)) fail("profile-restore-invalidation-uncertain");
        const nextContinuity = profileRegistryWitness(locator.installationId, registryPath, invalidation.document);
        if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(invalidation.continuity)
          && canonicalJsonStringify(continuity) !== canonicalJsonStringify(nextContinuity)) fail("profile-restore-invalidation-control-changed");
        if (canonicalJsonStringify(currentDocument) !== canonicalJsonStringify(invalidation.document)) prepareRegistryWrite(locator, currentDocument, invalidation.document, "profile-authority-restored")();
        atomicJson(continuityPath, nextContinuity);
        sameRestoreFile(parsed.authorityPath, parsed.staged);
        assertRestoreSuspect(parsed);
        atomicJson(join(control, `automatic-repair-${parsed.profile.binding.profileId}.json`), {
          schemaVersion: 1, installationId: locator.installationId, profileId: parsed.profile.binding.profileId,
          operationId: parsed.operationId, backupTime: parsed.backupTime, restoredAt: parsed.restoredAt,
          authorityGeneration: parsed.authorityGeneration, manifestFileName: basename(parsed.manifestPath) });
        unlinkSync(join(control, "journal.json")); fsyncPath(control);
      });
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
  prepareBrowserInventory(plan: boolean, createProbe: BrowserProfileProbeFactory): Promise<void>;
  registeredProfileIds(): readonly string[];
  profileInventory(profileId: string): StoppedControlProfileInventory;
  recordProfileInventory(claim: StoppedControlProfileInventory, proof: StoppedControlCredentialAttestation): void;
  run(plan: boolean): Promise<Readonly<{ state: "current" | "planned" | "upgraded"; runtimeAccess: "onboarding-incomplete" | "unchanged"; profileCount: number; receiptId?: string }>>;
  release(): void;
}

export interface StoppedControlProfileInventory { readonly profileId: string }

const stoppedControlInventories = new WeakMap<StoppedControlProfileInventory, Readonly<{
  binding: z.infer<typeof ProfileDatabaseBindingSchema>; stateRoot: string; artifactRoot: string; machineRoot: string; locator: RuntimeLocator;
  schemaVersion: 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30; conversionOperationId: string; backupDirectory: string;
  pendingPlan(): CanonicalCredentialConversionPlan | undefined;
  assertCanonicalConversion(operationId: string, digest: string): void;
  assertCanonicalPublication(operationId: string, digest: string): void;
  readonly lifetime: RuntimeLifetimeLock;
  readonly sessionGeneration: number;
  browserPlan(): StoppedBrowserRootsDocument | undefined;
  publishBrowserPlan(expected: StoppedBrowserRootsDocument, document: StoppedBrowserRootsDocument): void;
  assertHeld(): void; revalidateSource(): void; retainSourceClosure(error: unknown): void; readInstallationContext(): ReturnType<InstallationLease["readInstallationContext"]>;
} & ({ credentialFormat: "legacy"; key: z.infer<typeof CredentialKeyWitnessSchema>; head: z.infer<typeof CredentialErasureHeadSchema>; duo: DuoContinuityRow }
  | { credentialFormat: "canonical" })>>();

export function requireStoppedControlProfileInventory(value: StoppedControlProfileInventory) {
  const issued = stoppedControlInventories.get(value);
  if (issued === undefined) fail("profile-control-upgrade-inventory-unissued");
  issued.assertHeld();
  return issued;
}

const CONTROL_UPGRADE_RECEIPT_MAX_BYTES = 128 * 1024 * 1024;
function assertControlUpgradeReceiptCapacity(receipt: unknown, reservedBytes: number): void {
  if (Buffer.byteLength(`${JSON.stringify(receipt)}\n`) + reservedBytes > CONTROL_UPGRADE_RECEIPT_MAX_BYTES) fail("profile-control-upgrade-evidence-too-large");
}
function writeControlUpgradeReceipt(path: string, receipt: StoppedControlUpgradeReceipt): void {
  assertControlUpgradeReceiptCapacity(receipt, 0);
  atomicJson(path, receipt);
}

function readControlUpgradeReceipt(path: string): StoppedControlUpgradeReceipt {
  assertNoSymlinkComponents(path);
  const file = readPrivateFile(path, { label: "lock", maxBytes: CONTROL_UPGRADE_RECEIPT_MAX_BYTES });
  if (file === undefined) fail("profile-control-upgrade-evidence-missing");
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
  if (!z.looseObject({ schemaVersion: z.literal(3) }).safeParse(value).success) fail("profile-control-upgrade-pending-conversion-unsupported");
  return StoppedControlUpgradeReceiptSchema.parse(value);
}

function controlUpgradeFile(path: string, maxBytes = 1_048_576) {
  assertNoSymlinkComponents(path);
  const file = readPrivateFile(path, { label: "lock", maxBytes });
  if (file === undefined) fail("profile-control-upgrade-evidence-missing");
  return { ...fileIdentityObservation(file.identity, { preserveSafeNumbers: true }), digest: createHash("sha256").update(file.bytes).digest("hex") };
}

function retainedControlUpgradeEntry(directory: string, name: string, installationId: string): z.infer<typeof RetainedControlUpgradeEntrySchema> {
  const path = join(directory, name);
  assertNoSymlinkComponents(path);
  const metadata = fileStatus(path);
  if (metadata.isFile()) {
    const maxBytes = name.endsWith(".receipt.json") && z.uuid().safeParse(name.slice(0, -13)).success
      ? CONTROL_UPGRADE_RECEIPT_MAX_BYTES : 16 * 1024 * 1024;
    return RetainedControlUpgradeEntrySchema.parse({ kind: "file", name, file: controlUpgradeFile(path, maxBytes) });
  }
  if (!metadata.isDirectory() || !/^[0-9a-f-]{36}\.[0-9a-f-]{36}\.authority$/u.test(name)) fail("profile-control-upgrade-retained-backup-membership");
  const [operationId, profileId] = z.tuple([z.uuid(), z.uuid(), z.literal("authority")]).parse(name.split("."));
  privateDirectory(path);
  const names = readdirSync(path).sort();
  const manifestName = names.find(value => /^authority-g\d+-\d+-[0-9a-f-]{36}\.sqlite\.manifest\.json$/u.test(value));
  if (names.length !== 2 || manifestName === undefined) fail("profile-control-upgrade-retained-backup-membership");
  const fileName = manifestName.slice(0, -14);
  if (!names.includes(fileName)) fail("profile-control-upgrade-retained-backup-membership");
  const manifest = readProfileEvidence(join(path, manifestName), AuthorityBackupManifestSchema);
  const backup = controlUpgradeFile(join(path, fileName), 512 * 1024 * 1024);
  if (manifest.installationId !== installationId || manifest.profileId !== profileId
    || manifest.backupFileName !== fileName || manifest.sha256 !== backup.digest
    || manifest.byteSize !== privateFileNumber(fileStatus(join(path, fileName)).size)) fail("profile-control-upgrade-retained-backup-changed");
  const receiptPath = join(directory, `${operationId}.receipt.json`);
  assertNoSymlinkComponents(receiptPath);
  const file = readPrivateFile(receiptPath, { label: "lock", maxBytes: CONTROL_UPGRADE_RECEIPT_MAX_BYTES });
  if (file === undefined) fail("profile-control-upgrade-retained-backup-membership");
  const receipt = z.looseObject({ schemaVersion: z.literal(2), phase: z.literal("publishing"), operationId: z.uuid(),
    installationId: z.uuid(), backups: ControlUpgradeBackupsSchema }).parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
  const matching = receipt.backups.filter(row => row.profileId === profileId && row.directory === name);
  const verified = matching.length === 1 ? matching[0]?.verifiedBackup : undefined;
  if (receipt.operationId !== operationId || receipt.installationId !== installationId || verified === undefined
    || verified.manifestSha256 !== controlUpgradeFile(join(path, manifestName), 64_000).digest
    || canonicalJsonStringify(verified.manifest) !== canonicalJsonStringify(manifest)) fail("profile-control-upgrade-retained-backup-membership");
  return RetainedControlUpgradeEntrySchema.parse({ kind: "authority-directory", name, ...fileIdentityObservation({ device: metadata.dev, inode: metadata.ino }, { preserveSafeNumbers: true }),
    files: names.map(member => ({ name: member, file: member === fileName ? backup : controlUpgradeFile(join(path, member), 64_000) })) });
}

function sameControlUpgradeFile(path: string, expected: z.infer<typeof ControlUpgradeFileSchema>, maxBytes = 1_048_576): boolean {
  return lstatMaybe(path) !== undefined && canonicalJsonStringify(controlUpgradeFile(path, maxBytes)) === canonicalJsonStringify(expected);
}

function assertPriorRegistryLogicalBinding(locator: RuntimeLocator, prior: z.infer<typeof StoppedProfileContinuitySchema>, document: z.infer<typeof StoppedProfileRegistryDocumentSchema>): void {
  if ("revision" in prior ? document.schemaVersion !== 3 || document.installationId !== locator.installationId
    || prior.revision !== document.revision : document.schemaVersion !== 2) fail("profile-control-upgrade-prior-mismatch");
  const operations = profileOperationInventory(locator.stateRoot);
  const logicalOperations = prior.operations.map(({ operationId, digest }) => ({ operationId, digest }));
  if (prior.installationId !== locator.installationId || prior.generation !== document.sessionGeneration
    || prior.digest !== createHash("sha256").update(canonicalJsonStringify(document)).digest("hex")
    || canonicalJsonStringify(logicalOperations) !== canonicalJsonStringify(operations)) fail("profile-control-upgrade-prior-mismatch");
}

function priorControlUpgradeEvidence(locator: RuntimeLocator, prior: z.infer<typeof StoppedProfileContinuitySchema>, document = readProfileEvidence(join(locator.stateRoot, "machine", "profiles.json"), StoppedProfileRegistryDocumentSchema), plans: readonly { profileId: string; plan: CanonicalCredentialConversionPlan }[] = [], browsers?: StoppedBrowserRootsDocument, assertBinding = assertCanonicalProfileBinding): string {
  const browserPath = join(locator.stateRoot, "machine", "browser-roots.json");
  if (lstatMaybe(browserPath) !== undefined && (browsers === undefined || canonicalJsonStringify(parseStoppedBrowserRootUpgradeSource(readProfileEvidence(browserPath, z.unknown()))) !== canonicalJsonStringify(publishedBrowserDocument(browsers)))) fail("profile-control-upgrade-browser-source-changed");
  if (prior.schemaVersion === 5 || prior.schemaVersion === 6) {
    assertPriorRegistryLogicalBinding(locator, prior, document);
    if (document.profiles.some(row => row.lifecycle !== "ready" || row.credentialState !== "saved") || plans.length !== 0) fail("profile-control-upgrade-pending-conversion-unsupported");
    const machine = join(locator.stateRoot, "machine"), known = ["profiles.json", "profile-registry-version.json", "profile-verifiers.json", "profile-pepper", "credential-keys", "credential-operations", "operations", "duo-credentials", ...(browsers === undefined ? [] : ["browser-roots.json"])];
    privateDirectory(machine);
    if (readdirSync(machine).some(name => !known.includes(name))) fail("profile-control-upgrade-machine-membership-unknown");
    for (const name of ["credential-keys", "duo-credentials"]) {
      const directory = join(machine, name); privateDirectory(directory);
      if (canonicalJsonStringify(readdirSync(directory).sort()) !== canonicalJsonStringify(document.profiles.map(row => `${row.profileId}.json`).sort())) fail("profile-control-upgrade-credential-membership");
    }
    const operations = profileOperationInventory(locator.stateRoot).map(row => readProfileEvidence(join(machine, "operations", `${row.operationId}.json`), ProfileOperationSchema));
    if (operations.some(row => row.kind !== "logout" || row.phase !== "complete")) fail("profile-control-upgrade-operation-pending");
    const verifiers = readProfileEvidence(join(machine, "profile-verifiers.json"), ProfileVerifierDocumentSchema);
    if (canonicalJsonStringify(verifiers.profiles.map(row => row.profileId).sort()) !== canonicalJsonStringify(document.profiles.map(row => row.profileId).sort())) fail("profile-control-upgrade-verifier-membership");
    const pepper = readPrivateFile(join(machine, "profile-pepper"), { label: "lock", maxBytes: 32 });
    if (pepper?.bytes.length !== 32) fail("profile-control-upgrade-pepper-invalid");
    const profiles = document.profiles.map(profile => {
      const root = join(locator.stateRoot, "profiles", profile.profileId), path = join(root, "state.db");
      assertBinding(path, { installationId: locator.installationId, profileId: profile.profileId });
      if (lstatMaybe(join(machine, "credential-operations", `${profile.profileId}.json`))) throw new CredentialMaintenanceHold("CREDENTIAL_OPERATION_PENDING");
      const head = readProfileEvidence(join(machine, "credential-keys", `${profile.profileId}.json`), CanonicalCredentialHeadSchema);
      if (head.state !== "active" || head.installationId !== locator.installationId || head.profileId !== profile.profileId) fail("profile-control-upgrade-canonical-head-unavailable");
      for (const record of prior.completedRestores.filter(row => row.profile.profileId === profile.profileId)) assertCompletedRestoreCustody(locator, record);
      const database = fileStatus(path);
      return { profileId: profile.profileId, head, database: { ...fileIdentityObservation({ device: database.dev, inode: database.ino }, { preserveSafeNumbers: true }), size: privateFileNumber(database.size), ...fileTimestampMilliseconds(database) },
        files: [join(machine, "credential-keys", `${profile.profileId}.json`), join(root, "credentials", "protected.json"), join(root, "credentials", "chatgpt-account.json"), join(machine, "duo-credentials", `${profile.profileId}.json`)]
          .map(path => ({ path, file: controlUpgradeFile(path, 25 * 1024 * 1024) })) };
    });
    return canonicalJsonStringify({ prior, profiles, verifiers: controlUpgradeFile(join(machine, "profile-verifiers.json")), pepper: controlUpgradeFile(join(machine, "profile-pepper")) });
  }
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
  const known = new Set([...(browsers === undefined ? [] : ["browser-roots.json"]), "profiles.json", "profile-registry-version.json", "profile-verifiers.json", "profile-pepper", "credential-keys", "erasures", "operations", ...(prior.schemaVersion !== 1 || plans.length !== 0 ? ["duo-credentials"] : []), ...(plans.length !== 0 ? ["credential-operations"] : [])]);
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
    assertBinding(path, { installationId: locator.installationId, profileId: row.profileId });
    const metadata = fileStatus(path);
    const conversion = plans.find(plan => plan.profileId === row.profileId)?.plan.operation;
    const credentialFiles = [join(locator.stateRoot, "machine", "credential-keys", `${row.profileId}.json`),
      join(root, "credentials", "protected.json"), join(root, "credentials", "chatgpt-account.json")].map(path => {
      const file = readPrivateFile(path, { label: "protected.json", maxBytes: 25 * 1024 * 1024 });
      const actual = file === undefined ? { state: "absent" as const } : { state: "present" as const,
        ...fileIdentityObservation(file.identity, { preserveSafeNumbers: true }), digest: createHash("sha256").update(file.bytes).digest("hex") };
      if (conversion === undefined) return { path, file: actual };
      const head = dirname(path) === join(machine, "credential-keys");
      const planned = head ? conversion.priorHead : conversion.files.find(file => file.kind === (basename(path) === "protected.json" ? "protected" : "chatgpt"))?.prior;
      if (planned === undefined) fail("profile-control-upgrade-plan-membership");
      const published = head ? Buffer.from(canonicalJsonStringify(conversion.head)) : Buffer.from(conversion.files.find(file => file.kind === (basename(path) === "protected.json" ? "protected" : "chatgpt"))?.bytes ?? "", "base64");
      if (canonicalJsonStringify(actual) !== canonicalJsonStringify(planned) && (file === undefined || !file.bytes.equals(published))) fail("profile-control-upgrade-credential-source-changed");
      return { path, file: planned };
    });
    return { profileId: row.profileId, credentialFiles, database: { ...fileIdentityObservation({ device: metadata.dev, inode: metadata.ino }, { preserveSafeNumbers: true }),
      size: privateFileNumber(metadata.size), ...fileTimestampMilliseconds(metadata) } };
  });
  return canonicalJsonStringify({ prior, profiles, verifiers: controlUpgradeFile(join(machine, "profile-verifiers.json")), pepper: controlUpgradeFile(join(machine, "profile-pepper")) });
}

function readProcessCustodyFile(path: string, maxBytes = 1_048_576) {
  const parent = dirname(path), before = fileStatus(path);
  if (realpathSync(parent) !== parent || !fileStatus(parent).isDirectory() || !before.isFile() || before.isSymbolicLink()
    || (before.nlink !== 1 && before.nlink !== 1n) || before.size > maxBytes || privatePathRejects(path, before, "private")) throw new Error("worker-process-recovery-file-unsafe");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Buffer | undefined, primary: { error: unknown } | undefined;
  try {
    const opened = descriptorStatus(descriptor);
    if (opened.dev !== before.dev || opened.ino !== before.ino) throw new Error("worker-process-recovery-source-changed");
    bytes = readFileSync(descriptor);
    const after = descriptorStatus(descriptor);
    const live = fileStatus(path);
    const identity = (stat: typeof before) => [stat.dev, stat.ino, stat.mode, stat.uid, stat.nlink, stat.size, fileModified(stat), fileChanged(stat)].map(value => typeof value === "bigint" ? value.toString() : value);
    if (canonicalJsonStringify(identity(before)) !== canonicalJsonStringify(identity(after))
      || canonicalJsonStringify(identity(before)) !== canonicalJsonStringify(identity(live)) || bytes.length !== privateFileNumber(before.size)) throw new Error("worker-process-recovery-source-changed");
  } catch (error) { primary = { error }; }
  try { closeSync(descriptor); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { descriptor: { descriptor, identity: before } }); }
  if (primary !== undefined) throw primary.error;
  if (bytes === undefined) throw new Error("worker-process-recovery-read-unproved");
  return { bytes, witness: { path, ...fileIdentityObservation({ device: before.dev, inode: before.ino }), digest: createHash("sha256").update(bytes).digest("hex") } };
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
      const stat = fileStatus(path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || privatePathRejects(path, stat, "group-write")) fail("worker-process-recovery-root-unsafe");
      return { path, ...fileIdentityObservation({ device: stat.dev, inode: stat.ino }, { preserveSafeNumbers: true }), mode: privateFileNumber(stat.mode), owner: privateFileNumber(stat.uid) };
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
function convertedProfileControl(locator: RuntimeLocator, _prior: z.infer<typeof StoppedProfileContinuitySchema>, document: ProfileRegistryDocument) {
  return profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document);
}
function publishedBrowserDocument(plan: StoppedBrowserRootsDocument): StoppedBrowserRootsDocument {
  if (plan.roots.some(row => row.launch.state !== "closed" || row.native?.phase !== "observed")) fail("profile-control-upgrade-browser-closure-unproved");
  return parseStoppedBrowserRootUpgradeSource({ ...plan, roots: plan.roots.map(({ native: _native, ...row }) => row) });
}
function validateStoppedControlUpgrade(control: string, locator: RuntimeLocator, receipt: StoppedControlUpgradeReceipt,
  readRetained: (name: string) => z.infer<typeof RetainedControlUpgradeEntrySchema> = name => retainedControlUpgradeEntry(join(control, "profile-control-upgrades"), name, locator.installationId),
  assertBinding = assertCanonicalProfileBinding) {
  const backupDirectory = join(control, "profile-control-upgrades"), registryPath = join(locator.stateRoot, "machine", "profiles.json"),
  controlPath = join(control, "profile-registry.json"), markerPath = join(locator.stateRoot, "machine", "profile-registry-version.json");
  if (receipt.installationId !== locator.installationId
    || canonicalJsonStringify(convertedProfileRegistry(locator, receipt.priorDocument)) !== canonicalJsonStringify(receipt.document)
    || canonicalJsonStringify(convertedProfileControl(locator, receipt.prior, receipt.document)) !== canonicalJsonStringify(receipt.current)
    || priorControlUpgradeEvidence(locator, receipt.prior, receipt.priorDocument, receipt.credentials, receipt.browsers, assertBinding) !== receipt.sourceEvidence) fail("profile-control-upgrade-source-changed");
  if (receipt.browsers.installationId !== locator.installationId || receipt.browsers.roots.some(row => row.native?.operationId !== receipt.operationId
    || !receipt.document.profiles.some(profile => profile.profileId === row.profileId))) fail("profile-control-upgrade-browser-membership");
  if (receipt.phase !== "preparing") {
    const expectedCredentials = receipt.prior.schemaVersion === 5 || receipt.prior.schemaVersion === 6 ? [] : receipt.document.profiles.map(row => row.profileId).sort();
    if (canonicalJsonStringify(receipt.credentials.map(row => row.profileId).sort()) !== canonicalJsonStringify(expectedCredentials)
      || canonicalJsonStringify(receipt.backups.map(row => row.profileId).sort()) !== canonicalJsonStringify(receipt.document.profiles.map(row => row.profileId).sort())) fail("profile-control-upgrade-plan-membership");
    publishedBrowserDocument(receipt.browsers);
  }
  const prefix = join(backupDirectory, receipt.operationId);
  privateDirectory(backupDirectory);
  const expectedNames = [...receipt.retained.map(row => row.name), ...receipt.backups.filter(row => lstatMaybe(join(backupDirectory, row.directory))).map(row => row.directory), ...["registry", "control", "marker"].map(role => `${receipt.operationId}.${role}.before.json`),
    ...["registry.stage", "control.stage", "marker.stage", "browser.stage", "receipt.json"].filter(suffix => lstatMaybe(`${prefix}.${suffix}`)).map(suffix => `${receipt.operationId}.${suffix}`)];
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
  for (const row of receipt.retained) if (canonicalJsonStringify(readRetained(row.name)) !== canonicalJsonStringify(row)) fail("profile-control-upgrade-retained-changed");
  for (const [role, expected] of [["registry", receipt.registryBackup], ["control", receipt.controlBackup], ["marker", receipt.markerBackup]] as const) {
    if (!sameControlUpgradeFile(`${prefix}.${role}.before.json`, expected)) fail("profile-control-upgrade-backup-changed");
  }
  if (canonicalJsonStringify(readProfileEvidence(`${prefix}.registry.before.json`, StoppedProfileRegistryDocumentSchema)) !== canonicalJsonStringify(receipt.priorDocument)
    || canonicalJsonStringify(readProfileEvidence(`${prefix}.control.before.json`, StoppedProfileContinuitySchema)) !== canonicalJsonStringify(receipt.prior)) fail("profile-control-upgrade-backup-diverged");
  readProfileEvidence(`${prefix}.marker.before.json`, z.strictObject({ schemaVersion: z.literal(receipt.prior.schemaVersion + 1) }));
  const browserPath = join(locator.stateRoot, "machine", "browser-roots.json"), browserStage = `${prefix}.browser.stage`;
  if (receipt.phase === "preparing") {
    if (lstatMaybe(browserPath) || lstatMaybe(browserStage)) fail("profile-control-upgrade-publication-uncertain");
  } else {
    const path = lstatMaybe(browserStage) ? browserStage : browserPath;
    if (!sameControlUpgradeFile(path, receipt.browserStage) || canonicalJsonStringify(parseStoppedBrowserRootUpgradeSource(readProfileEvidence(path, z.unknown()))) !== canonicalJsonStringify(publishedBrowserDocument(receipt.browsers))) fail("profile-control-upgrade-browser-stage-changed");
    if (lstatMaybe(browserStage) && lstatMaybe(browserPath)) fail("profile-control-upgrade-publication-uncertain");
    if (!lstatMaybe(browserStage) && receipt.phase !== "publishing") fail("profile-control-upgrade-publication-uncertain");
  }
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
  readProfileEvidence(staged("marker", markerPath), z.strictObject({ schemaVersion: z.literal(8) }));
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
  try {
    const marker = readProfileEvidence(markerPath, z.strictObject({ schemaVersion: z.number().int() }));
    if (marker.schemaVersion !== 8 || lstatMaybe(intentPath)) assertMaintenanceCustodyAvailable("schema-upgrade");
  } catch (error) {
    if (ownsLease) {
      try { restore.release(); lease.release(); }
      catch (cleanup) { throw retainAuthoritySourceClosure([error, cleanup], { admission: lease, restore }); }
    }
    throw error;
  }
  const conversionOperationId = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath).operationId : randomUUID();
  const inventoryClaims = new Map<string, StoppedControlProfileInventory>();
  const inventorySnapshots = new Set<Readonly<{ dispose(): void }>>();
  const bindingProofs = new Map<string, ReturnType<typeof captureCanonicalProfileBinding>>();
  const assertBinding: typeof assertCanonicalProfileBinding = (path, expected) => {
    const key = canonicalJsonStringify([path, expected]);
    let proof = bindingProofs.get(key);
    if (proof === undefined) {
      proof = captureCanonicalProfileBinding(path, expected);
      inventorySnapshots.add(proof); bindingProofs.set(key, proof);
    }
    proof.assertUnchanged();
  };
  const controlEvidence = (prior: z.infer<typeof StoppedProfileContinuitySchema>, document?: z.infer<typeof StoppedProfileRegistryDocumentSchema>,
    plans?: readonly { profileId: string; plan: CanonicalCredentialConversionPlan }[], browsers?: StoppedBrowserRootsDocument) =>
    priorControlUpgradeEvidence(locator, prior, document, plans, browsers, assertBinding);
  const retainedAncestry = new Map<string, DirectoryIdentity>();
  const retainedProofs = new Map<string, { paths: readonly string[]; witness: string; entry: z.infer<typeof RetainedControlUpgradeEntrySchema> }>();
  const readRetained = (name: string): z.infer<typeof RetainedControlUpgradeEntrySchema> => {
    if (!noSymlinkAncestry(backupDirectory, retainedAncestry)) fail("profile-control-upgrade-retained-changed");
    const cached = retainedProofs.get(name);
    if (cached !== undefined) {
      if (profileRegistryStatWitness(backupDirectory, locator, cached.paths) !== cached.witness) fail("profile-control-upgrade-retained-changed");
      return cached.entry;
    }
    const path = join(backupDirectory, name), paths = [backupDirectory, path];
    if (lstatSync(path).isDirectory()) {
      const [operationId] = z.tuple([z.uuid(), z.uuid(), z.literal("authority")]).parse(name.split("."));
      paths.push(...readdirSync(path).sort().map(member => join(path, member)), join(backupDirectory, `${operationId}.receipt.json`));
    }
    const witness = profileRegistryStatWitness(backupDirectory, locator, paths);
    const entry = retainedControlUpgradeEntry(backupDirectory, name, locator.installationId);
    if (profileRegistryStatWitness(backupDirectory, locator, paths) !== witness) fail("profile-control-upgrade-retained-changed");
    retainedProofs.set(name, { paths, witness, entry });
    return entry;
  };
  const validateControl = (receipt: StoppedControlUpgradeReceipt) => validateStoppedControlUpgrade(control, locator, receipt, readRetained, assertBinding);
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
    lifetime.assertOfflineMaintenance(restore, workspace);
    if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-control-upgrade-locator-changed");
    if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-control-upgrade-publication-pending");
  }
  const registryPath = join(locator.stateRoot, "machine", "profiles.json");
  function finish(receipt: StoppedControlUpgradeReceipt, afterPublication: readonly (() => void)[]): void {
    held();
    retainedProofs.clear();
    const stages = validateControl(receipt);
    const prefix = join(backupDirectory, receipt.operationId);
    if (receipt.phase !== "publishing" || receipt.backups.some(row => row.verifiedBackup === undefined)) fail("profile-control-upgrade-verified-backup-required");
    const browserPath = join(locator.stateRoot, "machine", "browser-roots.json"), browserStage = `${prefix}.browser.stage`;
    if (lstatMaybe(browserStage)) { renameSync(browserStage, browserPath); fsyncPath(dirname(browserPath)); fsyncPath(backupDirectory); }
    if (!sameControlUpgradeFile(browserPath, receipt.browserStage)) fail("profile-control-upgrade-browser-readback");
    for (const [path, stage] of stages) {
      if (lstatMaybe(stage)) renameSync(stage, path);
      fsyncPath(dirname(path)); fsyncPath(backupDirectory);
    }
    for (const [path, , , after] of stages) if (!sameControlUpgradeFile(path, after)) fail("profile-control-upgrade-readback-failed");
    if (controlEvidence(receipt.prior, receipt.priorDocument, receipt.credentials, receipt.browsers) !== receipt.sourceEvidence) fail("profile-control-upgrade-source-changed");
    for (const revalidate of afterPublication) revalidate();
    if (lstatMaybe(`${prefix}.receipt.json`)) {
      if (canonicalJsonStringify(readControlUpgradeReceipt(`${prefix}.receipt.json`)) !== canonicalJsonStringify(receipt)) fail("profile-control-upgrade-receipt-changed");
    } else writeControlUpgradeReceipt(`${prefix}.receipt.json`, receipt);
    unlinkSync(intentPath); fsyncPath(control);
    readMachineRegistry(control, locator, false);
    held();
  }
  return Object.freeze({ installationId: locator.installationId,
    async prepareBrowserInventory(plan: boolean, createProbe: BrowserProfileProbeFactory): Promise<void> {
      held();
      if (this.machineControlCurrent() && !this.upgradeIntentPresent()) return;
      assertMaintenanceCustodyAvailable("schema-upgrade");
      const pending = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath) : undefined;
      if (pending !== undefined) {
        if (plan) fail("profile-control-upgrade-recovery-required");
        validateControl(pending);
        if (pending.phase !== "preparing") return;
      }
      const prior = pending?.prior ?? readProfileEvidence(controlPath, StoppedProfileContinuitySchema);
      const priorDocument = pending?.priorDocument ?? readProfileEvidence(registryPath, StoppedProfileRegistryDocumentSchema);
      const sourceEvidence = controlEvidence(prior, priorDocument, pending?.credentials, pending?.browsers);
      const claims = priorDocument.profiles.map(profile => this.profileInventory(profile.profileId));
      const { assertStoppedCredentialSourceFormat } = await import("../configuration/credential-conversion.js");
      const { RuntimeAdmission } = await import("./admission.js");
      const admissions = claims.map(claim => RuntimeAdmission.forStoppedControlInventory(claim));
      let primary: { error: unknown } | undefined;
      try {
        for (const [index, claim] of claims.entries()) {
          const admission = admissions[index]; if (admission === undefined) fail("profile-control-upgrade-inventory-required");
          assertStoppedCredentialSourceFormat(admission, claim);
        }
        if (!plan) {
          const { planStoppedBrowserRoots, probeStoppedControlBrowserRoots } = await import("../browser-roots.js");
          if (pending === undefined) {
            let browsers: BrowserRootsDocument = BrowserRootsSchema.parse({ schemaVersion: 3, installationId: locator.installationId, revision: 0, nextHandle: 1, nextGeneration: 1, roots: [] });
            for (const [index, claim] of claims.entries()) {
              const admission = admissions[index]; if (admission === undefined) fail("profile-control-upgrade-inventory-required");
              const planned = planStoppedBrowserRoots(admission, claim, browsers.nextGeneration, browsers.nextHandle, systemClock);
              browsers = BrowserRootsSchema.parse({ ...browsers, nextHandle: planned.nextHandle, nextGeneration: planned.nextGeneration, roots: [...browsers.roots, ...planned.roots] });
            }
            const document = convertedProfileRegistry(locator, priorDocument), current = convertedProfileControl(locator, prior, document), operationId = conversionOperationId;
            withInstallationControl(control, () => {
              held();
              if (lstatMaybe(intentPath) || controlEvidence(prior, priorDocument) !== sourceEvidence) fail("profile-control-upgrade-source-changed");
              const retained = lstatMaybe(backupDirectory) ? readdirSync(backupDirectory).sort().map(readRetained) : [];
              ControlUpgradeCommonSchema.shape.retained.parse(retained);
              ControlUpgradeCommonSchema.shape.sourceEvidence.parse(sourceEvidence);
              assertControlUpgradeReceiptCapacity({ schemaVersion: 3, operationId, installationId: locator.installationId,
                phase: "preparing", credentials: [], backups: [], browsers, prior, current, priorDocument, document, retained, sourceEvidence }, 12 * 256);
              if (!lstatMaybe(backupDirectory)) { createPrivateDirectory(backupDirectory, { mode: 0o700 }); fsyncPath(control); }
              privateDirectory(backupDirectory);
              const prefix = join(backupDirectory, operationId), originals = [registryPath, controlPath, markerPath].map(path => {
                const file = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 }); if (file === undefined) fail("profile-control-upgrade-evidence-missing"); return file;
              });
              const before = [controlUpgradeFile(registryPath), controlUpgradeFile(controlPath), controlUpgradeFile(markerPath)] as const;
              for (const [index, role] of ["registry", "control", "marker"].entries()) {
                const file = originals[index]; if (file === undefined) fail("profile-control-upgrade-evidence-missing");
                writePrivateStage(`${prefix}.${role}.before.json`, file.bytes);
                if (controlUpgradeFile(`${prefix}.${role}.before.json`).digest !== before[index]?.digest) fail("profile-control-upgrade-backup-diverged");
              }
              writePrivateStage(`${prefix}.registry.stage`, Buffer.from(JSON.stringify(document)));
              writePrivateStage(`${prefix}.control.stage`, Buffer.from(JSON.stringify(current)));
              writePrivateStage(`${prefix}.marker.stage`, Buffer.from(JSON.stringify({ schemaVersion: 8 })));
              fsyncPath(backupDirectory);
              const receipt = ControlUpgradeReceiptSchema.parse({ schemaVersion: 3, operationId, installationId: locator.installationId,
                phase: "preparing", credentials: [], backups: [], browsers, prior, current, priorDocument, document, retained,
                priorRegistry: before[0], priorControl: before[1], priorMarker: before[2],
                registryBackup: controlUpgradeFile(`${prefix}.registry.before.json`), controlBackup: controlUpgradeFile(`${prefix}.control.before.json`), markerBackup: controlUpgradeFile(`${prefix}.marker.before.json`),
                registryStage: controlUpgradeFile(`${prefix}.registry.stage`), controlStage: controlUpgradeFile(`${prefix}.control.stage`), markerStage: controlUpgradeFile(`${prefix}.marker.stage`), sourceEvidence });
              writeControlUpgradeReceipt(intentPath, receipt); validateControl(receipt);
            });
          }
          for (const [index, claim] of claims.entries()) {
            const admission = admissions[index]; if (admission === undefined) fail("profile-control-upgrade-inventory-required");
            const config = ConfigSchema.shape.browser.parse(undefined), timeouts = ConfigSchema.shape.timeouts.parse(undefined);
            await probeStoppedControlBrowserRoots(admission, claim, createProbe({ clock: systemClock, closeProofMs: config.closeProofMs,
              launchTimeoutMs: timeouts.sessionAcquireMs, signal: new AbortController().signal }));
          }
        }
      } catch (error) { primary = { error }; }
      if (primary !== undefined && hasUnprovedSourceClosure(primary.error)) { lease.retainSourceClosure(primary.error); retainUnprovedSourceOwners(primary.error, { admission: { lease, admissions }, restore }); throw primary.error; }
      for (const admission of admissions) {
        try { admission.release(); } catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error], { admission: { lease, admissions }, restore }); }
      }
      if (primary !== undefined) throw primary.error;
    },
    machineControlCurrent(): boolean {
      held();
      const observedMarker = readProfileEvidence(markerPath, z.strictObject({ schemaVersion: z.number().int() }));
      if (![2, 3, 4, 5, 6, 7, 8].includes(observedMarker.schemaVersion)) fail("profile-control-upgrade-pending-conversion-unsupported");
      return observedMarker.schemaVersion === 8;
    },
    upgradeIntentPresent(): boolean {
      held();
      return lstatMaybe(intentPath) !== undefined;
    },
    registeredProfileIds(): readonly string[] {
      held();
      if (this.machineControlCurrent() && !this.upgradeIntentPresent()) return readMachineRegistry(control, locator, false).profiles.map((row) => row.profileId);
      return (lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath).priorDocument : readProfileEvidence(registryPath, StoppedProfileRegistryDocumentSchema)).profiles.map(row => row.profileId);
    },
    profileInventory(profileId: string): StoppedControlProfileInventory {
      held();
      const existing = inventoryClaims.get(profileId);
      if (existing !== undefined) {
        const source = requireStoppedControlProfileInventory(existing); source.assertHeld();
        const issued = Object.freeze({ profileId: existing.profileId });
        stoppedControlInventories.set(issued, source); issuedInventoryClaims.add(issued);
        return issued;
      }
      const pending = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath) : undefined;
      const prior = pending?.prior ?? readProfileEvidence(controlPath, StoppedProfileContinuitySchema);
      if (pending === undefined) readProfileEvidence(markerPath, z.strictObject({ schemaVersion: z.literal(prior.schemaVersion + 1) }));
      else if ((!sameControlUpgradeFile(registryPath, pending.priorRegistry) && !sameControlUpgradeFile(registryPath, pending.registryStage))
        || (!sameControlUpgradeFile(controlPath, pending.priorControl) && !sameControlUpgradeFile(controlPath, pending.controlStage))
        || (!sameControlUpgradeFile(markerPath, pending.priorMarker) && !sameControlUpgradeFile(markerPath, pending.markerStage))) fail("profile-control-upgrade-publication-uncertain");
      if (!(pending?.priorDocument ?? readProfileEvidence(registryPath, StoppedProfileRegistryDocumentSchema)).profiles.some(row => row.profileId === z.uuid().parse(profileId))) fail("profile-control-upgrade-profile-unavailable");
      const priorDocument = pending?.priorDocument ?? readProfileEvidence(registryPath, StoppedProfileRegistryDocumentSchema);
      const evidence = controlEvidence(prior, priorDocument, pending?.credentials, pending?.browsers), controlIdentity = controlUpgradeFile(controlPath), markerIdentity = controlUpgradeFile(markerPath);
      const snapshot = createReadonlyAuthoritySnapshot(join(locator.stateRoot, "profiles", profileId, "state.db"));
      inventorySnapshots.add(snapshot);
      const revalidateSource = () => {
        held(); snapshot.assertUnchanged();
        if (controlEvidence(prior, priorDocument, lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath).credentials : undefined, lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath).browsers : undefined) !== evidence) fail("profile-control-upgrade-inventory-source-changed");
      };
      const assertHeld = () => {
        held(); snapshot.assertUnchanged();
        if (lstatMaybe(intentPath)) {
          const receipt = readControlUpgradeReceipt(intentPath);
          if (receipt.operationId !== conversionOperationId) fail("profile-control-upgrade-inventory-expired");
          validateControl(receipt);
          if (receipt.sourceEvidence !== evidence) fail("profile-control-upgrade-inventory-source-changed");
        } else {
          if (!sameControlUpgradeFile(controlPath, controlIdentity) || !sameControlUpgradeFile(markerPath, markerIdentity)) fail("profile-control-upgrade-inventory-expired");
          if (controlEvidence(prior, priorDocument) !== evidence) fail("profile-control-upgrade-inventory-source-changed");
        }
      };
      const binding = ProfileDatabaseBindingSchema.parse({ installationId: locator.installationId, profileId });
      const databaseBinding = readProfileDatabaseBinding(join(locator.stateRoot, "profiles", profileId, "state.db"));
      if (databaseBinding.state !== "bound" || !OPENABLE_AUTHORITY_SCHEMA_VERSIONS.includes(databaseBinding.schemaVersion)
        || canonicalJsonStringify(databaseBinding.binding) !== canonicalJsonStringify(binding)) fail("profile-control-upgrade-database-schema-unsupported");
      const schemaVersion = z.union([z.literal(8), z.literal(9), z.literal(10), z.literal(11), z.literal(12), z.literal(13), z.literal(14), z.literal(15), z.literal(16), z.literal(17), z.literal(18), z.literal(19), z.literal(20), z.literal(21), z.literal(22), z.literal(23), z.literal(24), z.literal(25), z.literal(26), z.literal(27), z.literal(28), z.literal(29), z.literal(30)]).parse(databaseBinding.schemaVersion);
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
      const credential = prior.schemaVersion === 5 || prior.schemaVersion === 6 ? undefined : prior.erasures.find(row => row.profileId === profileId);
      if (prior.schemaVersion !== 5 && prior.schemaVersion !== 6 && credential?.credentialKey === undefined) fail("profile-control-upgrade-credential-conversion-required");
      const credentialSource = prior.schemaVersion === 5 || prior.schemaVersion === 6 ? { credentialFormat: "canonical" as const }
        : { credentialFormat: "legacy" as const, key: credential?.credentialKey ?? fail("profile-control-upgrade-credential-conversion-required"),
          head: credential?.head ?? fail("profile-control-upgrade-credential-conversion-required"),
          duo: prior.schemaVersion === 1 ? { state: "never-initialized" as const, profileId, revision: 0 as const }
            : prior.duo.find(row => row.profileId === profileId) ?? fail("duo-profile-membership-mismatch") };
      stoppedControlInventories.set(issued, Object.freeze({ binding: Object.freeze(binding), stateRoot, artifactRoot: join(stateRoot, "artifacts"), machineRoot: locator.stateRoot,
        ...credentialSource, lifetime, sessionGeneration: priorDocument.sessionGeneration,
        browserPlan() { assertHeld(); return lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath).browsers : undefined; },
        publishBrowserPlan(expected, document) {
          withInstallationControl(control, () => {
            assertHeld();
            const receipt = readControlUpgradeReceipt(intentPath);
            if (receipt.phase !== "preparing" || canonicalJsonStringify(receipt.browsers) !== canonicalJsonStringify(expected)) fail("profile-control-upgrade-browser-plan-changed");
            const next = parseStoppedBrowserRootUpgradeSource(document);
            if (next.schemaVersion !== expected.schemaVersion || next.installationId !== locator.installationId || next.revision !== expected.revision + 1
              || next.nextGeneration !== expected.nextGeneration || next.roots.length !== expected.roots.length) fail("profile-control-upgrade-browser-plan-changed");
            writeControlUpgradeReceipt(intentPath, StoppedControlUpgradeReceiptSchema.parse({ ...receipt, browsers: next }));
            if (canonicalJsonStringify(readControlUpgradeReceipt(intentPath).browsers) !== canonicalJsonStringify(next)) fail("profile-control-upgrade-browser-plan-readback");
          });
        },
        schemaVersion, conversionOperationId, backupDirectory: join(backupDirectory, `${conversionOperationId}.${profileId}.authority`), pendingPlan, assertCanonicalConversion, assertCanonicalPublication, locator: Object.freeze({ ...locator }), assertHeld, revalidateSource,
        retainSourceClosure: error => lease.retainSourceClosure(error), readInstallationContext: () => { assertHeld(); return lease.readInstallationContext(); } }));
      assertHeld(); issuedInventoryClaims.add(issued); inventoryClaims.set(profileId, issued);
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
        if (this.machineControlCurrent() && !this.upgradeIntentPresent()) {
          const registrations = readMachineRegistry(control, locator, false);
          const runtimeAccess = registrations.profiles.some(row => row.registration.onboardingCompletion === undefined)
            ? "onboarding-incomplete" as const : "unchanged" as const;
          return { state: "current" as const, runtimeAccess, profileCount: registrations.profiles.length };
        }
        assertMaintenanceCustodyAvailable("schema-upgrade");
        const pending = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath) : undefined;
        const registrations = pending?.priorDocument ?? readProfileEvidence(registryPath,
          z.union([ProfileRegistryDocumentSchema, StoppedProfileRegistryDocumentSchema]));
        const runtimeAccess = registrations.profiles.some(row => row.registration.onboardingCompletion === undefined)
          ? "onboarding-incomplete" as const : "unchanged" as const;
        if (pending === undefined) {
          if (this.machineControlCurrent()) return { state: "current" as const, runtimeAccess, profileCount: readMachineRegistry(control, locator, false).profiles.length };
          const prior = readProfileEvidence(controlPath, StoppedProfileContinuitySchema);
          const document = readProfileEvidence(registryPath, StoppedProfileRegistryDocumentSchema);
          controlEvidence(prior, document);
          if (plan) return { state: "planned" as const, runtimeAccess, profileCount: document.profiles.length };
          fail("profile-control-upgrade-browser-preparation-required");
        }
        if (plan) fail("profile-control-upgrade-recovery-required");
        publicationProofs(pending.document.profiles);
        validateControl(pending);
        if (pending.phase !== "preparing") return { receipt: pending, runtimeAccess };
        const browserDocument = publishedBrowserDocument(pending.browsers);
        const credentials = pending.document.profiles.flatMap(profile => {
          const entry = inventoryProofs.get(profile.profileId); if (entry === undefined) fail("profile-control-upgrade-inventory-required");
          const inventory = readStoppedCredentialConversion(entry.proof, entry.claim);
          return inventory.plan === undefined ? [] : [{ profileId: profile.profileId, plan: inventory.plan }];
        });
        const backups = pending.document.profiles.map(profile => ({ profileId: profile.profileId, directory: `${pending.operationId}.${profile.profileId}.authority` }));
        // Reserve the fixed stage witness and each bounded 64 KB backup manifest before effects.
        assertControlUpgradeReceiptCapacity({ ...pending, phase: "backing-up", credentials, backups }, 256 + backups.length * 64_128);
        const stage = join(backupDirectory, `${pending.operationId}.browser.stage`);
        writePrivateStage(stage, Buffer.from(canonicalJsonStringify(browserDocument))); fsyncPath(backupDirectory);
        const receipt = StoppedControlUpgradeReceiptSchema.parse({ ...pending, phase: "backing-up", credentials, browserStage: controlUpgradeFile(stage), backups });
        writeControlUpgradeReceipt(intentPath, receipt); validateControl(receipt);
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
        receipt = StoppedControlUpgradeReceiptSchema.parse({ ...receipt, backups: receipt.backups.map(backup => backup.profileId === row.profileId ? { ...backup, verifiedBackup } : backup) });
        withInstallationControl(control, () => { held(); const currentReceipt = StoppedControlUpgradeReceiptSchema.parse(receipt); validateControl(currentReceipt); writeControlUpgradeReceipt(intentPath, currentReceipt); });
      }
      receipt = StoppedControlUpgradeReceiptSchema.parse({ ...receipt, phase: "publishing" });
      withInstallationControl(control, () => { held(); const currentReceipt = StoppedControlUpgradeReceiptSchema.parse(receipt); validateControl(currentReceipt); writeControlUpgradeReceipt(intentPath, currentReceipt); });
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
        inventoryProofs.clear(); issuedInventoryClaims.clear(); bindingProofs.clear(); retainedProofs.clear(); retainedAncestry.clear();
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
