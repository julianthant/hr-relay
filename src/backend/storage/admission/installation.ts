import { preparedProfileVerifierPepperWitness, verifyPreparedProfileVerifier, type PreparedProfileVerifier } from "../configuration/verifier-store.js";
import { verifyExistingDataBackupFiles } from "../maintenance/existing-data-backup.js";
import { AuthoritySourceClosureUnprovedError, retainAuthoritySourceClosure } from "../source-closure.js";
import { readPrivateFile, writePrivateStage } from "../configuration/credential-safe-file.js";
import { erasureRequestIdentity, IncompleteProfileDraftCaptureSchema, profileAuthorityFileWitnesses, verifyIncompleteProfileDraft, type IncompleteProfileDraftWitness, unpublishedDraftAbortSourcePath, UnpublishedDraftAbortCaptureSchema, verifyUnpublishedDraftAbort, unpublishedDraftAbortMembership, type UnpublishedDraftAbortWitness, CredentialKeyStagePublicationSchema, observeCredentialKeyStageIntent, assertCredentialKeyStagePublication, verifyCommittedCredentialKeyStage, type CommittedCredentialKeyStage, type CredentialKeyStagePublication, CredentialInitializationPublicationSchema, assertCredentialInitializationPublication, verifyCommittedCredentialInitialization, verifyCommittedCredentialKey, type CommittedCredentialInitialization, type CredentialInitializationPublication, verifyCommittedCredentialWitness, CredentialKeyWitnessSchema, verifyCredentialKeyHead, assertCredentialKeyWitness, assertUnpublishedCredentialKey, verifyCommittedCredentialErasureOrigin, CredentialErasureHeadSchema, assertCredentialErasureHeadFiles, verifyCredentialErasureHead, verifyCredentialErasureIntent, type CredentialErasureHead, type VerifiedCredentialErasureHead, type VerifiedCredentialErasureIntent, type CommittedCredentialWitness, releaseStoppedControlCredentialAttestation, verifyStoppedControlCredentialAttestation, type StoppedControlCredentialAttestation, inspectProfileCredentialsForControlUpgrade } from "../configuration/credential-store.js";
import { assertProfileRestoreDatabaseBinding, assertCanonicalProfileBinding } from "../sqlite/profile-local-databases.js";
import { ProfileDatabaseBindingSchema } from "../../../models/profiles/profile.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION } from "../sqlite/migrations.js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../app/config/runtime-isolation.js";
import { acquireRuntimeRestoreAdmission, observeProcessIdentity, observeRuntimeLockSnapshot, ProcessStartIdentitySchema, RestoreAdmissionFileSchema,
  assertRuntimeRestoreAdmission, type ProcessStartIdentity, type RestoreAdmissionHandle, authoritySourceDatabaseIdentity, RUNTIME_PROCESS_LOCK_NAMES, runtimeProcessLockIsActive, inspectRuntimeProcessOrphans } from "../sqlite/runtime-process-locks.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { storageRelocationDesiredDigest } from "../../../rules/commands/commands.js";
import { NonNegativeIntSchema } from "../../../rules/identity/ids.js";
import { systemClock } from "../../../rules/time/clock.js";
import { ConfigSnapshotRecordSchema, ConfigSnapshotWriteSchema } from "../../../models/config/snapshot.js";
import { ActiveRuntimeConfigRecordSchema } from "../../../models/config/runtime-generation.js";

import { SignUpOperationSchema, LogoutOperationSchema, type ProfileOperation } from "../../../models/profiles/profile.js";
import { ProfileRegistryDocumentSchema, ProfileRegistryRowSchema, ProfileVerifierDocumentSchema, ProfileOnboardingCompletionSchema,
  assertFinishedProfileOnboarding, deriveProfileNames, type ProfileRegistryDocument } from "../../../models/profiles/profile.js";
import { createReadonlyAuthoritySnapshot } from "../sqlite/readonly-authority-snapshot.js";
import { DuoContinuityRowSchema, type DuoContinuityRow } from "../../../models/config/duo-credential-store.js";
import { DuoPublicationCaptureSchema, assertDuoDocumentWitness, assertDuoPublishedFile, duoStagePath, prepareIssuedDuoTransaction, verifyIssuedDuoTransaction, resumeIssuedDuoTransaction, issuedDuoDraftOperation, readDuoPublicationEnvelope, type IssuedDuoTransaction } from "../configuration/duo-credential-store.js";


const ProfileOperationSchema = z.union([SignUpOperationSchema, LogoutOperationSchema]);
const ProfileOperationMutationSchema = z.union([z.strictObject({ kind: z.literal("write"), operation: ProfileOperationSchema }), z.strictObject({ kind: z.literal("delete"), operationId: z.uuid() })]);
const ProfileErasureHeadSchema = z.strictObject({ profileId: z.uuid(), originOperationId: z.uuid(), head: CredentialErasureHeadSchema, credentialKey: CredentialKeyWitnessSchema.optional() });
const ErasureRequestIdentitySchema = z.strictObject({ commandId: z.uuid(), writeId: z.uuid(), commandFingerprint: z.string().regex(/^[0-9a-f]{64}$/u), expectedRevision: z.number().int().nonnegative(), updatedAt: z.string().datetime(), requestReceipt: z.string().min(1) });
export type ErasureRequestIdentity = z.infer<typeof ErasureRequestIdentitySchema>;
const PriorProfileContinuitySchema = z.strictObject({ schemaVersion: z.literal(1), installationId: z.uuid(),
  digest: z.string().regex(/^[0-9a-f]{64}$/u), device: z.number().int().nonnegative(), inode: z.number().int().nonnegative(), generation: z.number().int().nonnegative(), erasures: z.array(ProfileErasureHeadSchema).max(10_000), operations: z.array(z.strictObject({ operationId: z.uuid(), digest: z.string().regex(/^[0-9a-f]{64}$/u), device: z.number().int().nonnegative(), inode: z.number().int().nonnegative() })) });

const ProfileContinuitySchema = PriorProfileContinuitySchema.extend({ schemaVersion: z.literal(2), duo: z.array(DuoContinuityRowSchema).max(10_000) });
const ProfilePublicationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("onboarding-finish"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    operation: SignUpOperationSchema, priorDocument: ProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema,
    priorVerifiers: ProfileVerifierDocumentSchema, verifiers: ProfileVerifierDocumentSchema,
    key: CredentialKeyWitnessSchema, head: CredentialErasureHeadSchema, pepper: CredentialKeyWitnessSchema.shape.file,
    protectedFile: CredentialKeyWitnessSchema.shape.file, databases: IncompleteProfileDraftCaptureSchema.shape.databases }),
  z.strictObject({ kind: z.literal("incomplete-profile-draft"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    capture: IncompleteProfileDraftCaptureSchema, priorDocument: ProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema,
    priorVerifiers: ProfileVerifierDocumentSchema, verifiers: ProfileVerifierDocumentSchema }),
  z.strictObject({ kind: z.literal("draft-abort"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    capture: UnpublishedDraftAbortCaptureSchema }),
  z.strictObject({ kind: z.literal("draft-duo"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    capture: DuoPublicationCaptureSchema, priorOperation: SignUpOperationSchema, operation: SignUpOperationSchema }),
  z.strictObject({ kind: z.literal("duo"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema, capture: DuoPublicationCaptureSchema }),
  z.strictObject({ kind: z.literal("credential-key"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    priorDocument: ProfileRegistryDocumentSchema, document: ProfileRegistryDocumentSchema, capture: CredentialInitializationPublicationSchema }),
  z.strictObject({ kind: z.literal("profile"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    document: ProfileRegistryDocumentSchema, duo: z.array(DuoContinuityRowSchema).max(10_000), operation: ProfileOperationMutationSchema.optional(), keyStage: CredentialKeyStagePublicationSchema.optional(), erasures: z.array(ProfileErasureHeadSchema).max(10_000) }),
  z.strictObject({ kind: z.literal("draft-erasure"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    profileId: z.uuid(), request: ErasureRequestIdentitySchema, nextEpoch: z.number().int().positive(), nextDigest: z.string().regex(/^[0-9a-f]{64}$/u),
    operation: SignUpOperationSchema, source: CredentialKeyWitnessSchema.shape.file, priorHead: z.strictObject({ state: z.literal("never-erased"), epoch: z.literal(0) }), settledHead: CredentialErasureHeadSchema.optional() }),
  z.strictObject({ kind: z.literal("erasure"), schemaVersion: z.literal(1), installationId: z.uuid(), prior: ProfileContinuitySchema,
    profileId: z.uuid(), request: ErasureRequestIdentitySchema, nextEpoch: z.number().int().positive(), nextDigest: z.string().regex(/^[0-9a-f]{64}$/u) }),
]);

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
const LeaseSchema = z.strictObject({ schemaVersion: z.literal(1), admissionId: z.uuid(), mode: z.enum(["shared", "exclusive"]), pid: z.number().int().positive(), processIdentity: ProcessStartIdentitySchema });
const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const ControlUpgradeFileSchema = z.strictObject({ device: z.number().int().nonnegative(), inode: z.number().int().nonnegative(), digest: DigestSchema });

const ControlUpgradeReceiptSchema = z.strictObject({ schemaVersion: z.literal(1), operationId: z.uuid(), installationId: z.uuid(),
  prior: PriorProfileContinuitySchema, current: ProfileContinuitySchema,
  priorControl: ControlUpgradeFileSchema, priorMarker: ControlUpgradeFileSchema,
  controlBackup: ControlUpgradeFileSchema, markerBackup: ControlUpgradeFileSchema,
  controlStage: ControlUpgradeFileSchema, markerStage: ControlUpgradeFileSchema, sourceEvidence: z.string().max(16 * 1024 * 1024) });

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
const RestoreFileBindingSchema = z.strictObject({ dev: GenerationSchema, ino: GenerationSchema,
  byteSize: GenerationSchema, sha256: DigestSchema });
const ProfileRestoreContextSchema = z.strictObject({ binding: ProfileDatabaseBindingSchema, continuity: ProfileContinuitySchema,
  head: CredentialErasureHeadSchema, credentialKey: CredentialKeyWitnessSchema });
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
  invalidation: z.strictObject({ document: ProfileRegistryDocumentSchema, continuity: ProfileContinuitySchema }).optional() });
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
export type InstallationLease = Readonly<{ mode: "shared" | "exclusive"; locator: RuntimeLocator;
  assertHeld(): void; assertFixedProcessLockRoot(workspaceRoot: string, processLockRoot: string): void;
  readRelocationReceipts(): readonly RelocationCompletionReceipt[];
  readProfileRegistry(): ProfileRegistryDocument;
  commitProfileDuo(transaction: IssuedDuoTransaction): void;
  assertDraftDuoPublicationRecovery(operationId: string, profileId: string, generation: number): z.infer<typeof SignUpOperationSchema>;
  abortUnpublishedProfile(witness: UnpublishedDraftAbortWitness): void;
  reclassifyIncompleteProfile(witness: IncompleteProfileDraftWitness): void;
  claimExistingProfileData(witness: IncompleteProfileDraftWitness): void;
  commitProfileDuoIntent(transaction: IssuedDuoTransaction): void;
  capturePendingProfileLogout(operation: z.infer<typeof LogoutOperationSchema>): Readonly<{ assertHeld(): void }>;
  captureStoppedProfileUpgrade(profileId: string): Readonly<{ assertHeld(): void }>;
  captureProfileUpgradeHandoff(profileId: string): Readonly<{ consume(next: InstallationLease): void }>;
  assertProfileErasureHead(profileId: string, head: CredentialErasureHead): void;
  resumeProfileErasure(profileId: string, request: ErasureRequestIdentity, head: CredentialErasureHead): void;
  assertDraftErasureJournalRecovery(profileId: string, request: ErasureRequestIdentity, digest: string): void;
  beginProfileErasure(profileId: string, witness: VerifiedCredentialErasureIntent): void;
  settleProfileErasure(profileId: string, request: ErasureRequestIdentity, witness: VerifiedCredentialErasureHead): void;
  assertProfileCredentialKeyAnchor(profileId: string): boolean;
  publishProfileCredentialInitialization(profileId: string, witness: CommittedCredentialInitialization): void;
  publishProfileRegistration(operation: z.infer<typeof SignUpOperationSchema>, witness: CommittedCredentialWitness, verifier: PreparedProfileVerifier): void;
  publishProfileRegistry(expected: ProfileRegistryDocument, document: ProfileRegistryDocument): void;
  beginProfileSignUp(fields: Omit<z.infer<typeof SignUpOperationSchema>, "operationId" | "profileId" | "commandId" | "writeId" | "schemaVersion" | "kind" | "phase" | "onboarding" | "ownerClaim">): z.infer<typeof SignUpOperationSchema>;
  publishProfileOperation(operation: ProfileOperation | string, keyStage?: CommittedCredentialKeyStage): void;
  readProfileCredentialKeyStage(operation: z.infer<typeof SignUpOperationSchema>): CredentialKeyStagePublication | undefined;
  readInstallationContext(): Readonly<{ workspace: string; locator: RuntimeLocator; receipts: readonly RelocationCompletionReceipt[] }>;
  release(): void }>;
export type ExclusiveInstallationLease = InstallationLease & Readonly<{
  captureProfileRestore(profileId: string, witness: VerifiedCredentialErasureHead): ProfileRestoreContext;
  assertProfileRestoreHeld(input: AuthorityRestoreInput, restore: RestoreAdmissionHandle): void;
  readAuthorityRestore(operationId: string): AuthorityRestoreInput;
  beginAuthorityRestore(input: AuthorityRestoreInput, restore: RestoreAdmissionHandle): void;
  settleAuthorityRestore(input: AuthorityRestoreInput, outcome: "unchanged" | "replaced", verify: AuthorityRestoreVerifier, restore: RestoreAdmissionHandle): void;
  beginRelocation(destination: RuntimePair, plan: RelocationPlanBinding, restore: RestoreAdmissionHandle): string;
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
  if (stat === undefined || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) fail("managed source entry missing or unsafe");
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
function assertRestoreHeld(workspace: string, restore: RestoreAdmissionHandle | undefined): void {
  if (restore === undefined) fail("fixed restore admission required");
  const root = fixedLockRoot(workspace);
  assertRuntimeRestoreAdmission(restore, root);
  assertNoSymlinkComponents(root);
  privateDirectory(root);
  const lock = readStrict(join(root, "restore-admission.lock.json"), RestoreAdmissionFileSchema);
  const observed = identity();
  if (lock.schemaVersion !== 2 || lock.admissionId !== restore.admissionId || lock.pid !== process.pid
    || lock.processIdentity.platform !== observed.platform || lock.processIdentity.startToken !== observed.startToken) {
    fail("fixed restore admission identity mismatch");
  }
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
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o777) !== 0o700) fail(`unsafe directory ${path}`);
}
function dataDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o222) !== 0o200) fail(`unsafe data root ${path}`);
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
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o777) !== 0o600) fail(`unsafe file ${path}`);
}
function syncDir(path: string): void {
  const fd = openSync(path, "r");
  let primary: { error: unknown } | undefined, descriptorIdentity: ReturnType<typeof fstatSync> | undefined;
  try { descriptorIdentity = fstatSync(fd); fsyncSync(fd); } catch (error) { primary = { error }; }
  try { closeSync(fd); }
  catch (error) { throw retainAuthoritySourceClosure(primary === undefined ? [error] : [primary.error, error],
    { descriptor: { descriptor: fd, ...(descriptorIdentity === undefined ? {} : { identity: descriptorIdentity }) } }); }
  if (primary !== undefined) throw primary.error;
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
    if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o777) !== 0o600) fail(`unsafe file ${path}`);
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
    writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: "wx" });
    const fd = openSync(temp, "r");
    let syncFailure: { error: unknown } | undefined, descriptorIdentity: ReturnType<typeof fstatSync> | undefined;
    try { descriptorIdentity = fstatSync(fd); fsyncSync(fd); } catch (error) { syncFailure = { error }; }
    try { closeSync(fd); }
    catch (error) { throw retainAuthoritySourceClosure(syncFailure === undefined ? [error] : [syncFailure.error, error],
      { descriptor: { descriptor: fd, ...(descriptorIdentity === undefined ? {} : { identity: descriptorIdentity }) } }); }
    if (syncFailure !== undefined) throw syncFailure.error;
    if (lstatMaybe(path)) privateFile(path);
    renameSync(temp, path);
    syncDir(directory);
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
  let component = parse(path).root;
  for (const part of relative(component, path).split(/[\\/]/u)) {
    component = join(component, part);
    if (lstatMaybe(component)?.isSymbolicLink()) fail(`symlink in root path ${component}`);
  }
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
  if (!lstatMaybe(path)) { mkdirSync(path, { recursive: true, mode: 0o700 }); syncDir(resolve(path, "..")); }
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
let executingProcessIdentity: ProcessStartIdentity | undefined;
function identity(): ProcessStartIdentity {
  if (executingProcessIdentity !== undefined) return executingProcessIdentity;
  const observation = observeProcessIdentity(process.pid);
  if (observation.state !== "alive") fail("current process identity unavailable");
  executingProcessIdentity = Object.freeze({ ...observation.identity });
  return executingProcessIdentity;
}
function isLive(lease: z.infer<typeof LeaseSchema>): boolean {
  const observed = lease.pid === process.pid
    ? { state: "alive" as const, identity: identity() } : observeProcessIdentity(lease.pid);
  return observed.state === "alive" && observed.identity.platform === lease.processIdentity.platform && observed.identity.startToken === lease.processIdentity.startToken;
}
export class AdmissionMutexBusyError extends Error {
  constructor() {
    super("runtime-control: admission mutex remained busy after 5000ms");
    this.name = "AdmissionMutexBusyError";
  }
}
export class AdmissionMutexEmptyError extends AdmissionMutexBusyError {
  constructor() {
    super();
    this.name = "AdmissionMutexEmptyError";
    this.message = "runtime-control: empty admission mutex; run npm run cli -- storage recover-admission --empty";
  }
}
const mutexWait = new Int32Array(new SharedArrayBuffer(4));
function filesystemCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}
function mutexIdentityDigest(value: ProcessStartIdentity): string {
  return createHash("sha256").update(canonicalJsonStringify(value)).digest("hex");
}
const MutexRemnantName = /^\.admission-mutex-(?:tmp|released)-([1-9]\d*)-([0-9a-f]{64})-([0-9a-f-]{36})$/u;
function removeMutexFolder(path: string): void {
  privateDirectory(path);
  const entries = readdirSync(path);
  for (const name of entries) {
    if (name !== "owner.json" && !/^\.[0-9a-f-]{36}\.tmp$/u.test(name)) fail("unexpected mutex temporary entry");
    privateFile(join(path, name));
  }
  for (const name of entries) unlinkSync(join(path, name));
  rmdirSync(path);
}
function clearMutexRemnants(control: string): void {
  for (const name of readdirSync(control)) {
    const match = MutexRemnantName.exec(name);
    if (match === null) continue;
    if (!Number.isSafeInteger(Number(match[1])) || !z.uuid().safeParse(match[3]).success) fail("invalid mutex temporary identity");
    const observed = observeProcessIdentity(Number(match[1]));
    if (observed.state === "alive" && mutexIdentityDigest(observed.identity) === match[2]) continue;
    const path = join(control, name);
    try {
      privateDirectory(path);
      const ownerPath = join(path, "owner.json");
      if (lstatMaybe(ownerPath) !== undefined) {
        const owner = readStrict(ownerPath, MutexOwnerSchema);
        if (owner.pid !== Number(match[1]) || mutexIdentityDigest(owner.processIdentity) !== match[2]
          || owner.acquisitionId !== match[3]) fail("mutex temporary owner identity mismatch");
      }
      removeMutexFolder(path);
    } catch (error) { if (filesystemCode(error) !== "ENOENT") throw error; }
    syncDir(control);
  }
}
function mutex<T>(control: string, callback: () => T): T {
  privateDirectory(control);
  clearMutexRemnants(control);
  const path = join(control, "admission-mutex");
  const owner = { schemaVersion: 1, acquisitionId: randomUUID(), phase: "admitting", pid: process.pid, processIdentity: identity() };
  const suffix = `${owner.pid}-${mutexIdentityDigest(owner.processIdentity)}-${owner.acquisitionId}`;
  const temporary = join(control, `.admission-mutex-tmp-${suffix}`);
  const released = join(control, `.admission-mutex-released-${suffix}`);
  mkdirSync(temporary, { mode: 0o700 });
  let acquired = false;
  let result: { value: T } | undefined, primary: { error: unknown } | undefined;
  try {
    atomicJson(join(temporary, "owner.json"), owner);
    syncDir(control);
    const deadline = systemClock.monotonicMs() + 5_000;
    for (;;) {
      try {
        const occupied = lstatMaybe(path);
        if (occupied !== undefined) {
          privateDirectory(path);
          if (readdirSync(path).length === 0) {
            const current = lstatMaybe(path);
            if (current === undefined || current.dev !== occupied.dev || current.ino !== occupied.ino) continue;
            privateDirectory(path);
            if (readdirSync(path).length === 0) throw new AdmissionMutexEmptyError();
            continue;
          }
        } else {
          renameSync(temporary, path);
          acquired = true;
          syncDir(control);
          break;
        }
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY", "ENOENT"].includes(String(filesystemCode(error)))) throw error;
      }
      const remaining = deadline - systemClock.monotonicMs();
      if (remaining <= 0) throw new AdmissionMutexBusyError();
      Atomics.wait(mutexWait, 0, 0, Math.min(10, remaining));
    }
    result = { value: callback() };
  } catch (error) { primary = { error }; }
  if (!acquired && primary?.error instanceof AuthoritySourceClosureUnprovedError) {
    throw retainAuthoritySourceClosure([primary.error], { directory: { path: temporary, owner, control } });
  }
  let cleanupFailure: { error: unknown } | undefined;
  try {
    if (acquired) {
      privateDirectory(path);
      const held = readStrict(join(path, "owner.json"), MutexOwnerSchema);
      if (held.acquisitionId !== owner.acquisitionId || held.pid !== owner.pid
        || mutexIdentityDigest(held.processIdentity) !== mutexIdentityDigest(owner.processIdentity)) fail("admission mutex ownership changed");
      renameSync(path, released);
      syncDir(control);
      removeMutexFolder(released);
    } else removeMutexFolder(temporary);
    syncDir(control);
  } catch (error) { cleanupFailure = { error }; }
  const errors = [...(primary === undefined ? [] : [primary.error]), ...(cleanupFailure === undefined ? [] : [cleanupFailure.error])];
  if (errors.some(error => error instanceof AuthoritySourceClosureUnprovedError)) throw retainAuthoritySourceClosure(errors, {});
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "installation-mutex-cleanup-failed", { cause: errors[0] });
  if (result === undefined) throw new Error("installation-mutex-result-missing");
  return result.value;
}
const MutexOwnerSchema = z.strictObject({ schemaVersion: z.literal(1), acquisitionId: z.uuid(),
  phase: z.literal("admitting"), pid: z.number().int().positive(), processIdentity: ProcessStartIdentitySchema });
function assertLiveObservationMutex(control: string): void {
  const path = join(control, "admission-mutex"), before = lstatMaybe(path);
  if (before === undefined) return;
  try {
    privateDirectory(path);
    const entries = readdirSync(path);
    if (entries.length !== 1 || entries[0] !== "owner.json") fail("profile-registry-mutex-custody-unavailable");
    const ownerPath = join(path, "owner.json");
    const file = readPrivateFile(ownerPath, { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined) {
      if (lstatMaybe(path) === undefined) return;
      fail("profile-registry-mutex-custody-unavailable");
    }
    const owner = MutexOwnerSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
    const observed = observeProcessIdentity(owner.pid);
    if (observed.state !== "alive" || observed.identity.platform !== owner.processIdentity.platform
      || observed.identity.startToken !== owner.processIdentity.startToken) fail("profile-registry-mutex-custody-unavailable");
    const after = lstatMaybe(path);
    if (after === undefined) return;
    if (before.dev !== after.dev || before.ino !== after.ino) fail("profile-registry-observation-changed");
    const current = readPrivateFile(ownerPath, { label: "lock", maxBytes: 1_048_576 });
    if (current === undefined) {
      if (lstatMaybe(path) === undefined) return;
      fail("profile-registry-mutex-custody-unavailable");
    }
    privateDirectory(path);
    const currentDirectory = lstatSync(path), currentEntries = readdirSync(path);
    if (before.dev !== currentDirectory.dev || before.ino !== currentDirectory.ino
      || currentEntries.length !== 1 || currentEntries[0] !== "owner.json"
      || file.identity.device !== current.identity.device || file.identity.inode !== current.identity.inode
      || !file.bytes.equals(current.bytes)) fail("profile-registry-observation-changed");
  } catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) throw error;
    if ((filesystemCode(error) === "ENOENT" || (error instanceof Error && filesystemCode(error.cause) === "ENOENT"))
      && lstatMaybe(path) === undefined) return;
    throw error;
  }
}
const OwnerMutexRecoveryReceiptSchema = z.strictObject({ schemaVersion: z.literal(1), acquisitionId: z.uuid(),
  pid: z.number().int().positive(), processIdentity: ProcessStartIdentitySchema,
  installationId: z.uuid(), generation: NonNegativeIntSchema, ownerFile: z.string().min(1),
  ownerSha256: z.string().regex(/^[0-9a-f]{64}$/u), recoveredAt: z.iso.datetime() });

const EmptyMutexRecoveryReceiptSchema = z.strictObject({ schemaVersion: z.literal(1), custody: z.literal("empty"),
  acquisitionId: z.uuid(), installationId: z.uuid(), generation: NonNegativeIntSchema,
  directoryDevice: NonNegativeIntSchema, directoryInode: NonNegativeIntSchema, recoveredAt: z.iso.datetime() });
const MutexRecoveryReceiptSchema = z.union([OwnerMutexRecoveryReceiptSchema, EmptyMutexRecoveryReceiptSchema]);

/** Explicit offline recovery. The restore lock serializes recoveries; the occupied mutex excludes ordinary admission until the final rename. */
export function recoverAbandonedAdmissionMutex(workspacePath: string, restore: RestoreAdmissionHandle,
  expectedPid: number | "empty"): Readonly<{ acquisitionId: string; pid?: number; receiptPath: string }> {
  const workspace = realpathSync(workspacePath);
  if (resolve(workspacePath) !== workspace) fail("recovery workspace must be canonical");
  const control = join(workspace, CONTROL);
  assertNoSymlinkComponents(control);
  privateDirectory(control);
  assertRestoreHeld(workspace, restore);
  const mutexPath = join(control, "admission-mutex");
  privateDirectory(mutexPath);
  const mutexBefore = lstatSync(mutexPath);
  const allowedControl = new Set(["installation.json", "locator.json", "leases", "admission-mutex",
    "admission-mutex-recovery", "profile-registry.json", RECEIPTS]);
  if (readdirSync(control).some(entry => !allowedControl.has(entry))) fail("unexpected installation control entry");
  const entries = readdirSync(mutexPath);
  const empty = expectedPid === "empty";
  if (entries.length !== (empty ? 0 : 1)) fail("abandoned mutex has unexpected entries");
  const name = entries[0];
  if (!empty && name !== "owner.json") {
    const match = /^\.([0-9a-f-]{36})\.tmp$/u.exec(name);
    if (match === null || !z.uuid().safeParse(match[1]).success) fail("abandoned mutex owner shape invalid");
  }
  const ownerPath = empty ? undefined : join(mutexPath, name);
  const before = ownerPath === undefined ? undefined : lstatSync(ownerPath);
  const bytes = ownerPath === undefined ? undefined : readFileSync(ownerPath);
  const owner = ownerPath === undefined ? undefined : readStrict(ownerPath, MutexOwnerSchema);
  if (owner !== undefined) {
    if (owner.pid !== expectedPid) fail("abandoned mutex expected pid mismatch");
    const observed = observeProcessIdentity(owner.pid);
    if (observed.state !== "gone" && (observed.state !== "alive"
      || observed.identity.platform === owner.processIdentity.platform
        && observed.identity.startToken === owner.processIdentity.startToken)) fail("admission mutex owner may still be live");
  }
  const leases = join(control, "leases");
  privateDirectory(leases);
  for (const leaseName of readdirSync(leases)) {
    if (!/^[-0-9a-f]+\.json$/u.test(leaseName)) fail("unexpected lease entry");
    const lease = readStrict(join(leases, leaseName), LeaseSchema);
    const observation = observeProcessIdentity(lease.pid);
    if (observation.state !== "gone" && (observation.state !== "alive"
      || observation.identity.platform === lease.processIdentity.platform
        && observation.identity.startToken === lease.processIdentity.startToken)) fail("installation lease may still be live");
  }
  if (lstatMaybe(join(control, "journal.json"))) fail("pending installation journal blocks mutex recovery");
  const locator = readLocator(control, workspace);
  readMachineRegistry(control, locator, false);
  const machineWitness = profileObservation(control, locator);
  const processLockRoot = fixedLockRoot(workspace);
  const lockSnapshot = observeRuntimeLockSnapshot({ processLockRoot,
    sourceDatabaseIdentity: "0".repeat(64) });
  if (lockSnapshot.processLocks.server.state !== "stopped"
    || lockSnapshot.processLocks.workers.state !== "stopped"
    || lockSnapshot.processLocks["live-smoke"].state !== "stopped"
    || lockSnapshot.processLocks.geocode.state !== "stopped") fail("runtime process lock may still be live");
  assertRestoreHeld(workspace, restore);
  privateDirectory(mutexPath);
  function assertCustody(): void {
    const currentLocator = readLocator(control, workspace);
    if (canonicalJsonStringify(currentLocator) !== canonicalJsonStringify(locator)) fail("installation locator changed during recovery");
    readMachineRegistry(control, currentLocator, false);
    if (profileObservation(control, currentLocator) !== machineWitness) fail("profile registry changed during mutex recovery");
    privateDirectory(mutexPath);
    const directory = lstatSync(mutexPath);
    const currentEntries = readdirSync(mutexPath);
    if (directory.dev !== mutexBefore.dev || directory.ino !== mutexBefore.ino
      || currentEntries.length !== (empty ? 0 : 1)) fail("admission mutex changed during recovery");
    if (ownerPath !== undefined && before !== undefined && bytes !== undefined) {
      privateFile(ownerPath);
      const current = lstatSync(ownerPath);
      if (currentEntries[0] !== name || current.dev !== before.dev || current.ino !== before.ino
        || current.size !== before.size || !readFileSync(ownerPath).equals(bytes)) fail("admission mutex changed during recovery");
    }
  }
  assertCustody();
  const history = join(control, "admission-mutex-recovery");
  if (lstatMaybe(history) === undefined) { mkdirSync(history, { mode: 0o700 }); syncDir(control); }
  privateDirectory(history);
  const acquisitionId = owner?.acquisitionId ?? randomUUID();
  const receipt = MutexRecoveryReceiptSchema.parse(owner === undefined ? {
    schemaVersion: 1, custody: "empty", acquisitionId, installationId: locator.installationId,
    generation: locator.generation, directoryDevice: mutexBefore.dev, directoryInode: mutexBefore.ino,
    recoveredAt: systemClock.now().toISOString(),
  } : { schemaVersion: 1, acquisitionId, pid: owner.pid,
    processIdentity: owner.processIdentity, installationId: locator.installationId,
    generation: locator.generation, ownerFile: name,
    ownerSha256: createHash("sha256").update(bytes!).digest("hex"), recoveredAt: systemClock.now().toISOString() });
  const destination = join(history, acquisitionId);
  const receiptPath = join(history, `${acquisitionId}.json`);
  if (lstatMaybe(destination)) fail("recovery archive already exists");
  if (lstatMaybe(receiptPath)) {
    const existing = readStrict(receiptPath, MutexRecoveryReceiptSchema);
    if (canonicalJsonStringify({ ...existing, recoveredAt: receipt.recoveredAt })
      !== canonicalJsonStringify(receipt)) fail("recovery receipt changed");
  } else atomicJson(receiptPath, receipt);
  assertRestoreHeld(workspace, restore);
  assertCustody();
  renameSync(mutexPath, destination);
  syncDir(history);
  syncDir(control);
  return Object.freeze({ acquisitionId, ...(owner === undefined ? {} : { pid: owner.pid }), receiptPath });
}

/** This inspection authorizes no recovery; the offline proof rechecks exact owner custody. */
export function admissionMutexOwnerProvenDead(workspacePath: string): boolean {
  const workspace = realpathSync(workspacePath);
  if (resolve(workspacePath) !== workspace) fail("recovery workspace must be canonical");
  const control = join(workspace, CONTROL);
  assertNoSymlinkComponents(control);
  privateDirectory(control);
  const mutexPath = join(control, "admission-mutex");
  if (lstatMaybe(mutexPath) === undefined) return false;
  privateDirectory(mutexPath);
  const entries = readdirSync(mutexPath);
  if (entries.length === 0) return false;
  if (entries.length !== 1) fail("abandoned mutex has unexpected entries");
  const name = entries[0];
  if (name !== "owner.json") {
    const match = /^\.([0-9a-f-]{36})\.tmp$/u.exec(name);
    if (match === null || !z.uuid().safeParse(match[1]).success) fail("abandoned mutex owner shape invalid");
  }
  const owner = readStrict(join(mutexPath, name), MutexOwnerSchema);
  const observed = observeProcessIdentity(owner.pid);
  return observed.state === "gone" || observed.state === "alive"
    && (observed.identity.platform !== owner.processIdentity.platform
      || observed.identity.startToken !== owner.processIdentity.startToken);
}

/** Startup uses the offline proof only for an exact abandoned owner in a settled installation. */
export function recoverAbandonedAdmissionMutexAtStartup(workspacePath: string): void {
  const workspace = realpathSync(workspacePath);
  if (resolve(workspacePath) !== workspace) fail("recovery workspace must be canonical");
  const control = join(workspace, CONTROL);
  assertNoSymlinkComponents(control);
  privateDirectory(control);
  const mutexPath = join(control, "admission-mutex");
  if (lstatMaybe(mutexPath) === undefined) return;
  privateDirectory(mutexPath);
  const entries = readdirSync(mutexPath);
  if (entries.length !== 1) fail("abandoned mutex has unexpected entries");
  const name = entries[0];
  if (name !== "owner.json") {
    const match = /^\.([0-9a-f-]{36})\.tmp$/u.exec(name);
    if (match === null || !z.uuid().safeParse(match[1]).success) fail("abandoned mutex owner shape invalid");
  }
  const owner = readStrict(join(mutexPath, name), MutexOwnerSchema);
  const observed = observeProcessIdentity(owner.pid);
  if (observed.state !== "gone" && (observed.state !== "alive"
    || observed.identity.platform === owner.processIdentity.platform
      && observed.identity.startToken === owner.processIdentity.startToken)) fail("admission mutex owner may still be live");
  const restore = acquireRuntimeRestoreAdmission({ processLockRoot: fixedLockRoot(workspace), pid: process.pid });
  try { recoverAbandonedAdmissionMutex(workspace, restore, owner.pid); }
  finally { restore.release(); }
}

function activeLeases(control: string): readonly z.infer<typeof LeaseSchema>[] {
  const directory = join(control, "leases");
  privateDirectory(directory);
  return readdirSync(directory).map((name) => {
    if (!/^[-0-9a-f]+\.json$/u.test(name)) fail("unexpected lease entry");
    return readStrict(join(directory, name), LeaseSchema);
  }).filter(isLive);
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
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o400
    || (process.getuid && stat.uid !== process.getuid())) fail("unsafe relocation tombstone");
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
  if (lstatMaybe(path)) { checkTombstone(path, expected); if (lstatMaybe(temp)) { checkTombstone(temp, expected); unlinkSync(temp); syncDir(dirname(path)); } return; }
  if (lstatMaybe(temp)) checkTombstone(temp, expected);
  else {
    writeFileSync(temp, `${canonicalJsonStringify(expected)}\n`, { mode: 0o400, flag: "wx" });
    const fd = openSync(temp, "r"); try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  renameSync(temp, path);
  syncDir(dirname(path));
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
    syncDir(dirname(row.source));
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
    syncDir(dirname(row.retained));
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
      syncDir(row.source);
      syncDir(row.retained);
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
    || (custody.mode & 0o022) !== 0 || process.getuid !== undefined && custody.uid !== process.getuid()) fail("unsafe restore data file");
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

function checkRestoreInput(locator: RuntimeLocator, input: AuthorityRestoreInput): void {
  for (const path of [input.authorityPath, input.stagedPath, input.suspectPath, input.manifestPath, input.backupPath]) {
    if (!isAbsolute(path) || resolve(path) !== path) fail("restore path must be absolute and canonical");
    assertNoSymlinkComponents(path);
  }
  const root = join(locator.stateRoot, "profiles", input.profile.binding.profileId);
  assertCredentialKeyWitness(join(locator.stateRoot, "machine", "credential-keys", `${input.profile.binding.profileId}.json`), input.profile.credentialKey, input.profile.binding);
  if (input.profile.binding.installationId !== locator.installationId || input.profile.continuity.installationId !== locator.installationId) fail("restore profile installation mismatch");
  const head = input.profile.continuity.erasures.find(row => row.profileId === input.profile.binding.profileId);
  if (head === undefined || canonicalJsonStringify(head.head) !== canonicalJsonStringify(input.profile.head)) fail("restore profile erasure context mismatch");
  if (input.authorityPath !== join(root, "state.db")
    || input.stagedPath !== join(root, `.restore-${input.operationId}.sqlite.tmp`)
    || dirname(input.suspectPath) !== join(root, "backups", "suspects")
    || dirname(input.backupPath) !== join(root, "backups", "authority") || dirname(input.manifestPath) !== join(root, "backups", "authority")
    || !basename(input.suspectPath).endsWith(`-${input.operationId}.sqlite`)
    || new Set(input.companions.map(row => row.suffix)).size !== input.companions.length) fail("restore path or companion binding mismatch");
}
function readLocator(control: string, workspace: string, recovery?: { installationId: string; fromGeneration: number; operationId: string },
  restoreRecovery?: { operationId: string; restoreAdmission: RestoreAdmissionHandle }): RuntimeLocator {
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
    const info = lstatSync(path);
    return { operationId: operation.operationId, digest: createHash("sha256").update(canonicalJsonStringify(operation)).digest("hex"), device: info.dev, inode: info.ino };
  });
}

function profileRegistryWitness(installationId: string, path: string, document: ProfileRegistryDocument, erasures: readonly z.infer<typeof ProfileErasureHeadSchema>[], duo: readonly DuoContinuityRow[]) {
  const info = lstatSync(path);
  privateFile(path);
  return ProfileContinuitySchema.parse({ schemaVersion: 2, installationId,
    digest: createHash("sha256").update(canonicalJsonStringify(document)).digest("hex"),
    device: info.dev, inode: info.ino, generation: document.sessionGeneration, erasures, duo, operations: profileOperationInventory(dirname(dirname(path))) });
}

function assertProfileCredentialKeyMembership(locator: RuntimeLocator, heads: readonly z.infer<typeof ProfileErasureHeadSchema>[], stagedPublication?: CredentialKeyStagePublication): void {
  const directory = join(locator.stateRoot, "machine", "credential-keys");
  if (!lstatMaybe(directory)) {
    if (heads.some(row => row.credentialKey !== undefined)) fail("credential-key-required");
    return;
  }
  privateDirectory(directory);
  const operations = profileOperationInventory(locator.stateRoot).map(row => readProfileEvidence(
    join(locator.stateRoot, "machine", "operations", `${row.operationId}.json`), ProfileOperationSchema));
  if (stagedPublication !== undefined) assertCredentialKeyStagePublication(locator.stateRoot, stagedPublication);
  for (const name of readdirSync(directory).sort()) {
    if (stagedPublication !== undefined && (name === `.credential-key.${stagedPublication.operation.operationId}.tmp` || name === `${stagedPublication.operation.profileId}.json`)) continue;
    if (name.startsWith(".credential-key.")) {
      const matching = operations.filter(operation => operation.kind === "sign-up" && name === `.credential-key.${operation.operationId}.tmp`
        && operation.credentialInitialization?.keyFile !== undefined);
      const operation = matching[0];
      if (matching.length !== 1 || operation?.kind !== "sign-up" || operation.credentialInitialization === undefined) fail("profile-credential-key-unowned");
      const witness = { keyId: operation.credentialInitialization.keyId, binding: { installationId: locator.installationId, profileId: operation.profileId }, file: operation.credentialInitialization.keyFile };
      assertCredentialKeyWitness(join(directory, name), CredentialKeyWitnessSchema.parse(witness), witness.binding);
      if (lstatMaybe(join(directory, `${operation.profileId}.json`))) fail("credential-key-stage-outcome-uncertain");
      continue;
    }
    if (!/^[0-9a-f-]{36}\.json$/u.test(name)) fail("profile-credential-key-unowned");
    const profileId = z.uuid().parse(name.slice(0, -5)), binding = { installationId: locator.installationId, profileId };
    const anchor = heads.find(row => row.profileId === profileId)?.credentialKey;
    if (anchor !== undefined) assertCredentialKeyWitness(join(directory, name), anchor, binding);
    else {
      const matching = operations.filter(operation => operation.kind === "sign-up" && operation.profileId === profileId && operation.credentialInitialization !== undefined);
      const operation = matching[0];
      if (matching.length !== 1 || operation?.kind !== "sign-up" || operation.credentialInitialization === undefined) fail("profile-credential-key-unowned");
      assertUnpublishedCredentialKey(join(directory, name), operation.credentialInitialization, binding);
    }
  }
  for (const operation of operations) if (operation.kind === "sign-up" && operation.credentialInitialization?.keyFile !== undefined
    && !heads.some(row => row.profileId === operation.profileId && row.credentialKey !== undefined)
    && stagedPublication?.operation.operationId !== operation.operationId) {
    assertCredentialKeyStagePublication(locator.stateRoot, { priorOperation: operation, operation,
      key: { keyId: operation.credentialInitialization.keyId, binding: { installationId: locator.installationId, profileId: operation.profileId }, file: operation.credentialInitialization.keyFile } });
  }
  for (const row of heads) if (row.credentialKey !== undefined) assertCredentialKeyWitness(join(directory, `${row.profileId}.json`), row.credentialKey,
    { installationId: locator.installationId, profileId: row.profileId });
}

function readMachineRegistry(control: string, locator: RuntimeLocator, recoverPublication = true, credentialPublication?: CredentialInitializationPublication, stagedPublication?: CredentialKeyStagePublication): ProfileRegistryDocument {
  const path = join(locator.stateRoot, "machine", "profiles.json");
  if (lstatMaybe(join(control, "profile-control-upgrade.json"))) fail("profile-control-upgrade-pending");
  assertNoSymlinkComponents(path);
  readProfileEvidence(join(locator.stateRoot, "machine", "profile-registry-version.json"), z.strictObject({ schemaVersion: z.literal(3) }));
  const document = readProfileEvidence(path, ProfileRegistryDocumentSchema);
  readProfileEvidence(join(locator.stateRoot, "machine", "profile-verifiers.json"), ProfileVerifierDocumentSchema);
  const pepperPath = join(locator.stateRoot, "machine", "profile-pepper");
  const pepper = readPrivateFile(pepperPath, { label: "lock", maxBytes: 32 });
  if (pepper === undefined || pepper.bytes.byteLength !== 32) fail("profile-verifier-evidence-invalid");
  const witnessPath = join(control, "profile-registry.json");
  const witness = readProfileEvidence(witnessPath, ProfileContinuitySchema);
  const intentPath = join(control, "profile-publication.json");
  if (lstatMaybe(intentPath)) {
    const intent = readProfileEvidence(intentPath, ProfilePublicationSchema);
    if (intent.kind === "onboarding-finish") {
      if (!recoverPublication) fail("profile-onboarding-finish-pending");
      settleProfileOnboardingFinish(control, locator, intent);
      return readMachineRegistry(control, locator, false);
    }
    if (intent.kind === "draft-erasure") {
      assertDraftErasureSource(locator, document, intent);
      if (canonicalJsonStringify(witness) !== canonicalJsonStringify(intent.prior)
        || canonicalJsonStringify(profileRegistryWitness(locator.installationId, path, document, witness.erasures, witness.duo)) !== canonicalJsonStringify(witness)) fail("profile-draft-erasure-control-changed");
      assertErasureMembership(document, witness.erasures); assertProfileCredentialKeyMembership(locator, witness.erasures); assertDuoMembership(locator, document, witness.duo);
      for (const row of witness.erasures) assertCredentialErasureHeadFiles(erasurePath(locator, row.profileId), row.head);
      return document;
    }
    if (intent.kind === "incomplete-profile-draft") {
      if (!recoverPublication) fail("profile-incomplete-reclassification-pending");
      settleIncompleteProfileDraft(control, locator, intent);
      return readMachineRegistry(control, locator, false);
    }
    if (intent.kind === "draft-abort") {
      if (!recoverPublication) fail("profile-draft-abort-pending");
      settleUnpublishedDraftAbort(control, locator, document, witness, intent);
      return readMachineRegistry(control, locator, false);
    }
    assertProfileCredentialKeyMembership(locator, witness.erasures, intent.kind === "profile" ? intent.keyStage : stagedPublication);
    if (intent.kind === "duo" || intent.kind === "draft-duo") { fail("duo-publication-pending"); }
    assertDuoMembership(locator, document, intent.kind === "profile"
      ? intent.duo.filter(row => document.profiles.some(profile => profile.profileId === row.profileId)) : witness.duo);
    if (intent.kind === "credential-key") {
      const capture = intent.capture, profileId = capture.operation.profileId;
      const priorRow = intent.prior.erasures.find(row => row.profileId === profileId);
      if (intent.installationId !== locator.installationId || capture.key.binding.installationId !== locator.installationId || priorRow === undefined || priorRow.credentialKey !== undefined
        || intent.document.activeProfileId !== null || intent.document.sessionGeneration !== intent.prior.generation + 1
        || !Number.isSafeInteger(intent.document.sessionGeneration)) fail("profile-key-publication-invalid");
      if (createHash("sha256").update(canonicalJsonStringify(intent.priorDocument)).digest("hex") !== intent.prior.digest
        || canonicalJsonStringify({ ...intent.priorDocument, activeProfileId: null, sessionGeneration: intent.priorDocument.sessionGeneration + 1 }) !== canonicalJsonStringify(intent.document)) fail("profile-key-publication-registry-invalid");
      const operationPath = join(locator.stateRoot, "machine", "operations", `${capture.operation.operationId}.json`);
      if (canonicalJsonStringify(readProfileEvidence(operationPath, SignUpOperationSchema)) !== canonicalJsonStringify(capture.operation)
        || canonicalJsonStringify(priorRow.head) !== canonicalJsonStringify(capture.head)) fail("profile-key-publication-intent-changed");
      assertCredentialInitializationPublication(locator.stateRoot, erasurePath(locator, profileId), capture);
      const erasures = intent.prior.erasures.map(row => row.profileId === profileId ? { ...row, credentialKey: capture.key } : row);
      const published = profileRegistryWitness(locator.installationId, path, document, erasures, intent.prior.duo);
      if (canonicalJsonStringify(witness) !== canonicalJsonStringify(intent.prior)
        && canonicalJsonStringify(witness) !== canonicalJsonStringify(published)) fail("profile-key-publication-continuity-changed");
      if (canonicalJsonStringify(document) !== canonicalJsonStringify(intent.document)) {
        if (canonicalJsonStringify(profileRegistryWitness(locator.installationId, path, document, intent.prior.erasures, intent.prior.duo)) !== canonicalJsonStringify(intent.prior)) fail("profile-key-publication-registry-changed");
      }
      for (const row of intent.prior.erasures) {
        assertCredentialErasureHeadFiles(erasurePath(locator, row.profileId), row.head);
        if (row.credentialKey !== undefined) assertCredentialKeyWitness(join(locator.stateRoot, "machine", "credential-keys", `${row.profileId}.json`), row.credentialKey, { installationId: locator.installationId, profileId: row.profileId });
      }
      if (credentialPublication === undefined) return document;
      if (!recoverPublication || canonicalJsonStringify(credentialPublication) !== canonicalJsonStringify(capture)) fail("profile-key-publication-fresh-inventory-required");
      if (canonicalJsonStringify(document) !== canonicalJsonStringify(intent.document)) {
        if (canonicalJsonStringify(profileRegistryWitness(locator.installationId, path, document, intent.prior.erasures, intent.prior.duo)) !== canonicalJsonStringify(intent.prior)
          || canonicalJsonStringify({ ...document, activeProfileId: null, sessionGeneration: document.sessionGeneration + 1 }) !== canonicalJsonStringify(intent.document)) fail("profile-key-publication-registry-changed");
        atomicJson(path, intent.document);
      }
      atomicJson(witnessPath, profileRegistryWitness(locator.installationId, path, intent.document, erasures, intent.prior.duo));
      unlinkSync(intentPath); syncDir(control);
      return readMachineRegistry(control, locator, false);
    }
    if (intent.kind === "erasure") {
      if (intent.installationId !== locator.installationId) fail("profile-erasure-publication-uncertain");
      const publishedHead = witness.erasures.find(row => row.profileId === intent.profileId)?.head;
      const settled = publishedHead?.state === "established" && publishedHead.epoch === intent.nextEpoch && publishedHead.journal.digest === intent.nextDigest
        && canonicalJsonStringify({ ...witness, erasures: intent.prior.erasures }) === canonicalJsonStringify(intent.prior);
      if (!settled && canonicalJsonStringify(intent.prior) !== canonicalJsonStringify(witness)) fail("profile-erasure-publication-uncertain");
      if (canonicalJsonStringify(witness) !== canonicalJsonStringify(profileRegistryWitness(locator.installationId, path, document, witness.erasures, witness.duo))) fail("profile-registry-continuity-mismatch");
      assertErasureMembership(document, witness.erasures);
      for (const row of witness.erasures) if (row.profileId !== intent.profileId) assertCredentialErasureHeadFiles(erasurePath(locator, row.profileId), row.head);
      return document;
    }
    if (intent.keyStage !== undefined) {
      const capture = intent.keyStage, id = capture.operation.operationId;
      if (intent.installationId !== locator.installationId || canonicalJsonStringify(capture.registry) !== canonicalJsonStringify(document) || intent.operation?.kind !== "write"
        || canonicalJsonStringify(intent.operation.operation) !== canonicalJsonStringify(capture.operation)
        || canonicalJsonStringify(intent.document) !== canonicalJsonStringify(document)
        || canonicalJsonStringify(intent.erasures) !== canonicalJsonStringify(intent.prior.erasures)) fail("credential-key-stage-publication-invalid");
      assertCredentialKeyStagePublication(locator.stateRoot, capture);
      const operationPath = join(locator.stateRoot, "machine", "operations", `${id}.json`);
      const observed = readProfileEvidence(operationPath, SignUpOperationSchema), current = profileRegistryWitness(locator.installationId, path, document, intent.erasures, intent.duo);
      const others = (rows: typeof current.operations) => rows.filter(row => row.operationId !== id);
      const priorState = canonicalJsonStringify(observed) === canonicalJsonStringify(capture.priorOperation);
      if ((!priorState && canonicalJsonStringify(observed) !== canonicalJsonStringify(capture.operation))
        || canonicalJsonStringify(others(current.operations)) !== canonicalJsonStringify(others(intent.prior.operations))
        || canonicalJsonStringify(witness) !== canonicalJsonStringify(intent.prior) && canonicalJsonStringify(witness) !== canonicalJsonStringify(current)
        || priorState && canonicalJsonStringify(current) !== canonicalJsonStringify(intent.prior)) fail("credential-key-stage-operation-changed");
      assertErasureMembership(document, intent.prior.erasures);
      for (const row of intent.prior.erasures) assertCredentialErasureHeadFiles(erasurePath(locator, row.profileId), row.head);
      if (stagedPublication === undefined) return document;
      if (!recoverPublication || canonicalJsonStringify(stagedPublication) !== canonicalJsonStringify(capture)) fail("credential-key-stage-fresh-owner-required");
      if (priorState) atomicJson(operationPath, capture.operation);
      atomicJson(witnessPath, profileRegistryWitness(locator.installationId, path, document, intent.erasures, intent.duo));
      unlinkSync(intentPath); syncDir(control);
      return readMachineRegistry(control, locator, false);
    }
    if (!recoverPublication) fail("profile-registry-publication-busy");
    const retainedDuo = intent.duo.filter(row => intent.prior.duo.some(prior => prior.profileId === row.profileId));
    const addedDuo = intent.duo.filter(row => !intent.prior.duo.some(prior => prior.profileId === row.profileId));
    if (canonicalJsonStringify(retainedDuo) !== canonicalJsonStringify(intent.prior.duo) || addedDuo.length > 1
      || addedDuo.some(row => {
        const profile = intent.document.profiles.find(profile => profile.profileId === row.profileId);
        if (profile === undefined) return true;
        const operation = readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${profile.registration.operationId}.json`), SignUpOperationSchema);
        assertFinishedProfileOnboarding(operation);
        return operation.profileId !== row.profileId || canonicalJsonStringify(operation.onboarding?.duo) !== canonicalJsonStringify(row);
      })) fail("duo-registration-membership-changed");
    const retainedHeads = intent.erasures.filter(row => intent.prior.erasures.some(prior => prior.profileId === row.profileId));
    if (canonicalJsonStringify(retainedHeads) !== canonicalJsonStringify(intent.prior.erasures)) fail("profile-erasure-publication-heads-changed");
    const addedHeads = intent.erasures.filter(row => !intent.prior.erasures.some(prior => prior.profileId === row.profileId));
    if (addedHeads.length > 1 || addedHeads.some(row => row.credentialKey === undefined || row.head.state !== "never-erased" || !document.profiles.some(profile => profile.profileId === row.profileId && profile.registration.operationId === row.originOperationId))) fail("profile-erasure-publication-origin-invalid");
    if (intent.installationId !== locator.installationId || canonicalJsonStringify(intent.document) !== canonicalJsonStringify(document)) fail("profile-registry-publication-uncertain");
    const published = profileRegistryWitness(locator.installationId, path, document, intent.erasures, intent.duo);
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
    atomicJson(witnessPath, published);
    unlinkSync(intentPath); syncDir(control);
  } else if (canonicalJsonStringify(witness) !== canonicalJsonStringify(profileRegistryWitness(locator.installationId, path, document, witness.erasures, witness.duo))) {
    fail("profile-registry-continuity-mismatch");
  }
  const current = readProfileEvidence(witnessPath, ProfileContinuitySchema);
  assertErasureMembership(document, current.erasures);
  assertDuoMembership(locator, document, current.duo);
  assertProfileCredentialKeyMembership(locator, current.erasures, stagedPublication);
  for (const row of current.erasures) {
    assertCredentialErasureHeadFiles(erasurePath(locator, row.profileId), row.head);
    if (row.credentialKey !== undefined) assertCredentialKeyWitness(join(locator.stateRoot, "machine", "credential-keys", `${row.profileId}.json`), row.credentialKey, { installationId: locator.installationId, profileId: row.profileId });
  }
  return document;
}
function assertDuoMembership(locator: RuntimeLocator, document: ProfileRegistryDocument, rows: readonly DuoContinuityRow[]): void {
  if (rows.length !== document.profiles.length || new Set(rows.map(row => row.profileId)).size !== rows.length
    || rows.some(row => !document.profiles.some(profile => profile.profileId === row.profileId))) fail("duo-profile-membership-mismatch");
  const drafts = draftDuoRows(locator, document);
  const allRows = [...rows, ...drafts];
  if (new Set(allRows.map(row => row.profileId)).size !== allRows.length) fail("duo-draft-membership-mismatch");
  const directory = join(locator.stateRoot, "machine", "duo-credentials");
  assertNoSymlinkComponents(directory);
  if (lstatMaybe(directory)) {
    privateDirectory(directory);
    const expected = allRows.filter(row => row.state !== "never-initialized").map(row => `${row.profileId}.json`).sort();
    if (canonicalJsonStringify(readdirSync(directory).sort()) !== canonicalJsonStringify(expected)) fail("duo-document-membership-mismatch");
  }
  for (const row of allRows) assertDuoDocumentWitness(locator.stateRoot, row);
}

function draftDuoRows(locator: RuntimeLocator, document: ProfileRegistryDocument): DuoContinuityRow[] {
  return profileOperationInventory(locator.stateRoot).flatMap(entry => {
    const operation = readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${entry.operationId}.json`), ProfileOperationSchema);
    if (operation.kind !== "sign-up" || operation.onboarding === undefined || document.profiles.some(row => row.profileId === operation.profileId)) return [];
    if (operation.onboarding.duo.profileId !== operation.profileId) fail("duo-draft-membership-mismatch");
    return [operation.onboarding.duo];
  });
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

function settleProfileOnboardingFinish(control: string, locator: RuntimeLocator,
  intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "onboarding-finish" }>): void {
  const { operation, prior, priorDocument, document, priorVerifiers, verifiers } = intent, profileId = operation.profileId;
  const added = document.profiles.filter(row => !priorDocument.profiles.some(prior => prior.profileId === row.profileId));
  const verifier = verifiers.profiles.filter(row => !priorVerifiers.profiles.some(prior => prior.profileId === row.profileId));
  if (intent.installationId !== locator.installationId || operation.phase !== "publishing" || added.length !== 1 || verifier.length !== 1
    || added[0]?.profileId !== profileId || verifier[0]?.profileId !== profileId || verifier[0].emailKey !== operation.emailKey
    || canonicalJsonStringify(document) !== canonicalJsonStringify({ ...priorDocument, profiles: [...priorDocument.profiles, added[0]] })
    || canonicalJsonStringify(verifiers) !== canonicalJsonStringify({ ...priorVerifiers, profiles: [...priorVerifiers.profiles, verifier[0]] })
    || priorVerifiers.profiles.some(row => row.emailKey === operation.emailKey)
    || added[0].registration.operationId !== operation.operationId || added[0].registration.commandId !== operation.commandId
    || added[0].registration.writeId !== operation.writeId || canonicalJsonStringify(added[0].registration.onboardingCompletion) !== canonicalJsonStringify(profileOnboardingCompletion(operation))
    || createHash("sha256").update(canonicalJsonStringify(priorDocument)).digest("hex") !== prior.digest
    || intent.head.state !== "never-erased" || intent.key.binding.profileId !== profileId || intent.key.binding.installationId !== locator.installationId) fail("profile-onboarding-finish-invalid");
  const pepper = readPrivateFile(join(locator.stateRoot, "machine", "profile-pepper"), { label: "lock", maxBytes: 32 });
  if (pepper === undefined || pepper.bytes.length !== 32 || pepper.identity.device !== intent.pepper.device || pepper.identity.inode !== intent.pepper.inode
    || createHash("sha256").update(pepper.bytes).digest("hex") !== intent.pepper.digest) fail("profile-onboarding-finish-pepper-changed");
  const root = join(locator.stateRoot, "profiles", profileId), registryPath = join(locator.stateRoot, "machine", "profiles.json");
  assertCanonicalProfileBinding(join(root, "state.db"), intent.key.binding);
  if (canonicalJsonStringify(profileAuthorityFileWitnesses(root)) !== canonicalJsonStringify(intent.databases)) fail("profile-onboarding-finish-source-changed");
  assertCredentialKeyWitness(join(locator.stateRoot, "machine", "credential-keys", `${profileId}.json`), intent.key, intent.key.binding);
  assertCredentialErasureHeadFiles(erasurePath(locator, profileId), intent.head);
  const protectedFile = readPrivateFile(join(root, "credentials", "protected.json"), { label: "protected.json", maxBytes: Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 });
  if (protectedFile === undefined || protectedFile.identity.device !== intent.protectedFile.device || protectedFile.identity.inode !== intent.protectedFile.inode
    || createHash("sha256").update(protectedFile.bytes).digest("hex") !== intent.protectedFile.digest) fail("profile-onboarding-finish-source-changed");
  if (canonicalJsonStringify(readStrict(join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`), SignUpOperationSchema)) !== canonicalJsonStringify(operation)) fail("profile-onboarding-finish-operation-changed");
  const duo = DuoContinuityRowSchema.parse(operation.onboarding?.duo); assertDuoDocumentWitness(locator.stateRoot, duo);
  const verifierPath = join(locator.stateRoot, "machine", "profile-verifiers.json"), currentVerifiers = readStrict(verifierPath, ProfileVerifierDocumentSchema);
  const currentDocument = readStrict(registryPath, ProfileRegistryDocumentSchema), before = canonicalJsonStringify(currentDocument) === canonicalJsonStringify(priorDocument);
  const after = canonicalJsonStringify(currentDocument) === canonicalJsonStringify(document), verifierBefore = canonicalJsonStringify(currentVerifiers) === canonicalJsonStringify(priorVerifiers);
  const verifierAfter = canonicalJsonStringify(currentVerifiers) === canonicalJsonStringify(verifiers);
  if (!before && !after || !verifierBefore && !verifierAfter || after && !verifierAfter) fail("profile-onboarding-finish-order-invalid");
  const erasures = [...prior.erasures, { profileId, originOperationId: operation.operationId, head: intent.head, credentialKey: intent.key }], duos = [...prior.duo, duo];
  const continuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
  if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(prior)
    && (!after || canonicalJsonStringify(continuity) !== canonicalJsonStringify(profileRegistryWitness(locator.installationId, registryPath, document, erasures, duos)))) fail("profile-onboarding-finish-control-changed");
  if (verifierBefore) atomicJson(verifierPath, verifiers);
  if (before) atomicJson(registryPath, document);
  atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, registryPath, document, erasures, duos));
  unlinkSync(join(control, "profile-publication.json")); syncDir(control);
}

function assertDraftErasureSource(locator: RuntimeLocator, document: ProfileRegistryDocument,
  intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "draft-erasure" }>): void {
  const operation = intent.operation, draft = operation.onboarding;
  if (intent.installationId !== locator.installationId || operation.profileId !== intent.profileId || operation.phase !== "applying"
    || operation.credentialInitialization?.mode !== "initial" || draft?.abort === undefined || draft.finish !== undefined || draft.duo.state !== "never-initialized"
    || draft.attempts.some(attempt => attempt.scope !== undefined || attempt.ceremony !== undefined || attempt.portal !== undefined
      || attempt.state === "unknown" || attempt.providerClosedAt === undefined) || document.profiles.some(row => row.profileId === intent.profileId)
    || canonicalJsonStringify(intent.request) !== canonicalJsonStringify(erasureRequestIdentity(draft.abort))) fail("profile-draft-erasure-intent-invalid");
  const path = join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`);
  if (canonicalJsonStringify(readProfileEvidence(path, SignUpOperationSchema)) !== canonicalJsonStringify(operation)) fail("profile-draft-erasure-operation-changed");
  const source = readPrivateFile(unpublishedDraftAbortSourcePath(join(locator.stateRoot, "profiles", intent.profileId), operation),
    { label: "protected.json", maxBytes: Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 });
  if (source === undefined || source.identity.device !== intent.source.device || source.identity.inode !== intent.source.inode
    || createHash("sha256").update(source.bytes).digest("hex") !== intent.source.digest) fail("profile-draft-abort-source-changed");
}

function settleIncompleteProfileDraft(control: string, locator: RuntimeLocator,
  intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "incomplete-profile-draft" }>): void {
  const { capture, prior, priorDocument, document, priorVerifiers, verifiers } = intent, operation = capture.operation;
  if (operation.ownerClaim !== undefined) {
    const backup = verifyExistingDataBackupFiles(operation.ownerClaim, readInstallation(control, dirname(dirname(control))).workspace, locator.installationId);
    if (backup.profileId !== operation.profileId) fail("existing-data-backup-owner-refused");
  }
  const target = priorDocument.profiles.find(row => row.profileId === operation.profileId), binding = capture.key.binding;
  if (intent.installationId !== locator.installationId || binding.installationId !== locator.installationId || binding.profileId !== operation.profileId
    || target === undefined || target.registration.onboardingCompletion !== undefined || target.duoState !== "not-set-up" || target.migratedFromLegacy !== undefined
    || target.registration.operationId !== operation.operationId || target.registration.commandId !== operation.commandId || target.registration.writeId !== operation.writeId
    || operation.phase !== "applying" || operation.onboarding?.duo.state !== "never-initialized" || operation.onboarding.attempts.length !== 0
    || operation.onboarding.finish !== undefined || operation.onboarding.abort !== undefined
    || prior.duo.find(row => row.profileId === operation.profileId)?.state !== "never-initialized"
    || canonicalJsonStringify(document) !== canonicalJsonStringify({ ...priorDocument, profiles: priorDocument.profiles.filter(row => row.profileId !== operation.profileId),
      activeProfileId: priorDocument.activeProfileId === operation.profileId ? null : priorDocument.activeProfileId, sessionGeneration: priorDocument.sessionGeneration + 1 })
    || canonicalJsonStringify(verifiers) !== canonicalJsonStringify({ ...priorVerifiers, profiles: priorVerifiers.profiles.filter(row => row.profileId !== operation.profileId) })
    || priorVerifiers.profiles.filter(row => row.profileId === operation.profileId).length !== 1) fail("profile-incomplete-reclassification-invalid");
  if (createHash("sha256").update(canonicalJsonStringify(priorDocument)).digest("hex") !== prior.digest
    || prior.generation !== priorDocument.sessionGeneration || prior.erasures.find(row => row.profileId === operation.profileId)?.originOperationId !== operation.operationId
    || canonicalJsonStringify(prior.erasures.find(row => row.profileId === operation.profileId)?.credentialKey) !== canonicalJsonStringify(capture.key)) fail("profile-incomplete-prior-changed");
  const root = join(locator.stateRoot, "profiles", operation.profileId), registryPath = join(locator.stateRoot, "machine", "profiles.json");
  if (canonicalJsonStringify(unpublishedDraftAbortMembership(root)) !== canonicalJsonStringify(capture.membership)) fail("profile-incomplete-copy-membership-changed");
  assertCanonicalProfileBinding(join(root, "state.db"), binding);
  if (canonicalJsonStringify(profileAuthorityFileWitnesses(root)) !== canonicalJsonStringify(capture.databases)) fail("profile-incomplete-source-changed");
  assertCredentialKeyWitness(join(locator.stateRoot, "machine", "credential-keys", `${operation.profileId}.json`), capture.key, binding);
  const protectedFile = readPrivateFile(join(root, "credentials", "protected.json"), { label: "protected.json", maxBytes: Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 });
  if (protectedFile === undefined || protectedFile.identity.device !== capture.protectedFile.device || protectedFile.identity.inode !== capture.protectedFile.inode
    || createHash("sha256").update(protectedFile.bytes).digest("hex") !== capture.protectedFile.digest) fail("profile-incomplete-source-changed");
  const currentDocument = readProfileEvidence(registryPath, ProfileRegistryDocumentSchema), verifierPath = join(locator.stateRoot, "machine", "profile-verifiers.json");
  const currentVerifiers = readProfileEvidence(verifierPath, ProfileVerifierDocumentSchema), operationPath = join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`);
  const operationPresent = lstatMaybe(operationPath) !== undefined;
  if (operationPresent && canonicalJsonStringify(readProfileEvidence(operationPath, SignUpOperationSchema)) !== canonicalJsonStringify(operation)) fail("profile-incomplete-operation-changed");
  const isPrior = canonicalJsonStringify(currentDocument) === canonicalJsonStringify(priorDocument), isNext = canonicalJsonStringify(currentDocument) === canonicalJsonStringify(document);
  const verifierPrior = canonicalJsonStringify(currentVerifiers) === canonicalJsonStringify(priorVerifiers), verifierNext = canonicalJsonStringify(currentVerifiers) === canonicalJsonStringify(verifiers);
  if (!isPrior && !isNext || !verifierPrior && !verifierNext || !operationPresent && (!isPrior || !verifierPrior) || isNext && !verifierNext) fail("profile-incomplete-reclassification-order-invalid");
  const nextErasures = prior.erasures.filter(row => row.profileId !== operation.profileId), nextDuo = prior.duo.filter(row => row.profileId !== operation.profileId);
  const current = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
  const next = profileRegistryWitness(locator.installationId, registryPath, currentDocument, nextErasures, nextDuo);
  if (canonicalJsonStringify(current) !== canonicalJsonStringify(prior) && (!isNext || !operationPresent || canonicalJsonStringify(current) !== canonicalJsonStringify(next))) fail("profile-incomplete-control-changed");
  if (!operationPresent) atomicJson(operationPath, operation);
  if (verifierPrior) atomicJson(verifierPath, verifiers);
  if (isPrior) atomicJson(registryPath, document);
  atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, registryPath, document, nextErasures, nextDuo));
  if (operation.ownerClaim !== undefined) {
    const receiptPath = join(dirname(operation.ownerClaim.backupPath), "claim.json");
    const receipt = { schemaVersion: 1, installationId: locator.installationId, profileId: operation.profileId,
      operationId: operation.operationId, registryBeforeDigest: prior.digest, backup: operation.ownerClaim };
    const existing = readPrivateFile(receiptPath, { label: "lock", maxBytes: 1_048_576 });
    if (existing === undefined) atomicJson(receiptPath, receipt);
    else if (canonicalJsonStringify(JSON.parse(existing.bytes.toString("utf8"))) !== canonicalJsonStringify(receipt)) fail("existing-data-claim-receipt-changed");
  }
  unlinkSync(join(control, "profile-publication.json")); syncDir(control);
}

function settleUnpublishedDraftAbort(control: string, locator: RuntimeLocator, document: ProfileRegistryDocument,
  witness: z.infer<typeof ProfileContinuitySchema>, intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "draft-abort" }>): void {
  const { capture, prior } = intent, operation = capture.operation, draft = operation.onboarding;
  if (intent.installationId !== locator.installationId || capture.key.binding.installationId !== locator.installationId
    || capture.key.binding.profileId !== operation.profileId || operation.phase !== "applying" || operation.credentialInitialization?.mode !== "initial"
    || draft?.abort === undefined || draft.finish !== undefined || draft.duo.state !== "never-initialized"
    || draft.attempts.some(attempt => attempt.scope !== undefined || attempt.ceremony !== undefined || attempt.portal !== undefined
      || attempt.state === "unknown" || attempt.providerClosedAt === undefined) || capture.head.state !== "established"
    || document.profiles.some(row => row.profileId === operation.profileId)) fail("profile-draft-abort-invalid");
  const root = join(locator.stateRoot, "profiles", operation.profileId), operationPath = join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`);
  const keyPath = join(locator.stateRoot, "machine", "credential-keys", `${operation.profileId}.json`), protectedPath = join(root, "credentials", "protected.json");
  const sourcePath = unpublishedDraftAbortSourcePath(root, operation), sourcePresent = lstatMaybe(sourcePath) !== undefined;
  const membership = unpublishedDraftAbortMembership(root);
  const afterSource = (entries: typeof membership) => entries.filter(entry => entry.path !== relative(root, sourcePath))
    .map(entry => entry.path === "credentials" ? { ...entry, size: 0, modified: 0, changed: 0 } : entry);
  if (canonicalJsonStringify(membership) !== canonicalJsonStringify(capture.membership)
    && (sourcePresent || canonicalJsonStringify(afterSource(membership)) !== canonicalJsonStringify(afterSource(capture.membership)))) fail("profile-draft-abort-membership-changed");
  if (sourcePresent) {
    const source = readPrivateFile(sourcePath, { label: "protected.json", maxBytes: Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 });
    if (source === undefined || source.identity.device !== capture.abortSource.device || source.identity.inode !== capture.abortSource.inode
      || createHash("sha256").update(source.bytes).digest("hex") !== capture.abortSource.digest) fail("profile-draft-abort-source-changed");
  }
  assertCredentialErasureHeadFiles(erasurePath(locator, operation.profileId), capture.head);
  const protectedFile = readPrivateFile(protectedPath, { label: "protected.json", maxBytes: Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 });
  if (protectedFile === undefined || canonicalJsonStringify({ device: protectedFile.identity.device, inode: protectedFile.identity.inode,
    digest: createHash("sha256").update(protectedFile.bytes).digest("hex") }) !== canonicalJsonStringify(capture.protectedFile)) fail("profile-draft-abort-erasure-changed");
  const path = join(locator.stateRoot, "machine", "profiles.json"), current = profileRegistryWitness(locator.installationId, path, document, prior.erasures, prior.duo);
  const others = (value: typeof current) => ({ ...value, operations: value.operations.filter(row => row.operationId !== operation.operationId) });
  if (canonicalJsonStringify(others(current)) !== canonicalJsonStringify(others(prior))
    || canonicalJsonStringify(witness) !== canonicalJsonStringify(prior) && canonicalJsonStringify(witness) !== canonicalJsonStringify(current)) fail("profile-draft-abort-control-changed");
  const operationPresent = lstatMaybe(operationPath) !== undefined, keyPresent = lstatMaybe(keyPath) !== undefined;
  if (operationPresent) {
    if (canonicalJsonStringify(readProfileEvidence(operationPath, SignUpOperationSchema)) !== canonicalJsonStringify(operation)
      || canonicalJsonStringify(current) !== canonicalJsonStringify(prior)) fail("profile-draft-abort-operation-changed");
  } else if (keyPresent) fail("profile-draft-abort-order-invalid");
  if (sourcePresent) {
    if (!keyPresent || !operationPresent) fail("profile-draft-abort-order-invalid");
    unlinkSync(sourcePath); syncDir(dirname(sourcePath));
  }
  if (keyPresent) { assertCredentialKeyWitness(keyPath, capture.key, capture.key.binding); unlinkSync(keyPath); syncDir(dirname(keyPath)); }
  if (operationPresent) { unlinkSync(operationPath); syncDir(dirname(operationPath)); }
  atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, path, document, prior.erasures, prior.duo));
  unlinkSync(join(control, "profile-publication.json")); syncDir(control);
}

function settleDraftDuoPublication(control: string, locator: RuntimeLocator, document: ProfileRegistryDocument,
  witness: z.infer<typeof ProfileContinuitySchema>, intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "draft-duo" }>): void {
  const { capture, priorOperation, operation, prior } = intent;
  if (intent.installationId !== locator.installationId || priorOperation.onboarding === undefined || operation.onboarding === undefined
    || priorOperation.phase !== "applying" || document.profiles.some(row => row.profileId === capture.profileId)
    || priorOperation.profileId !== capture.profileId || capture.profileId !== capture.prior.profileId || capture.profileId !== capture.next.profileId
    || capture.next.state === "never-initialized" || capture.next.revision !== capture.prior.revision + 1
    || canonicalJsonStringify(priorOperation.onboarding.duo) !== canonicalJsonStringify(capture.prior)
    || canonicalJsonStringify(operation) !== canonicalJsonStringify({ ...priorOperation, onboarding: { ...priorOperation.onboarding, duo: capture.next } })) fail("duo-draft-publication-invalid");
  const operationPath = join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`);
  const observed = readProfileEvidence(operationPath, SignUpOperationSchema);
  if (canonicalJsonStringify(observed) !== canonicalJsonStringify(priorOperation)
    && canonicalJsonStringify(observed) !== canonicalJsonStringify(operation)) fail("duo-draft-authority-changed");
  const path = join(locator.stateRoot, "machine", "profiles.json"), current = profileRegistryWitness(locator.installationId, path, document, prior.erasures, prior.duo);
  const others = (value: typeof current) => ({ ...value, operations: value.operations.filter(row => row.operationId !== operation.operationId) });
  if (canonicalJsonStringify(others(current)) !== canonicalJsonStringify(others(prior))
    || canonicalJsonStringify(witness) !== canonicalJsonStringify(prior) && canonicalJsonStringify(witness) !== canonicalJsonStringify(current)) fail("duo-draft-publication-control-changed");
  if (canonicalJsonStringify(observed) === canonicalJsonStringify(priorOperation)
    && canonicalJsonStringify(current) !== canonicalJsonStringify(prior)) fail("duo-draft-publication-source-changed");
  const directory = join(locator.stateRoot, "machine", "duo-credentials"), canonical = join(directory, `${capture.profileId}.json`), stage = duoStagePath(locator.stateRoot, capture);
  assertNoSymlinkComponents(directory); privateDirectory(directory);
  const allRows = [...prior.duo, ...draftDuoRows(locator, document)];
  const expected = allRows.filter(row => row.profileId !== capture.profileId && row.state !== "never-initialized").map(row => `${row.profileId}.json`);
  for (const row of allRows) if (row.profileId !== capture.profileId) assertDuoDocumentWitness(locator.stateRoot, row);
  if (lstatMaybe(stage)) {
    if (canonicalJsonStringify(observed) !== canonicalJsonStringify(priorOperation) || canonicalJsonStringify(witness) !== canonicalJsonStringify(prior)) fail("duo-draft-publication-stage-after-control");
    assertDuoPublishedFile(stage, capture); assertDuoDocumentWitness(locator.stateRoot, capture.prior);
    expected.push(basename(stage));
    if (capture.prior.state !== "never-initialized") expected.push(basename(canonical));
  } else { assertDuoPublishedFile(canonical, capture); expected.push(basename(canonical)); }
  if (canonicalJsonStringify(readdirSync(directory).sort()) !== canonicalJsonStringify(expected.sort())) fail("duo-draft-publication-membership-changed");
  if (lstatMaybe(stage)) { renameSync(stage, canonical); syncDir(directory); }
  assertDuoPublishedFile(canonical, capture);
  if (canonicalJsonStringify(observed) === canonicalJsonStringify(priorOperation)) atomicJson(operationPath, operation);
  atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, path, document, prior.erasures, prior.duo));
  unlinkSync(join(control, "profile-publication.json")); syncDir(control);
}

function settleDuoPublication(control: string, locator: RuntimeLocator, document: ProfileRegistryDocument,
  witness: z.infer<typeof ProfileContinuitySchema>, intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "duo" }>): void {
  const { capture, prior } = intent;
  if (intent.installationId !== locator.installationId || capture.profileId !== capture.prior.profileId
    || capture.profileId !== capture.next.profileId || capture.next.state === "never-initialized" || capture.next.revision !== capture.prior.revision + 1
    || canonicalJsonStringify(prior.duo.find(row => row.profileId === capture.profileId)) !== canonicalJsonStringify(capture.prior)
    || canonicalJsonStringify(profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document, prior.erasures, prior.duo)) !== canonicalJsonStringify(prior)) fail("duo-publication-prior-changed");
  const next = { ...prior, duo: prior.duo.map(row => row.profileId === capture.profileId ? capture.next : row) };
  if (canonicalJsonStringify(witness) !== canonicalJsonStringify(prior) && canonicalJsonStringify(witness) !== canonicalJsonStringify(next)) fail("duo-publication-control-changed");
  const directory = join(locator.stateRoot, "machine", "duo-credentials"), canonical = join(directory, `${capture.profileId}.json`), stage = duoStagePath(locator.stateRoot, capture);
  assertNoSymlinkComponents(directory); privateDirectory(directory);
  const expected = prior.duo.filter(row => row.state !== "never-initialized" && row.profileId !== capture.profileId).map(row => `${row.profileId}.json`);
  if (lstatMaybe(stage)) {
    if (canonicalJsonStringify(witness) !== canonicalJsonStringify(prior)) fail("duo-publication-stage-after-control");
    assertDuoPublishedFile(stage, capture); assertDuoDocumentWitness(locator.stateRoot, capture.prior);
    expected.push(basename(stage));
    if (capture.prior.state !== "never-initialized") expected.push(basename(canonical));
  } else { assertDuoPublishedFile(canonical, capture); expected.push(basename(canonical)); }
  if (canonicalJsonStringify(readdirSync(directory).sort()) !== canonicalJsonStringify(expected.sort())) fail("duo-publication-membership-changed");
  for (const row of prior.duo) if (row.profileId !== capture.profileId) assertDuoDocumentWitness(locator.stateRoot, row);
  if (lstatMaybe(stage)) { renameSync(stage, canonical); syncDir(directory); }
  assertDuoPublishedFile(canonical, capture);
  atomicJson(join(control, "profile-registry.json"), next);
  assertDuoPublishedFile(canonical, capture);
  unlinkSync(join(control, "profile-publication.json")); syncDir(control);
}

function erasurePath(locator: RuntimeLocator, profileId: string): string { return join(locator.stateRoot, "machine", "erasures", profileId + ".json"); }
function assertErasureMembership(document: ProfileRegistryDocument, heads: readonly z.infer<typeof ProfileErasureHeadSchema>[]): void {
  if (heads.length !== document.profiles.length || new Set(heads.map(row => row.profileId)).size !== heads.length
    || heads.some(head => !document.profiles.some(row => row.profileId === head.profileId && row.registration.operationId === head.originOperationId))) fail("profile-erasure-membership-mismatch");
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
  assertLiveObservationMutex(control);
  const before = profileObservation(control, locator);
  const document = readMachineRegistry(control, locator, false);
  const row = document.profiles.find(entry => entry.profileId === id);
  if (row?.lifecycle !== "ready" || row.credentialState !== "saved") fail("profile-stopped-upgrade-ready-required");
  const continuity = readProfileEvidence(join(control, "profile-registry.json"), ProfileContinuitySchema);
  const head = continuity.erasures.find(entry => entry.profileId === id);
  if (head?.credentialKey === undefined) fail("profile-stopped-upgrade-key-required");
  const journal = erasurePath(locator, id), key = join(locator.stateRoot, "machine", "credential-keys", `${id}.json`);
  const files = [journal, `${journal}.authority`, key].map(path => {
    const file = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
    if (file === undefined) {
      if (path === key || head.head.state !== "never-erased") fail("profile-stopped-upgrade-evidence-required");
      return { path, absent: true };
    }
    return { path, identity: file.identity, digest: createHash("sha256").update(file.bytes).digest("hex") };
  });
  if (profileObservation(control, locator) !== before || lstatMaybe(join(control, "profile-publication.json"))) fail("profile-stopped-upgrade-observation-changed");
  assertHeld();
  assertLiveObservationMutex(control);
  const directories = [control, join(locator.stateRoot, "machine"), join(locator.stateRoot, "machine", "credential-keys"),
    join(locator.stateRoot, "machine", "erasures"), join(locator.stateRoot, "machine", "operations")].map(path => {
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined && path === join(locator.stateRoot, "machine", "erasures")
      && head.head.state === "never-erased") return { path, absent: true };
    privateDirectory(path);
    const info = lstatSync(path);
    return { path, device: info.dev, inode: info.ino, mode: info.mode, owner: info.uid };
  });
  return canonicalJsonStringify({ document, observation: before, files, directories });
}

function initializeMachineRegistry(control: string, locator: RuntimeLocator): void {
  const directory = join(locator.stateRoot, "machine");
  mkdirSync(directory, { mode: 0o700 }); syncDir(locator.stateRoot);
  const document = ProfileRegistryDocumentSchema.parse({ schemaVersion: 2, profiles: [], activeProfileId: null, sessionGeneration: 0 });
  atomicJson(join(directory, "profile-registry-version.json"), { schemaVersion: 3 });
  atomicJson(join(directory, "profiles.json"), document);
  atomicJson(join(directory, "profile-verifiers.json"), { schemaVersion: 1, profiles: [] });
  writeFileSync(join(directory, "profile-pepper"), randomBytes(32), { mode: 0o600, flag: "wx" });
  const pepper = openSync(join(directory, "profile-pepper"), "r"); try { fsyncSync(pepper); } finally { closeSync(pepper); }
  syncDir(directory);
  atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(directory, "profiles.json"), document, [], []));
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
    syncDir(dirname(processLockRoot));
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
      || (process.getuid && database.uid !== process.getuid()) || (Number(database.mode) & 0o022) !== 0) {
      fail("fresh authority database missing or unsafe");
    }
    const evidence = verifier!(Object.freeze({ ...pair }));
    if (evidence.kind !== "verified-existing" || evidence.pair.stateRoot !== pair.stateRoot
      || evidence.pair.artifactRoot !== pair.artifactRoot || !Number.isSafeInteger(evidence.authorityGeneration)
      || evidence.authorityGeneration < 0 || !evidence.databaseIdentity) fail("invalid fresh authority evidence");
  }
  const locator = { schemaVersion: 1 as const, installationId, generation: 0, ...pair };
  atomicJson(join(control, "locator.json"), locator);
  unlinkSync(join(control, "journal.json")); syncDir(control);
  return locator;
}
type RecoveryRequest = Readonly<{ installationId: string; fromGeneration: number; operationId: string; restoreAdmission: RestoreAdmissionHandle }>;
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
  restore: RestoreAdmissionHandle): Readonly<{ installationId: string; fromGeneration: number; operationId: string }> {
  const workspace = realpathSync(workspacePath);
  if (resolve(workspacePath) !== workspace) fail("recovery workspace must be canonical");
  const control = join(workspace, CONTROL);
  assertNoSymlinkComponents(control);
  privateDirectory(control);
  assertRestoreHeld(workspace, restore);
  if (activeLeases(control).length !== 0) fail("installation lease busy during recovery inspection");
  const installation = readInstallation(control, workspace);
  const pending = readStrict(join(control, "journal.json"), JournalSchema);
  if (pending.phase === "adopting" || pending.phase === "restoring" || pending.operationId !== operationId
    || pending.installationId !== installation.installationId) fail("recovery operation binding mismatch");
  const binding = Object.freeze({ installationId: pending.installationId,
    fromGeneration: pending.fromGeneration, operationId: pending.operationId });
  readLocator(control, workspace, binding);
  return binding;
}
export function acquireInstallation(workspacePath: string, mode: "shared", options?: { machine?: true }): InstallationLease;
export function acquireInstallation(workspacePath: string, mode: "exclusive", options?: { defaultPair?: RuntimePair; verifyExisting?: AuthorityVerifier; initializeFresh?: FreshInitializer; machine?: true; recoverRelocation?: RecoveryRequest; recoverAuthorityRestore?: { operationId: string; restoreAdmission: RestoreAdmissionHandle } }): ExclusiveInstallationLease;
export function acquireInstallation(workspacePath: string, mode: "shared" | "exclusive", options?: { defaultPair?: RuntimePair; verifyExisting?: AuthorityVerifier; initializeFresh?: FreshInitializer; machine?: true; recoverRelocation?: RecoveryRequest; recoverAuthorityRestore?: { operationId: string; restoreAdmission: RestoreAdmissionHandle } }): InstallationLease | ExclusiveInstallationLease {
  const workspace = realpathSync(workspacePath);
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
    if (lstatMaybe(parent) === undefined) { mkdirSync(parent, { mode: 0o700 }); syncDir(workspace); }
    privateDirectory(parent);
    mkdirSync(control, { mode: 0o700 }); syncDir(parent);
    mkdirSync(join(control, "leases"), { mode: 0o700 }); syncDir(control);
  }
  privateDirectory(control);
  let leasePath = "";
  let admissionId = "";
  const resolvedLocator = mutex(control, () => {
    const peers = activeLeases(control);
    if (peers.some((peer) => mode === "exclusive" || peer.mode === "exclusive")) fail("installation lease busy");
    if (options?.recoverRelocation) assertRestoreHeld(workspace, options.recoverRelocation.restoreAdmission);
    const resolved = existsSync(join(control, "installation.json")) ? readLocator(control, workspace, mode === "exclusive" ? options?.recoverRelocation : undefined, mode === "exclusive" ? options?.recoverAuthorityRestore : undefined) : (mode === "exclusive" && options?.defaultPair ? adopt(control, workspace, options.defaultPair, options.verifyExisting, options.initializeFresh, options.machine) : fail("installation locator missing"));
    if (options?.machine === true) readMachineRegistry(control, resolved);
    admissionId = randomUUID();
    leasePath = join(control, "leases", `${admissionId}.json`);
    atomicJson(leasePath, { schemaVersion: 1, admissionId, mode, pid: process.pid, processIdentity: identity() });
    return resolved;
  });
  const locator = Object.freeze({ ...resolvedLocator });
  const publicLocator = Object.freeze({ ...locator });
  let released = false;
  function assertHeld(): void {
    if (released) fail("installation lease released");
    const record = readStrict(leasePath, LeaseSchema);
    if (record.admissionId !== admissionId || record.mode !== mode || record.pid !== process.pid || !isLive(record)) {
      fail("installation lease identity changed");
    }
  }
  function publishOperation(input: ProfileOperation | string, creating: boolean, keyStageWitness?: CommittedCredentialKeyStage): void {
      mutex(control, () => {
        assertHeld();
        const current = readLocator(control, workspace);
        if (!equalLocator(current, locator)) fail("profile-machine-authority-changed");
        const keyStage = keyStageWitness === undefined ? undefined : verifyCommittedCredentialKeyStage(keyStageWitness, locator.stateRoot);
        if (keyStage !== undefined && (typeof input === "string" || canonicalJsonStringify(input) !== canonicalJsonStringify(keyStage.operation))) fail("credential-key-stage-operation-mismatch");
        const priorPending = lstatMaybe(join(control, "profile-publication.json")) ? readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema) : undefined;
        const resumedKeyStage = keyStage !== undefined && priorPending?.kind === "profile" && priorPending.keyStage !== undefined;
        const document = readMachineRegistry(control, locator, true, undefined, keyStage);
        if (resumedKeyStage) return;
        if (keyStage !== undefined && canonicalJsonStringify(keyStage.registry) !== canonicalJsonStringify(document)) fail("credential-key-stage-prior-registry-changed");
        if (lstatMaybe(join(control, "profile-publication.json"))) {
          const intent = readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema);
          if (intent.kind === "erasure" && typeof input !== "string" && input.kind === "logout" && input.profileId === intent.profileId) {
            const current = readStrict(join(locator.stateRoot, "machine", "operations", input.operationId + ".json"), LogoutOperationSchema);
            if (canonicalJsonStringify(current) === canonicalJsonStringify(input)) return;
          }
          fail("profile-erasure-publication-pending");
        }
        if (typeof input !== "string") {
          const path = join(locator.stateRoot, "machine", "operations", `${input.operationId}.json`);
          if (!lstatMaybe(path)) {
            if (input.kind === "sign-up" && !creating && !document.profiles.some(row => row.profileId === input.profileId)) fail("profile-signup-intent-unissued");
            if (input.kind === "logout" && !document.profiles.some(row => row.profileId === input.profileId)) fail("profile-logout-unregistered");
          } else {
            const before = readStrict(path, ProfileOperationSchema);
            if (keyStage !== undefined && canonicalJsonStringify(before) !== canonicalJsonStringify(keyStage.priorOperation)) fail("credential-key-stage-prior-operation-changed");
            if (before.kind !== input.kind || before.profileId !== input.profileId) fail("profile-operation-identity-mismatch");
            if (before.kind === "sign-up" && input.kind === "sign-up"
              && (before.commandId !== input.commandId || before.writeId !== input.writeId || before.emailKey !== input.emailKey
                || before.firstName !== input.firstName || before.lastName !== input.lastName || before.createdAt !== input.createdAt
                || before.commandFingerprint !== input.commandFingerprint || (before.expectedRevision !== undefined && before.expectedRevision !== input.expectedRevision))) fail("profile-signup-intent-changed");
            if (before.kind === "sign-up" && input.kind === "sign-up" && before.credentialInitialization !== undefined) {
              const prior = before.credentialInitialization, next = input.credentialInitialization;
              const stable = (value: typeof prior) => { const { phase: _phase, keyDocumentDigest: _digest, keyFile: _file, ...identity } = value; return identity; };
              if (next === undefined || canonicalJsonStringify(stable(next)) !== canonicalJsonStringify(stable(prior))
                || prior.keyDocumentDigest !== undefined && next.keyDocumentDigest !== prior.keyDocumentDigest
                || prior.keyFile !== undefined && canonicalJsonStringify(next.keyFile) !== canonicalJsonStringify(prior.keyFile)
                || ["admitted", "key-published", "document-published"].indexOf(next.phase) < ["admitted", "key-published", "document-published"].indexOf(prior.phase)) fail("profile-credential-initialization-intent-changed");
            }
          }
        }
        const operation = typeof input === "string" ? { kind: "delete" as const, operationId: z.uuid().parse(input) }
          : { kind: "write" as const, operation: ProfileOperationSchema.parse(input) };
        const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        atomicJson(join(control, "profile-publication.json"), { kind: "profile", schemaVersion: 1, installationId: locator.installationId, prior, document, operation,
          ...(keyStage === undefined ? {} : { keyStage }), erasures: prior.erasures, duo: prior.duo });
        if (keyStageWitness !== undefined) {
          observeCredentialKeyStageIntent(keyStageWitness);
          verifyCommittedCredentialKeyStage(keyStageWitness, locator.stateRoot);
        }
        const directory = join(locator.stateRoot, "machine", "operations");
        if (!lstatMaybe(directory)) { mkdirSync(directory, { mode: 0o700 }); syncDir(dirname(directory)); }
        privateDirectory(directory);
        const id = operation.kind === "write" ? operation.operation.operationId : operation.operationId;
        const path = join(directory, `${id}.json`);
        if (operation.kind === "write") atomicJson(path, operation.operation);
        else if (lstatMaybe(path)) { privateFile(path); unlinkSync(path); syncDir(directory); }
        atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, join(locator.stateRoot, "machine", "profiles.json"), document, prior.erasures, prior.duo));
        unlinkSync(join(control, "profile-publication.json")); syncDir(control);
      });
  }
  function publishRegistry(expected: ProfileRegistryDocument | undefined, document: ProfileRegistryDocument | undefined,
    registration?: { operation: z.infer<typeof SignUpOperationSchema>; witness: CommittedCredentialWitness; verifier: PreparedProfileVerifier }): void {
      mutex(control, () => {
        assertHeld();
        const current = readLocator(control, workspace);
        if (!equalLocator(current, locator)) fail("profile-machine-authority-changed");
        const before = readMachineRegistry(control, locator);
        if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-erasure-publication-pending");
        let next: ProfileRegistryDocument;
        if (registration !== undefined) {
          const pending = readStrict(join(locator.stateRoot, "machine", "operations", `${registration.operation.operationId}.json`), SignUpOperationSchema);
          if (canonicalJsonStringify(pending) !== canonicalJsonStringify(registration.operation) || pending.phase !== "publishing"
            || before.profiles.some(row => row.profileId === pending.profileId)) fail("profile-signup-intent-mismatch");
          const onboardingCompletion = profileOnboardingCompletion(pending);
          const revision = verifyCommittedCredentialWitness(registration.witness, join(locator.stateRoot, "profiles", pending.profileId),
            join(locator.stateRoot, "machine", "erasures", `${pending.profileId}.json`), pending);
          const row = ProfileRegistryRowSchema.parse({ profileId: pending.profileId, ...deriveProfileNames(pending.firstName, pending.lastName),
            registration: { operationId: pending.operationId, commandId: pending.commandId, writeId: pending.writeId, credentialRevision: revision, onboardingCompletion },
            createdAt: pending.createdAt, lastSignedInAt: pending.createdAt, credentialState: "saved", duoState: "ready", lifecycle: "ready" });
          next = ProfileRegistryDocumentSchema.parse({ ...before, profiles: [...before.profiles, row] });
        } else {
          next = ProfileRegistryDocumentSchema.parse(document);
          if (next.profiles.length !== before.profiles.length || next.profiles.some(row => {
            const original = before.profiles.find(prior => prior.profileId === row.profileId);
            return original === undefined || canonicalJsonStringify({ ...row, credentialState: original.credentialState, duoState: original.duoState,
              lifecycle: original.lifecycle, lastSignedInAt: original.lastSignedInAt }) !== canonicalJsonStringify(original);
          })) fail("profile-registry-registration-required");
        }
        if ((expected !== undefined && canonicalJsonStringify(before) !== canonicalJsonStringify(expected))
          || next.sessionGeneration < before.sessionGeneration) fail("profile-registry-publication-conflict");
        const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        const erasures = registration === undefined ? prior.erasures : [...prior.erasures, { profileId: registration.operation.profileId,
          originOperationId: registration.operation.operationId, head: verifyCommittedCredentialErasureOrigin(registration.witness), credentialKey: verifyCommittedCredentialKey(registration.witness) }];
        const duo: DuoContinuityRow[] = registration === undefined ? prior.duo : [...prior.duo,
          DuoContinuityRowSchema.parse(registration.operation.onboarding?.duo)];
        if (registration !== undefined) {
          const root = join(locator.stateRoot, "profiles", registration.operation.profileId), verifierPath = join(locator.stateRoot, "machine", "profile-verifiers.json");
          const priorVerifiers = readStrict(verifierPath, ProfileVerifierDocumentSchema), verifier = verifyPreparedProfileVerifier(registration.verifier, locator.stateRoot, registration.operation.profileId, registration.operation.emailKey);
          if (verifier.profileId !== registration.operation.profileId || verifier.emailKey !== registration.operation.emailKey
            || priorVerifiers.profiles.some(row => row.profileId === verifier.profileId || row.emailKey === verifier.emailKey)) fail("profile-onboarding-verifier-binding-invalid");
          const protectedFile = readPrivateFile(join(root, "credentials", "protected.json"), { label: "protected.json", maxBytes: Math.ceil(16 * 1024 * 1024 / 3) * 4 + 4096 });
          if (protectedFile === undefined) fail("profile-onboarding-finish-source-required");
          const intent = ProfilePublicationSchema.parse({ kind: "onboarding-finish", schemaVersion: 1, installationId: locator.installationId, prior,
            operation: registration.operation, priorDocument: before, document: next, priorVerifiers, verifiers: { ...priorVerifiers, profiles: [...priorVerifiers.profiles, verifier] },
            key: verifyCommittedCredentialKey(registration.witness), head: verifyCommittedCredentialErasureOrigin(registration.witness),
            pepper: preparedProfileVerifierPepperWitness(registration.verifier, locator.stateRoot, registration.operation.profileId, registration.operation.emailKey),
            protectedFile: { device: protectedFile.identity.device, inode: protectedFile.identity.inode, digest: createHash("sha256").update(protectedFile.bytes).digest("hex") },
            databases: profileAuthorityFileWitnesses(root) });
          if (intent.kind !== "onboarding-finish") fail("profile-onboarding-finish-invalid");
          verifyCommittedCredentialWitness(registration.witness, root, erasurePath(locator, registration.operation.profileId), registration.operation);
          verifyPreparedProfileVerifier(registration.verifier, locator.stateRoot, registration.operation.profileId, registration.operation.emailKey);
          atomicJson(join(control, "profile-publication.json"), intent);
          settleProfileOnboardingFinish(control, locator, intent); readMachineRegistry(control, locator, false); return;
        }
        atomicJson(join(control, "profile-publication.json"), { kind: "profile", schemaVersion: 1, installationId: locator.installationId, prior, document: next, erasures, duo });
        const path = join(locator.stateRoot, "machine", "profiles.json");
        atomicJson(path, next);
        atomicJson(join(control, "profile-registry.json"), profileRegistryWitness(locator.installationId, path, next, erasures, duo));
        unlinkSync(join(control, "profile-publication.json")); syncDir(control);
      });
  }
  function publishIssuedDuo(transaction: IssuedDuoTransaction, phase: "settle" | "durable-intent") {
      mutex(control, () => {
        assertHeld();
        if (!equalLocator(readLocator(control, workspace), locator)) fail("duo-machine-authority-changed");
        const intentPath = join(control, "profile-publication.json");
        if (phase === "settle" && lstatMaybe(intentPath)) {
          const pending = readStrict(intentPath, ProfilePublicationSchema);
          if (pending.kind === "duo" || pending.kind === "draft-duo") {
            if (pending.kind === "draft-duo" && issuedDuoDraftOperation(transaction) !== pending.operation.operationId) fail("duo-draft-operation-required");
            const registryDocument = readProfileEvidence(join(locator.stateRoot, "machine", "profiles.json"), ProfileRegistryDocumentSchema);
            resumeIssuedDuoTransaction(transaction, pending.capture);
            const priorContinuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
            if (pending.kind === "draft-duo") settleDraftDuoPublication(control, locator, registryDocument, priorContinuity, pending);
            else settleDuoPublication(control, locator, registryDocument, priorContinuity, pending);
            verifyIssuedDuoTransaction(transaction, pending.capture);
            readMachineRegistry(control, locator, false);
            assertHeld();
            return;
          }
        }
        const document = readMachineRegistry(control, locator);
        if (lstatMaybe(intentPath)) fail("duo-publication-pending");
        const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        const draftOperationId = issuedDuoDraftOperation(transaction);
        if (draftOperationId !== undefined) {
          const operation = readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${draftOperationId}.json`), SignUpOperationSchema);
          if (operation.onboarding === undefined || operation.profileId !== transaction.profileId) fail("duo-draft-operation-required");
          const capture = prepareIssuedDuoTransaction(transaction, locator.stateRoot, document, operation.onboarding.duo, operation);
          if (capture !== undefined) {
            const intent = ProfilePublicationSchema.parse({ kind: "draft-duo", schemaVersion: 1, installationId: locator.installationId, prior, capture,
              priorOperation: operation, operation: { ...operation, onboarding: { ...operation.onboarding, duo: capture.next } } });
            if (intent.kind !== "draft-duo") fail("duo-publication-kind-invalid");
            atomicJson(intentPath, intent);
            if (phase === "durable-intent") fail("duo-publication-pending");
            settleDraftDuoPublication(control, locator, document, prior, intent);
            readMachineRegistry(control, locator, false);
          }
          verifyIssuedDuoTransaction(transaction, capture);
          assertHeld();
          return;
        }
        const row = prior.duo.find(value => value.profileId === transaction.profileId);
        if (row === undefined) fail("duo-profile-unregistered");
        const capture = prepareIssuedDuoTransaction(transaction, locator.stateRoot, document, row);
        if (capture !== undefined) {
          const intent = ProfilePublicationSchema.parse({ kind: "duo", schemaVersion: 1, installationId: locator.installationId, prior, capture });
          if (intent.kind !== "duo") fail("duo-publication-kind-invalid");
          atomicJson(intentPath, intent);
          if (phase === "durable-intent") fail("duo-publication-pending");
          settleDuoPublication(control, locator, document, prior, intent);
          readMachineRegistry(control, locator, false);
        }
        verifyIssuedDuoTransaction(transaction, capture);
        assertHeld();
      });
    }
  function reclassifyDraft(witness: IncompleteProfileDraftWitness, claiming: boolean): void {
    mutex(control, () => {
      assertHeld();
      if (mode !== "exclusive") fail("profile-incomplete-stopped-authority-required");
      const before = readMachineRegistry(control, locator), capture = verifyIncompleteProfileDraft(witness, locator.stateRoot);
      if ((capture.operation.ownerClaim !== undefined) !== claiming) fail("existing-data-owner-claim-required");
      const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
      if (!prior.erasures.some(row => row.profileId === capture.operation.profileId && row.originOperationId === capture.operation.operationId
        && canonicalJsonStringify(row.credentialKey) === canonicalJsonStringify(capture.key))) fail("profile-incomplete-key-anchor-changed");
      const priorVerifiers = readProfileEvidence(join(locator.stateRoot, "machine", "profile-verifiers.json"), ProfileVerifierDocumentSchema);
      const intent = ProfilePublicationSchema.parse({ kind: "incomplete-profile-draft", schemaVersion: 1, installationId: locator.installationId, prior, capture,
        priorDocument: before, document: { ...before, profiles: before.profiles.filter(row => row.profileId !== capture.operation.profileId), activeProfileId: before.activeProfileId === capture.operation.profileId ? null : before.activeProfileId,
          sessionGeneration: before.sessionGeneration + 1 }, priorVerifiers,
        verifiers: { ...priorVerifiers, profiles: priorVerifiers.profiles.filter(row => row.profileId !== capture.operation.profileId) } });
      if (intent.kind !== "incomplete-profile-draft") fail("profile-incomplete-reclassification-invalid");
      verifyIncompleteProfileDraft(witness, locator.stateRoot);
      atomicJson(join(control, "profile-publication.json"), intent);
      settleIncompleteProfileDraft(control, locator, intent);
      readMachineRegistry(control, locator, false); assertHeld();
    });
  }
  const shared = Object.freeze({
    mode,
    locator: publicLocator,
    assertHeld,
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
    readProfileRegistry() {
      assertHeld();
      if (lstatMaybe(join(control, "profile-publication.json"))) {
        return mutex(control, () => {
          assertHeld();
          if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-machine-authority-changed");
          return readMachineRegistry(control, locator);
        });
      }
      assertLiveObservationMutex(control);
      if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-machine-authority-changed");
      const before = profileObservation(control, locator);
      const document = readMachineRegistry(control, locator, false);
      const after = profileObservation(control, locator);
      assertHeld();
      assertLiveObservationMutex(control);
      if (before !== after || lstatMaybe(join(control, "profile-publication.json"))) fail("profile-registry-observation-changed");
      if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-machine-authority-changed");
      return document;
    },
    assertDraftDuoPublicationRecovery(operationId: string, profileId: string, generation: number) {
      assertHeld();
      if (!equalLocator(readLocator(control, workspace), locator)) fail("duo-draft-authority-changed");
      const intent = readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema);
      if (intent.kind !== "draft-duo" || intent.installationId !== locator.installationId || intent.operation.operationId !== operationId
        || intent.operation.profileId !== profileId || intent.operation.onboarding?.generation !== generation) fail("duo-draft-recovery-intent-mismatch");
      const path = join(locator.stateRoot, "machine", "profiles.json"), document = readProfileEvidence(path, ProfileRegistryDocumentSchema), info = lstatSync(path);
      if (document.profiles.some(row => row.profileId === profileId) || info.dev !== intent.prior.device || info.ino !== intent.prior.inode
        || createHash("sha256").update(canonicalJsonStringify(document)).digest("hex") !== intent.prior.digest) fail("duo-draft-recovery-source-changed");
      const operation = readStrict(join(locator.stateRoot, "machine", "operations", `${operationId}.json`), SignUpOperationSchema);
      if (canonicalJsonStringify(operation) !== canonicalJsonStringify(intent.priorOperation)
        && canonicalJsonStringify(operation) !== canonicalJsonStringify(intent.operation)) fail("duo-draft-recovery-operation-changed");
      return operation;
    },
    commitProfileDuo(transaction: IssuedDuoTransaction) { publishIssuedDuo(transaction, "settle"); },
    reclassifyIncompleteProfile(witness: IncompleteProfileDraftWitness) { reclassifyDraft(witness, false); },
    claimExistingProfileData(witness: IncompleteProfileDraftWitness) { reclassifyDraft(witness, true); },
    abortUnpublishedProfile(witness: UnpublishedDraftAbortWitness) {
      mutex(control, () => {
        assertHeld();
        if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-draft-abort-machine-changed");
        const document = readMachineRegistry(control, locator), capture = verifyUnpublishedDraftAbort(witness, locator.stateRoot);
        const operationPath = join(locator.stateRoot, "machine", "operations", `${capture.operation.operationId}.json`);
        if (canonicalJsonStringify(readProfileEvidence(operationPath, SignUpOperationSchema)) !== canonicalJsonStringify(capture.operation)) fail("profile-draft-abort-operation-changed");
        const pending = readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema);
        if (pending.kind !== "draft-erasure" || canonicalJsonStringify(pending.operation) !== canonicalJsonStringify(capture.operation)
          || canonicalJsonStringify(pending.source) !== canonicalJsonStringify(capture.abortSource)
          || canonicalJsonStringify(pending.settledHead) !== canonicalJsonStringify(capture.head)) fail("profile-draft-abort-erasure-custody-required");
        const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        const intent = ProfilePublicationSchema.parse({ kind: "draft-abort", schemaVersion: 1, installationId: locator.installationId, prior, capture });
        if (intent.kind !== "draft-abort") fail("profile-draft-abort-kind-invalid");
        verifyUnpublishedDraftAbort(witness, locator.stateRoot);
        atomicJson(join(control, "profile-publication.json"), intent);
        settleUnpublishedDraftAbort(control, locator, document, prior, intent);
        readMachineRegistry(control, locator, false); assertHeld();
      });
    },
    commitProfileDuoIntent(transaction: IssuedDuoTransaction) { publishIssuedDuo(transaction, "durable-intent"); },
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
    capturePendingProfileLogout(input: z.infer<typeof LogoutOperationSchema>) {
      const operation = LogoutOperationSchema.parse(input);
      const read = () => mutex(control, () => {
        assertHeld();
        if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-pending-logout-locator-changed");
        const document = readMachineRegistry(control, locator, false);
        const row = document.profiles.find(entry => entry.profileId === operation.profileId);
        if (document.activeProfileId !== null || row?.lifecycle !== "cancelling" || operation.phase === "complete") {
          fail("profile-pending-logout-unavailable");
        }
        const current = readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${operation.operationId}.json`), LogoutOperationSchema);
        if (canonicalJsonStringify(current) !== canonicalJsonStringify(operation)) fail("profile-pending-logout-operation-changed");
        const observation = profileObservation(control, locator);
        const publication = readPrivateFile(join(control, "profile-publication.json"), { label: "lock", maxBytes: 1_048_576 });
        const pending = publication === undefined ? { absent: true } : { device: publication.identity.device, inode: publication.identity.inode,
          digest: createHash("sha256").update(publication.bytes).digest("hex") };
        assertHeld();
        return canonicalJsonStringify({ document, observation, pending });
      });
      const original = read();
      return Object.freeze({ assertHeld() {
        if (read() !== original) fail("profile-pending-logout-authority-changed");
      } });
    },
    assertProfileErasureHead(profileId: string, head: CredentialErasureHead) {
      assertHeld();
      readMachineRegistry(control, locator, false);
      if (lstatMaybe(join(control, "profile-publication.json"))) {
        const pending = readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema);
        if (pending.kind === "draft-erasure") {
          if (pending.profileId !== profileId || head.state !== "established" || head.epoch !== pending.nextEpoch || head.journal.digest !== pending.nextDigest) fail("profile-draft-erasure-head-mismatch");
          assertCredentialErasureHeadFiles(erasurePath(locator, profileId), head);
          return;
        }
        const credentialKey = pending.kind === "credential-key" && pending.capture.operation.profileId === profileId
          && canonicalJsonStringify(pending.capture.head) === canonicalJsonStringify(head);
        const stage = pending.kind === "profile" ? pending.keyStage : undefined;
        const priorHead = pending.prior.erasures.find(row => row.profileId === profileId);
        const stagedKey = stage?.operation.profileId === profileId && (priorHead === undefined
          ? head.state === "never-erased" && !stage.registry.profiles.some(row => row.profileId === profileId)
          : canonicalJsonStringify(priorHead.head) === canonicalJsonStringify(head));
        if (!credentialKey && !stagedKey) fail("profile-erasure-publication-pending");
      }
      const continuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
      const row = continuity.erasures.find(row => row.profileId === profileId);
      // Setup has no published origin; only verified registration establishes it.
      if (row === undefined) {
        const pending = profileOperationInventory(locator.stateRoot).some(row => {
          const operation = readStrict(join(locator.stateRoot, "machine", "operations", row.operationId + ".json"), ProfileOperationSchema);
          return operation.kind === "sign-up" && operation.profileId === profileId;
        });
        if (!pending || head.state !== "never-erased") fail("profile-erasure-origin-missing");
      } else if (canonicalJsonStringify(row.head) !== canonicalJsonStringify(head)) fail("profile-erasure-continuity-mismatch");
    },
    assertDraftErasureJournalRecovery(profileId: string, request: ErasureRequestIdentity, digest: string) {
      assertHeld();
      const intent = readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema);
      if (intent.kind !== "draft-erasure" || intent.profileId !== profileId || intent.settledHead !== undefined
        || intent.nextDigest !== digest || canonicalJsonStringify(intent.request) !== canonicalJsonStringify(request)) fail("profile-draft-erasure-journal-recovery-refused");
      assertDraftErasureSource(locator, readMachineRegistry(control, locator, false), intent);
    },
    resumeProfileErasure(profileId: string, request: ErasureRequestIdentity, head: CredentialErasureHead) {
      assertHeld();
      const pending = lstatMaybe(join(control, "profile-publication.json"));
      if (pending === undefined) { shared.assertProfileErasureHead(profileId, head); return; }
      const intent = readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema);
      if (intent.kind === "draft-erasure") {
        if (intent.profileId !== profileId || canonicalJsonStringify(intent.request) !== canonicalJsonStringify(request)
          || head.state !== "never-erased" && (head.epoch !== intent.nextEpoch || head.journal.digest !== intent.nextDigest)) fail("profile-draft-erasure-intent-outcome-uncertain");
        readMachineRegistry(control, locator, false); assertCredentialErasureHeadFiles(erasurePath(locator, profileId), head); return;
      }
      if (intent.kind !== "erasure" || intent.profileId !== profileId || intent.installationId !== locator.installationId
        || canonicalJsonStringify(intent.request) !== canonicalJsonStringify(request)) fail("profile-erasure-intent-mismatch");
      readMachineRegistry(control, locator, false);
      const prior = intent.prior.erasures.find(row => row.profileId === profileId);
      if (prior === undefined || (canonicalJsonStringify(prior.head) !== canonicalJsonStringify(head)
        && (head.state !== "established" || head.epoch !== intent.nextEpoch || head.journal.digest !== intent.nextDigest))) fail("profile-erasure-intent-outcome-uncertain");
    },
    beginProfileErasure(profileId: string, witness: VerifiedCredentialErasureIntent) {
      const root = join(locator.stateRoot, "profiles", profileId), journalPath = erasurePath(locator, profileId);
      const capture = verifyCredentialErasureIntent(witness, root, journalPath, { installationId: locator.installationId, profileId });
      mutex(control, () => {
        assertHeld(); readMachineRegistry(control, locator, false);
        if (lstatMaybe(join(control, "journal.json"))) fail("profile-erasure-operation-busy");
        if (lstatMaybe(join(control, "profile-publication.json"))) {
          const pending = readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema);
          if (pending.kind === "draft-erasure") {
            if (capture.draftAbort === undefined || pending.profileId !== profileId || canonicalJsonStringify(pending.request) !== canonicalJsonStringify(capture.request)
              || canonicalJsonStringify(pending.operation) !== canonicalJsonStringify(capture.draftAbort.operation)
              || canonicalJsonStringify(pending.source) !== canonicalJsonStringify(capture.draftAbort.source)
              || pending.nextEpoch !== capture.nextEpoch || pending.nextDigest !== capture.nextDigest) fail("profile-draft-erasure-intent-mismatch");
            return;
          }
          if (pending.kind !== "erasure" || pending.profileId !== profileId || pending.installationId !== locator.installationId
            || canonicalJsonStringify(pending.request) !== canonicalJsonStringify(capture.request) || pending.nextEpoch !== capture.nextEpoch
            || pending.nextDigest !== capture.nextDigest || canonicalJsonStringify(pending.prior.erasures.find(row => row.profileId === profileId)?.head) !== canonicalJsonStringify(capture.prior)) fail("profile-erasure-intent-mismatch");
          return;
        }
        const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        if (capture.draftAbort !== undefined) {
          if (capture.prior.state !== "never-erased" || prior.erasures.some(row => row.profileId === profileId)) fail("profile-draft-erasure-prior-invalid");
          const intent = ProfilePublicationSchema.parse({ kind: "draft-erasure", schemaVersion: 1, installationId: locator.installationId, prior, profileId,
            request: capture.request, nextEpoch: capture.nextEpoch, nextDigest: capture.nextDigest,
            operation: capture.draftAbort.operation, source: capture.draftAbort.source, priorHead: capture.prior });
          if (intent.kind !== "draft-erasure") fail("profile-draft-erasure-intent-invalid");
          assertDraftErasureSource(locator, readMachineRegistry(control, locator, false), intent);
          atomicJson(join(control, "profile-publication.json"), intent); return;
        }
        const matching = prior.operations.map(row => readStrict(join(locator.stateRoot, "machine", "operations", row.operationId + ".json"), ProfileOperationSchema))
          .filter(operation => operation.kind === "logout" && operation.profileId === profileId && operation.phase === "erasing"
            && operation.commandId === capture.request.commandId && operation.writeId === capture.request.writeId
            && operation.expectedRevision === capture.request.expectedRevision && operation.at === capture.request.updatedAt);
        if (matching.length !== 1 || capture.request.commandFingerprint !== "b".repeat(64)) fail("profile-erasure-intent-mismatch");
        const row = prior.erasures.find(row => row.profileId === profileId);
        if (row === undefined || canonicalJsonStringify(row.head) !== canonicalJsonStringify(capture.prior)) fail("profile-erasure-continuity-mismatch");
        verifyCredentialErasureIntent(witness, root, journalPath, { installationId: locator.installationId, profileId });
        atomicJson(join(control, "profile-publication.json"), { kind: "erasure", schemaVersion: 1, installationId: locator.installationId,
          prior, profileId, request: capture.request, nextEpoch: capture.nextEpoch, nextDigest: capture.nextDigest });
      });
    },
    settleProfileErasure(profileId: string, request: ErasureRequestIdentity, witness: VerifiedCredentialErasureHead) {
      const root = join(locator.stateRoot, "profiles", profileId), journalPath = erasurePath(locator, profileId);
      const head = verifyCredentialErasureHead(witness, root, journalPath, { installationId: locator.installationId, profileId });
      mutex(control, () => {
        assertHeld();
        if (!lstatMaybe(join(control, "profile-publication.json"))) { shared.assertProfileErasureHead(profileId, head); return; }
        const intent = readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema);
        if (intent.kind === "draft-erasure") {
          if (intent.profileId !== profileId || canonicalJsonStringify(intent.request) !== canonicalJsonStringify(request) || head.state !== "established"
            || head.epoch !== intent.nextEpoch || head.journal.digest !== intent.nextDigest) fail("profile-draft-erasure-settlement-mismatch");
          assertDraftErasureSource(locator, readMachineRegistry(control, locator, false), intent);
          if (intent.settledHead !== undefined && canonicalJsonStringify(intent.settledHead) !== canonicalJsonStringify(head)) fail("profile-draft-erasure-settlement-changed");
          atomicJson(join(control, "profile-publication.json"), { ...intent, settledHead: head }); return;
        }
        if (intent.kind !== "erasure" || intent.installationId !== locator.installationId || intent.profileId !== profileId
          || canonicalJsonStringify(intent.request) !== canonicalJsonStringify(request) || head.state !== "established"
          || head.epoch !== intent.nextEpoch || head.journal.digest !== intent.nextDigest) fail("profile-erasure-settlement-mismatch");
        const prior = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        const next = { ...intent.prior, erasures: intent.prior.erasures.map(row => row.profileId === profileId ? { ...row, head } : row) };
        if (canonicalJsonStringify(prior) !== canonicalJsonStringify(intent.prior)
          && canonicalJsonStringify(prior) !== canonicalJsonStringify(next)) fail("profile-erasure-settlement-control-changed");
        verifyCredentialErasureHead(witness, root, journalPath, { installationId: locator.installationId, profileId });
        atomicJson(join(control, "profile-registry.json"), next);
        unlinkSync(join(control, "profile-publication.json")); syncDir(control);
      });
    },
    assertProfileCredentialKeyAnchor(profileId: string) {
      shared.readProfileRegistry();
      const continuity = readProfileEvidence(join(control, "profile-registry.json"), ProfileContinuitySchema);
      const row = continuity.erasures.find(entry => entry.profileId === profileId);
      if (row?.credentialKey === undefined) return false;
      assertCredentialKeyWitness(join(locator.stateRoot, "machine", "credential-keys", `${profileId}.json`), row.credentialKey,
        { installationId: locator.installationId, profileId });
      return true;
    },
    publishProfileCredentialInitialization(profileId: string, witness: CommittedCredentialInitialization) {
      mutex(control, () => {
        assertHeld();
        const capture = verifyCommittedCredentialInitialization(witness, locator.stateRoot,
          erasurePath(locator, profileId));
        if (lstatMaybe(join(control, "profile-publication.json"))) {
          const pending = readStrict(join(control, "profile-publication.json"), ProfilePublicationSchema);
          if (pending.kind !== "credential-key" || canonicalJsonStringify(pending.capture) !== canonicalJsonStringify(capture)) fail("profile-key-publication-intent-changed");
          readMachineRegistry(control, locator, true, capture);
          return;
        }
        const before = readMachineRegistry(control, locator);
        if (capture.operation.profileId !== profileId) fail("profile-key-publication-profile-mismatch");
        const prior = readProfileEvidence(join(control, "profile-registry.json"), ProfileContinuitySchema);
        const row = prior.erasures.find(entry => entry.profileId === profileId);
        if (row === undefined) fail("profile-key-publication-unregistered");
        if (row.credentialKey !== undefined) {
          if (canonicalJsonStringify(row.credentialKey) !== canonicalJsonStringify(capture.key)) fail("profile-key-anchor-replacement-refused");
          return;
        }
        if (canonicalJsonStringify(row.head) !== canonicalJsonStringify(capture.head)) fail("profile-key-publication-head-changed");
        const next = ProfileRegistryDocumentSchema.parse({ ...before, activeProfileId: null, sessionGeneration: before.sessionGeneration + 1 });
        if (!Number.isSafeInteger(next.sessionGeneration)) fail("profile-key-publication-generation-invalid");
        const operationPath = join(locator.stateRoot, "machine", "operations", `${capture.operation.operationId}.json`);
        if (canonicalJsonStringify(readProfileEvidence(operationPath, SignUpOperationSchema)) !== canonicalJsonStringify(capture.operation)) fail("profile-key-publication-intent-changed");
        atomicJson(join(control, "profile-publication.json"), { kind: "credential-key", schemaVersion: 1, installationId: locator.installationId, prior, priorDocument: before, document: next, capture });
        readMachineRegistry(control, locator, true, capture);
      });
    },
    publishProfileRegistry(expected: ProfileRegistryDocument, document: ProfileRegistryDocument) { publishRegistry(expected, document); },
    publishProfileRegistration(operation: z.infer<typeof SignUpOperationSchema>, witness: CommittedCredentialWitness, verifier: PreparedProfileVerifier) { publishRegistry(undefined, undefined, { operation, witness, verifier }); },
    beginProfileSignUp(fields: Omit<z.infer<typeof SignUpOperationSchema>, "operationId" | "profileId" | "commandId" | "writeId" | "schemaVersion" | "kind" | "phase" | "onboarding" | "ownerClaim">) {
      if ("ownerClaim" in fields) fail("existing-data-owner-claim-required");
      const profileId = randomUUID();
      const operation = SignUpOperationSchema.parse({ ...fields, credentialInitialization: fields.credentialInitialization ?? { mode: "initial", keyId: randomUUID(), phase: "admitted" }, schemaVersion: 1, kind: "sign-up", phase: "applying",
        operationId: randomUUID(), profileId, commandId: randomUUID(), writeId: randomUUID(),
        onboarding: { accountId: randomUUID(), generation: 1, attempts: [], duo: { state: "never-initialized", profileId, revision: 0 } } });
      publishOperation(operation, true);
      return operation;
    },
    readProfileCredentialKeyStage(operation: z.infer<typeof SignUpOperationSchema>) {
      assertHeld(); readMachineRegistry(control, locator, false);
      if (!lstatMaybe(join(control, "profile-publication.json"))) return undefined;
      const pending = readProfileEvidence(join(control, "profile-publication.json"), ProfilePublicationSchema);
      if (pending.kind === "credential-key" && canonicalJsonStringify(pending.capture.operation) === canonicalJsonStringify(operation)) return undefined;
      if (pending.kind !== "profile" || pending.keyStage === undefined
        || canonicalJsonStringify(pending.keyStage.priorOperation) !== canonicalJsonStringify(operation)
          && canonicalJsonStringify(pending.keyStage.operation) !== canonicalJsonStringify(operation)) fail("credential-key-stage-intent-changed");
      return pending.keyStage;
    },
    publishProfileOperation(input: ProfileOperation | string, keyStage?: CommittedCredentialKeyStage) { publishOperation(input, false, keyStage); },

    readInstallationContext() {
      const receipts = shared.readRelocationReceipts();
      return Object.freeze({ workspace, locator: publicLocator, receipts });
    },
    release() {
      if (released) return;
      mutex(control, () => { assertHeld(); unlinkSync(leasePath); syncDir(join(control, "leases")); });
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
    assertRestoreHeld(workspace, heldRestore);
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
    captureProfileRestore(profileId, witness) {
      assertHeld();
      const root = join(locator.stateRoot, "profiles", profileId);
      const binding = { installationId: locator.installationId, profileId };
      const head = verifyCredentialErasureHead(witness, root, erasurePath(locator, profileId), binding);
      readMachineRegistry(control, locator, false);
      if (lstatMaybe(join(control, "profile-publication.json")) || lstatMaybe(join(control, "journal.json"))) fail("profile-restore-operation-busy");
      const continuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
      const member = continuity.erasures.find(row => row.profileId === profileId);
      if (member === undefined || canonicalJsonStringify(member.head) !== canonicalJsonStringify(head)) fail("profile-restore-erasure-mismatch");
      assertProfileRestoreDatabaseBinding(join(root, "state.db"), binding);
      const credentialKey = verifyCredentialKeyHead(witness, root, binding);
      return ProfileRestoreContextSchema.parse({ binding, continuity, head, credentialKey });
    },
    assertProfileRestoreHeld(input, restore) {
      assertHeld(); assertRestoreHeld(workspace, restore);
      const pending = readStrict(join(control, "journal.json"), AuthorityRestoreJournalSchema);
      if (pending.installationId !== locator.installationId || (pending.restoreAdmissionId !== restore.admissionId && options?.recoverAuthorityRestore?.restoreAdmission !== restore)
        || canonicalJsonStringify(pending.restore) !== canonicalJsonStringify(input)
        || canonicalJsonStringify(pending.source) !== canonicalJsonStringify(locator)) fail("profile-restore-custody-mismatch");
      checkRestoreInput(locator, input);
      assertCredentialErasureHeadFiles(erasurePath(locator, input.profile.binding.profileId), input.profile.head);
      if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-restore-erasure-pending");
      if (pending.invalidation === undefined) {
        readMachineRegistry(control, locator, false);
        if (canonicalJsonStringify(readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema)) !== canonicalJsonStringify(input.profile.continuity)) fail("profile-restore-control-changed");
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
      assertHeld(); assertRestoreHeld(workspace, restore); checkRestoreInput(locator, parsed);
      assertProfileRestoreDatabaseBinding(parsed.authorityPath, parsed.profile.binding);
      assertProfileRestoreDatabaseBinding(parsed.stagedPath, parsed.profile.binding);
      mutex(control, () => {
        assertHeld(); assertRestoreHeld(workspace, restore);
        readMachineRegistry(control, locator, false);
        if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-restore-erasure-pending");
        const continuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
        if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(parsed.profile.continuity)) fail("profile-restore-control-changed");
        assertCredentialErasureHeadFiles(erasurePath(locator, parsed.profile.binding.profileId), parsed.profile.head);
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
          restoreAdmissionId: restore.admissionId, restore: parsed }));
      });
    },
    settleAuthorityRestore(input, outcome, verify, restore) {
      const parsed = AuthorityRestoreInputSchema.parse(input);
      assertHeld(); assertRestoreHeld(workspace, restore);
      assertProfileRestoreDatabaseBinding(parsed.authorityPath, parsed.profile.binding);
      const verified = outcome === "replaced" ? z.strictObject({ authorityGeneration: GenerationSchema, authorityContentFingerprint: DigestSchema }).parse(verify()) : undefined;
      mutex(control, () => {
        assertHeld(); assertRestoreHeld(workspace, restore);
        let pending = readStrict(join(control, "journal.json"), AuthorityRestoreJournalSchema);
        if (pending.installationId !== locator.installationId
          || canonicalJsonStringify(pending.source) !== canonicalJsonStringify(locator)
          || canonicalJsonStringify(pending.restore) !== canonicalJsonStringify(parsed)) fail("restore settlement operation binding mismatch");
        checkRestoreInput(locator, parsed);
        assertRestoreSuspect(parsed);
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
        assertCredentialErasureHeadFiles(erasurePath(locator, parsed.profile.binding.profileId), parsed.profile.head);
        if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-restore-erasure-pending");
        const continuityPath = join(control, "profile-registry.json"), registryPath = join(locator.stateRoot, "machine", "profiles.json");
        const continuity = readStrict(continuityPath, ProfileContinuitySchema);
        if (outcome === "replaced") {
          if (pending.invalidation === undefined) {
            const document = readMachineRegistry(control, locator, false);
            if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(parsed.profile.continuity)) fail("profile-restore-control-changed");
            const next = ProfileRegistryDocumentSchema.parse({ ...document, activeProfileId: null, sessionGeneration: document.sessionGeneration + 1 });
            pending = AuthorityRestoreJournalSchema.parse({ ...pending, invalidation: { document: next, continuity } });
            atomicJson(join(control, "journal.json"), pending);
          }
          const invalidation = pending.invalidation;
          if (invalidation === undefined) fail("profile-restore-invalidation-missing");
          const currentDocument = readStrict(registryPath, ProfileRegistryDocumentSchema);
          if (canonicalJsonStringify(currentDocument) !== canonicalJsonStringify(invalidation.document)
            && canonicalJsonStringify(profileRegistryWitness(locator.installationId, registryPath, currentDocument, continuity.erasures, continuity.duo)) !== canonicalJsonStringify(invalidation.continuity)) fail("profile-restore-invalidation-uncertain");
          if (canonicalJsonStringify(currentDocument) !== canonicalJsonStringify(invalidation.document)) atomicJson(registryPath, invalidation.document);
          const nextContinuity = profileRegistryWitness(locator.installationId, registryPath, invalidation.document, invalidation.continuity.erasures, invalidation.continuity.duo);
          if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(invalidation.continuity)
            && canonicalJsonStringify(continuity) !== canonicalJsonStringify(nextContinuity)) fail("profile-restore-invalidation-control-changed");
          atomicJson(continuityPath, nextContinuity);
        } else if (pending.invalidation !== undefined || canonicalJsonStringify(continuity) !== canonicalJsonStringify(parsed.profile.continuity)) fail("profile-restore-unchanged-control-mismatch");
        sameRestoreFile(parsed.authorityPath, outcome === "replaced" ? parsed.staged : parsed.live);
        unlinkSync(join(control, "journal.json")); syncDir(control);
      });
    },
    beginRelocation(destination, plan, restore) {
      assertHeld();
      assertRestoreHeld(workspace, restore);
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
        plan: parsedPlan, restoreAdmissionId: restore.admissionId, retentions, pinnedEntries });
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
      if (!lstatMaybe(directory)) { mkdirSync(directory, { mode: 0o700 }); syncDir(control); }
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
      unlinkSync(join(control, "journal.json")); syncDir(control);
    },
  });
  issuedLeases.add(exclusive);
  return exclusive;
}

export function assertInstallationLease(value: InstallationLease): void {
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
  run(plan: boolean): Readonly<{ state: "current" | "planned" | "upgraded"; runtimeAccess: "owner-claim-required" | "unchanged"; profileCount: number; receiptId?: string }>;
  release(): void;
}

export interface StoppedControlProfileInventory { readonly profileId: string }

const stoppedControlInventories = new WeakMap<StoppedControlProfileInventory, Readonly<{
  binding: z.infer<typeof ProfileDatabaseBindingSchema>; stateRoot: string; artifactRoot: string; machineRoot: string; locator: RuntimeLocator;
  key: z.infer<typeof CredentialKeyWitnessSchema>; head: z.infer<typeof CredentialErasureHeadSchema>;
  assertHeld(): void; revalidateSource(): void; readInstallationContext(): ReturnType<InstallationLease["readInstallationContext"]>;
}>>();

export function requireStoppedControlProfileInventory(value: StoppedControlProfileInventory) {
  const issued = stoppedControlInventories.get(value);
  if (issued === undefined) fail("profile-control-upgrade-inventory-unissued");
  issued.assertHeld();
  return issued;
}

function readControlUpgradeReceipt(path: string): z.infer<typeof ControlUpgradeReceiptSchema> {
  assertNoSymlinkComponents(path);
  const file = readPrivateFile(path, { label: "lock", maxBytes: 16 * 1024 * 1024 });
  if (file === undefined) fail("profile-control-upgrade-evidence-missing");
  return ControlUpgradeReceiptSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)));
}

function controlUpgradeFile(path: string) {
  assertNoSymlinkComponents(path);
  const file = readPrivateFile(path, { label: "lock", maxBytes: 1_048_576 });
  if (file === undefined) fail("profile-control-upgrade-evidence-missing");
  return { device: file.identity.device, inode: file.identity.inode, digest: createHash("sha256").update(file.bytes).digest("hex") };
}

function sameControlUpgradeFile(path: string, expected: z.infer<typeof ControlUpgradeFileSchema>): boolean {
  return lstatMaybe(path) !== undefined && canonicalJsonStringify(controlUpgradeFile(path)) === canonicalJsonStringify(expected);
}

function priorControlUpgradeEvidence(locator: RuntimeLocator, prior: z.infer<typeof PriorProfileContinuitySchema>): string {
  const machine = join(locator.stateRoot, "machine"), registryPath = join(machine, "profiles.json");
  const document = readProfileEvidence(registryPath, ProfileRegistryDocumentSchema);
  if (document.profiles.some(row => row.lifecycle !== "ready" || row.credentialState !== "saved")) fail("profile-control-upgrade-pending-conversion-unsupported");
  const reconstructed = profileRegistryWitness(locator.installationId, registryPath, document, prior.erasures, []);
  const { duo: _duo, ...base } = reconstructed;
  if (canonicalJsonStringify({ ...base, schemaVersion: 1 }) !== canonicalJsonStringify(prior)) fail("profile-control-upgrade-prior-mismatch");
  if (lstatMaybe(join(machine, "duo-credentials"))) fail("profile-control-upgrade-duo-material-present");
  const known = new Set(["profiles.json", "profile-registry-version.json", "profile-verifiers.json", "profile-pepper", "credential-keys", "erasures", "operations"]);
  privateDirectory(machine);
  if (readdirSync(machine).some(name => !known.has(name))) fail("profile-control-upgrade-machine-membership-unknown");
  const verifiers = readProfileEvidence(join(machine, "profile-verifiers.json"), ProfileVerifierDocumentSchema);
  if (verifiers.profiles.length !== document.profiles.length || new Set(verifiers.profiles.map(row => row.profileId)).size !== verifiers.profiles.length
    || verifiers.profiles.some(row => !document.profiles.some(profile => profile.profileId === row.profileId))) fail("profile-control-upgrade-verifier-membership");
  const pepper = readPrivateFile(join(machine, "profile-pepper"), { label: "lock", maxBytes: 32 });
  if (pepper === undefined || pepper.bytes.length !== 32) fail("profile-control-upgrade-pepper-invalid");
  const operations = profileOperationInventory(locator.stateRoot).map(row => readProfileEvidence(join(machine, "operations", `${row.operationId}.json`), ProfileOperationSchema));
  if (operations.some(operation => operation.kind !== "logout" || operation.phase !== "complete")) fail("profile-control-upgrade-operation-pending");
  assertErasureMembership(document, prior.erasures); assertProfileCredentialKeyMembership(locator, prior.erasures);
  const profiles = prior.erasures.map(row => {
    if (row.credentialKey === undefined) fail("profile-control-upgrade-credential-conversion-required");
    const root = join(locator.stateRoot, "profiles", row.profileId), path = join(root, "state.db");
    assertCanonicalProfileBinding(path, { installationId: locator.installationId, profileId: row.profileId });
    const metadata = lstatSync(path);
    const protectedDocument = inspectProfileCredentialsForControlUpgrade(locator.stateRoot,
      { installationId: locator.installationId, profileId: row.profileId }, row.credentialKey, row.head);
    return { profileId: row.profileId, protectedDocument, database: { device: metadata.dev, inode: metadata.ino,
      size: metadata.size, modified: metadata.mtimeMs, changed: metadata.ctimeMs } };
  });
  return canonicalJsonStringify({ prior, profiles, verifiers: controlUpgradeFile(join(machine, "profile-verifiers.json")), pepper: controlUpgradeFile(join(machine, "profile-pepper")) });
}

export function readIssuedDuoContinuity(lease: InstallationLease, profileId: string): Readonly<DuoContinuityRow> {
  assertInstallationLease(lease);
  lease.assertHeld();
  const continuity = readStrict(join(lease.readInstallationContext().workspace, CONTROL, "profile-registry.json"), ProfileContinuitySchema);
  const row = continuity.duo.find((value) => value.profileId === profileId);
  if (row === undefined) fail("duo-profile-unregistered");
  const snapshot = DuoContinuityRowSchema.parse(row);
  if (snapshot.state !== "never-initialized") Object.freeze(snapshot.document);
  return Object.freeze(snapshot);
}

export function assertStoppedMachineMaintenance(lease: InstallationLease, restore: RestoreAdmissionHandle): void {
  assertInstallationLease(lease);
  if (lease.mode !== "exclusive") fail("profile-control-upgrade-runtime-active");
  const workspace = lease.readInstallationContext().workspace;
  assertRestoreHeld(workspace, restore);
  const processLockRoot = fixedLockRoot(workspace);
  if (RUNTIME_PROCESS_LOCK_NAMES.some((name) => runtimeProcessLockIsActive(processLockRoot, name))) fail("profile-control-upgrade-runtime-active");
  const orphans = inspectRuntimeProcessOrphans(processLockRoot);
  if (orphans.staleServerRecords > 0 || orphans.staleWorkerRecords > 0) fail("profile-control-upgrade-process-custody-unproved");
  if (!equalLocator(readLocator(join(workspace, CONTROL), workspace), lease.locator)) fail("profile-control-upgrade-locator-changed");
}

export interface DuoPublicationRecoveryClaim { readonly profileId: string }
const duoPublicationRecoveries = new WeakMap<DuoPublicationRecoveryClaim, {
  lease: InstallationLease; restore: RestoreAdmissionHandle; intent: Extract<z.infer<typeof ProfilePublicationSchema>, { kind: "duo" | "draft-duo" }>;
  path: string; digest: string;
}>();

function authenticateStoppedDuoPublication(lease: InstallationLease, restore: RestoreAdmissionHandle) {
  assertStoppedMachineMaintenance(lease, restore);
  const workspace = lease.readInstallationContext().workspace;
  const control = join(workspace, CONTROL);
  const intentPath = join(control, "profile-publication.json");
  if (lstatMaybe(intentPath) === undefined) fail("duo-publication-recovery-absent");
  const intent = readStrict(intentPath, ProfilePublicationSchema);
  if (intent.kind !== "duo" && intent.kind !== "draft-duo") fail("duo-publication-pending");
  const capture = intent.capture;
  const locator = lease.locator;
  const stage = duoStagePath(locator.stateRoot, capture);
  const canonical = join(locator.stateRoot, "machine", "duo-credentials", `${capture.profileId}.json`);
  const path = lstatMaybe(stage) !== undefined ? stage : canonical;
  assertDuoPublishedFile(path, capture);
  const file = readPrivateFile(path, { label: "Duo credential", maxBytes: 16 * 1024 * 1024 });
  if (file === undefined) fail("duo-document-required");
  const digest = createHash("sha256").update(file.bytes).digest("hex");
  if (digest !== capture.next.document.digest || file.identity.device !== capture.next.document.device || file.identity.inode !== capture.next.document.inode) fail("duo-publication-file-changed");
  const envelope = readDuoPublicationEnvelope(file.bytes);
  if (envelope.profileId !== capture.profileId || envelope.installationId !== locator.installationId || envelope.revision !== capture.next.revision
    || envelope.purpose !== "relay:duo-credential:v1") fail("duo-publication-prior-changed");
  const registryPath = join(locator.stateRoot, "machine", "profiles.json");
  const document = readProfileEvidence(registryPath, ProfileRegistryDocumentSchema);
  const registryInfo = lstatSync(registryPath);
  if (createHash("sha256").update(canonicalJsonStringify(document)).digest("hex") !== intent.prior.digest
    || registryInfo.dev !== intent.prior.device || registryInfo.ino !== intent.prior.inode) fail("profile-control-upgrade-source-changed");
  const continuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
  const nextContinuity = intent.kind === "draft-duo"
    ? profileRegistryWitness(locator.installationId, registryPath, document, intent.prior.erasures, intent.prior.duo)
    : { ...intent.prior, duo: intent.prior.duo.map((row) => row.profileId === capture.profileId ? capture.next : row) };
  if (intent.kind === "draft-duo") {
    const operation = readProfileEvidence(join(locator.stateRoot, "machine", "operations", `${intent.operation.operationId}.json`), SignUpOperationSchema);
    if (document.profiles.some(row => row.profileId === capture.profileId)
      || canonicalJsonStringify(operation) !== canonicalJsonStringify(intent.priorOperation)
        && canonicalJsonStringify(operation) !== canonicalJsonStringify(intent.operation)) fail("duo-draft-authority-changed");
  }
  if (canonicalJsonStringify(continuity) !== canonicalJsonStringify(intent.prior)
    && canonicalJsonStringify(continuity) !== canonicalJsonStringify(nextContinuity)) fail("duo-publication-prior-changed");
  if (intent.kind === "duo" && !document.profiles.some((row) => row.profileId === capture.profileId)) fail("duo-profile-unregistered");
  return { intent, path, digest, document };
}

export function issueStoppedDuoPublicationRecovery(lease: InstallationLease, restore: RestoreAdmissionHandle): DuoPublicationRecoveryClaim {
  const authenticated = authenticateStoppedDuoPublication(lease, restore);
  const claim = Object.freeze({ profileId: authenticated.intent.capture.profileId });
  duoPublicationRecoveries.set(claim, { lease, restore, intent: authenticated.intent, path: authenticated.path, digest: authenticated.digest });
  return claim;
}

export function completeStoppedDuoPublicationRecovery(claim: DuoPublicationRecoveryClaim): { revision: number } {
  const issued = duoPublicationRecoveries.get(claim);
  if (issued === undefined) fail("duo-publication-recovery-unissued");
  duoPublicationRecoveries.delete(claim);
  const again = authenticateStoppedDuoPublication(issued.lease, issued.restore);
  if (again.path !== issued.path || again.digest !== issued.digest || canonicalJsonStringify(again.intent) !== canonicalJsonStringify(issued.intent)) fail("duo-publication-file-changed");
  const workspace = issued.lease.readInstallationContext().workspace;
  const control = join(workspace, CONTROL);
  const continuity = readStrict(join(control, "profile-registry.json"), ProfileContinuitySchema);
  if (issued.intent.kind === "draft-duo") settleDraftDuoPublication(control, issued.lease.locator, again.document, continuity, issued.intent);
  else settleDuoPublication(control, issued.lease.locator, again.document, continuity, issued.intent);
  if (lstatMaybe(join(control, "profile-publication.json")) !== undefined) fail("duo-publication-pending");
  return { revision: issued.intent.capture.next.revision };
}

export function acquireStoppedProfileControlUpgrade(workspacePath: string, restore: RestoreAdmissionHandle, heldLease?: InstallationLease): StoppedProfileControlUpgradeAdmission {
  const workspace = realpathSync(workspacePath);
  if (resolve(workspacePath) !== workspace) fail("profile-control-upgrade-workspace-invalid");
  assertRestoreHeld(workspace, restore);
  const ownsLease = heldLease === undefined;
  if (heldLease !== undefined) {
    assertInstallationLease(heldLease);
    if (heldLease.mode !== "exclusive") fail("profile-control-upgrade-runtime-active");
    const heldContext = heldLease.readInstallationContext();
    if (realpathSync(heldContext.workspace) !== workspace) fail("profile-control-upgrade-workspace-invalid");
  }
  const lease = heldLease ?? acquireInstallation(workspace, "exclusive"), locator = lease.locator, control = join(workspace, CONTROL);
  const markerPath = join(locator.stateRoot, "machine", "profile-registry-version.json"), controlPath = join(control, "profile-registry.json");
  const intentPath = join(control, "profile-control-upgrade.json"), backupDirectory = join(control, "profile-control-upgrades");
  const inventorySnapshots = new Set<ReturnType<typeof createReadonlyAuthoritySnapshot>>();
  const issuedInventoryClaims = new Set<StoppedControlProfileInventory>();
  const inventoryProofs = new Map<string, { claim: StoppedControlProfileInventory; proof: StoppedControlCredentialAttestation }>();
  const publicationProofs = (profiles: readonly z.infer<typeof ProfileRegistryRowSchema>[], consume: boolean): (() => void)[] => profiles.map(profile => {
    const entry = inventoryProofs.get(profile.profileId);
    if (entry === undefined) fail("profile-control-upgrade-inventory-required");
    return verifyStoppedControlCredentialAttestation(entry.proof, entry.claim, consume);
  });
  function held(): void {
    lease.assertHeld(); assertRestoreHeld(workspace, restore);
    if (!equalLocator(readLocator(control, workspace), locator)) fail("profile-control-upgrade-locator-changed");
    const processLockRoot = fixedLockRoot(workspace);
    if (RUNTIME_PROCESS_LOCK_NAMES.some(name => runtimeProcessLockIsActive(processLockRoot, name))) fail("profile-control-upgrade-runtime-active");
    const registry = readProfileEvidence(join(locator.stateRoot, "machine", "profiles.json"), ProfileRegistryDocumentSchema);
    for (const profile of registry.profiles) {
      const snapshot = observeRuntimeLockSnapshot({ processLockRoot,
        sourceDatabaseIdentity: authoritySourceDatabaseIdentity(join(locator.stateRoot, "profiles", profile.profileId, "state.db")) });
      if (Object.values(snapshot.processLocks).some(lock => lock.state !== "stopped")) fail("profile-control-upgrade-runtime-active");
    }
    const orphans = inspectRuntimeProcessOrphans(processLockRoot);
    if (orphans.staleServerRecords > 0 || orphans.staleWorkerRecords > 0) fail("profile-control-upgrade-process-custody-unproved");
    if (lstatMaybe(join(control, "profile-publication.json"))) fail("profile-control-upgrade-publication-pending");
  }
  function finish(receipt: z.infer<typeof ControlUpgradeReceiptSchema>, afterPublication: readonly (() => void)[]): void {
    held();
    const document = readProfileEvidence(join(locator.stateRoot, "machine", "profiles.json"), ProfileRegistryDocumentSchema);
    const initialDuo = document.profiles.map(row => ({ profileId: row.profileId, state: "never-initialized", revision: 0 }));
    if (canonicalJsonStringify(receipt.current.duo) !== canonicalJsonStringify(initialDuo)
      || receipt.installationId !== locator.installationId || canonicalJsonStringify(receipt.current) !== canonicalJsonStringify({ ...receipt.prior, schemaVersion: 2,
      duo: receipt.current.duo }) || receipt.current.duo.some(row => row.state !== "never-initialized")
      || canonicalJsonStringify(priorControlUpgradeEvidence(locator, receipt.prior)) !== canonicalJsonStringify(receipt.sourceEvidence)) fail("profile-control-upgrade-source-changed");
    const prefix = join(backupDirectory, receipt.operationId);
    privateDirectory(backupDirectory);
    const expectedNames = [`${receipt.operationId}.control.before.json`, `${receipt.operationId}.marker.before.json`,
      ...["control.stage", "marker.stage", "receipt.json"].filter(suffix => lstatMaybe(`${prefix}.${suffix}`)).map(suffix => `${receipt.operationId}.${suffix}`)];
    if (canonicalJsonStringify(readdirSync(backupDirectory).sort()) !== canonicalJsonStringify(expectedNames.sort())) fail("profile-control-upgrade-backup-membership");
    if (!sameControlUpgradeFile(`${prefix}.control.before.json`, receipt.controlBackup)
      || !sameControlUpgradeFile(`${prefix}.marker.before.json`, receipt.markerBackup)) fail("profile-control-upgrade-backup-changed");
    const backup = readProfileEvidence(`${prefix}.control.before.json`, PriorProfileContinuitySchema);
    readProfileEvidence(`${prefix}.marker.before.json`, z.strictObject({ schemaVersion: z.literal(2) }));
    if (canonicalJsonStringify(backup) !== canonicalJsonStringify(receipt.prior)) fail("profile-control-upgrade-backup-diverged");
    const stages = [[controlPath, `${prefix}.control.stage`, receipt.priorControl, receipt.controlStage],
      [markerPath, `${prefix}.marker.stage`, receipt.priorMarker, receipt.markerStage]] as const;
    for (const [path, stage, before, after] of stages) {
      if (lstatMaybe(stage)) {
        if (!sameControlUpgradeFile(path, before) || !sameControlUpgradeFile(stage, after)) fail("profile-control-upgrade-publication-uncertain");
      } else if (!sameControlUpgradeFile(path, after)) fail("profile-control-upgrade-publication-uncertain");
    }
    const stagedControl = lstatMaybe(`${prefix}.control.stage`) ? `${prefix}.control.stage` : controlPath;
    const stagedMarker = lstatMaybe(`${prefix}.marker.stage`) ? `${prefix}.marker.stage` : markerPath;
    if (canonicalJsonStringify(readProfileEvidence(stagedControl, ProfileContinuitySchema)) !== canonicalJsonStringify(receipt.current)) fail("profile-control-upgrade-stage-diverged");
    readProfileEvidence(stagedMarker, z.strictObject({ schemaVersion: z.literal(3) }));
    for (const [path, stage] of stages) if (lstatMaybe(stage)) { renameSync(stage, path); syncDir(dirname(path)); syncDir(backupDirectory); }
    if (!sameControlUpgradeFile(controlPath, receipt.controlStage) || !sameControlUpgradeFile(markerPath, receipt.markerStage)) fail("profile-control-upgrade-readback-failed");
    if (priorControlUpgradeEvidence(locator, receipt.prior) !== receipt.sourceEvidence) fail("profile-control-upgrade-source-changed");
    if (lstatMaybe(`${prefix}.receipt.json`)) {
      if (canonicalJsonStringify(readControlUpgradeReceipt(`${prefix}.receipt.json`)) !== canonicalJsonStringify(receipt)) fail("profile-control-upgrade-receipt-changed");
    } else atomicJson(`${prefix}.receipt.json`, receipt);
    unlinkSync(intentPath); syncDir(control);
    readMachineRegistry(control, locator, false);
    for (const revalidate of afterPublication) revalidate();
    held();
  }
  return Object.freeze({ installationId: locator.installationId,
    machineControlCurrent(): boolean {
      held();
      const observedMarker = readProfileEvidence(markerPath, z.strictObject({ schemaVersion: z.number().int() }));
      if (observedMarker.schemaVersion !== 2 && observedMarker.schemaVersion !== 3) fail("profile-control-upgrade-pending-conversion-unsupported");
      return observedMarker.schemaVersion === 3;
    },
    upgradeIntentPresent(): boolean {
      held();
      return lstatMaybe(intentPath) !== undefined;
    },
    registeredProfileIds(): readonly string[] {
      held();
      if (this.machineControlCurrent() && !this.upgradeIntentPresent()) return readMachineRegistry(control, locator, false).profiles.map((row) => row.profileId);
      const pending = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath).prior : undefined;
      return (pending ?? readProfileEvidence(controlPath, PriorProfileContinuitySchema)).erasures.map((row) => row.profileId);
    },
    profileInventory(profileId: string): StoppedControlProfileInventory {
      held();
      const pending = lstatMaybe(intentPath) ? readControlUpgradeReceipt(intentPath) : undefined;
      const prior = pending?.prior ?? readProfileEvidence(controlPath, PriorProfileContinuitySchema);
      if (pending === undefined) readProfileEvidence(markerPath, z.strictObject({ schemaVersion: z.literal(2) }));
      else if ((!sameControlUpgradeFile(controlPath, pending.priorControl) && !sameControlUpgradeFile(controlPath, pending.controlStage))
        || (!sameControlUpgradeFile(markerPath, pending.priorMarker) && !sameControlUpgradeFile(markerPath, pending.markerStage))) fail("profile-control-upgrade-publication-uncertain");
      if (!prior.erasures.some(row => row.profileId === z.uuid().parse(profileId))) fail("profile-control-upgrade-profile-unavailable");
      const evidence = priorControlUpgradeEvidence(locator, prior), controlIdentity = controlUpgradeFile(controlPath), markerIdentity = controlUpgradeFile(markerPath);
      const snapshot = createReadonlyAuthoritySnapshot(join(locator.stateRoot, "profiles", profileId, "state.db"));
      inventorySnapshots.add(snapshot);
      const revalidateSource = () => {
        held(); snapshot.assertUnchanged();
        if (priorControlUpgradeEvidence(locator, prior) !== evidence) fail("profile-control-upgrade-inventory-source-changed");
      };
      const assertHeld = () => {
        held(); snapshot.assertUnchanged();
        if (!sameControlUpgradeFile(controlPath, controlIdentity) || !sameControlUpgradeFile(markerPath, markerIdentity)) fail("profile-control-upgrade-inventory-expired");
        revalidateSource();
      };
      const binding = ProfileDatabaseBindingSchema.parse({ installationId: locator.installationId, profileId });
      const stateRoot = join(locator.stateRoot, "profiles", profileId), issued = Object.freeze({ profileId });
      const credential = prior.erasures.find(row => row.profileId === profileId);
      if (credential?.credentialKey === undefined) fail("profile-control-upgrade-credential-conversion-required");
      stoppedControlInventories.set(issued, Object.freeze({ binding: Object.freeze(binding), stateRoot, artifactRoot: join(stateRoot, "artifacts"), machineRoot: locator.stateRoot,
        key: credential.credentialKey, head: credential.head, locator: Object.freeze({ ...locator }), assertHeld, revalidateSource,
        readInstallationContext: () => { assertHeld(); return lease.readInstallationContext(); } }));
      assertHeld(); issuedInventoryClaims.add(issued);
      return issued;
    },
    recordProfileInventory(claim: StoppedControlProfileInventory, proof: StoppedControlCredentialAttestation): void {
      held();
      if (!issuedInventoryClaims.has(claim) || inventoryProofs.has(claim.profileId)) fail("profile-control-upgrade-attestation-owner-mismatch");
      verifyStoppedControlCredentialAttestation(proof, claim, false);
      inventoryProofs.set(claim.profileId, { claim, proof });
    },
    run(plan: boolean) {
      return mutex(control, () => {
        held();
        const registrations = readProfileEvidence(join(locator.stateRoot, "machine", "profiles.json"), ProfileRegistryDocumentSchema);
        const runtimeAccess = registrations.profiles.some(row => row.registration.onboardingCompletion === undefined)
          ? "owner-claim-required" as const : "unchanged" as const;
        if (lstatMaybe(intentPath)) {
          if (plan) fail("profile-control-upgrade-recovery-required");
          const receipt = readControlUpgradeReceipt(intentPath);
          const registry = readProfileEvidence(join(locator.stateRoot, "machine", "profiles.json"), ProfileRegistryDocumentSchema);
          finish(receipt, publicationProofs(registry.profiles, true));
          return { state: "upgraded" as const, runtimeAccess, profileCount: receipt.current.duo.length, receiptId: receipt.operationId };
        }
        const observedMarker = readProfileEvidence(markerPath, z.strictObject({ schemaVersion: z.number().int() }));
        if (observedMarker.schemaVersion !== 2 && observedMarker.schemaVersion !== 3) fail("profile-control-upgrade-pending-conversion-unsupported");
        const marker = { schemaVersion: observedMarker.schemaVersion };
        if (marker.schemaVersion === 3) return { state: "current" as const, runtimeAccess, profileCount: readMachineRegistry(control, locator, false).profiles.length };
        const prior = readProfileEvidence(controlPath, PriorProfileContinuitySchema), sourceEvidence = priorControlUpgradeEvidence(locator, prior);
        const registry = readProfileEvidence(join(locator.stateRoot, "machine", "profiles.json"), ProfileRegistryDocumentSchema);
        const current = ProfileContinuitySchema.parse({ ...prior, schemaVersion: 2,
          duo: registry.profiles.map(row => ({ profileId: row.profileId, state: "never-initialized", revision: 0 })) });
        if (lstatMaybe(backupDirectory)) fail("profile-control-upgrade-orphan-or-rollback");
        if (Buffer.byteLength(JSON.stringify({ prior, current, sourceEvidence })) + 4096 > 16 * 1024 * 1024) fail("profile-control-upgrade-evidence-too-large");
        const afterPublication = publicationProofs(registry.profiles, !plan);
        if (plan) return { state: "planned" as const, runtimeAccess, profileCount: registry.profiles.length };
        mkdirSync(backupDirectory, { mode: 0o700 }); syncDir(control);
        privateDirectory(backupDirectory);
        const operationId = randomUUID(), prefix = join(backupDirectory, operationId), priorControl = controlUpgradeFile(controlPath), priorMarker = controlUpgradeFile(markerPath);
        const controlBytes = readPrivateFile(controlPath, { label: "lock", maxBytes: 1_048_576 }), markerBytes = readPrivateFile(markerPath, { label: "lock", maxBytes: 1_048_576 });
        if (controlBytes === undefined || markerBytes === undefined) fail("profile-control-upgrade-evidence-missing");
        writePrivateStage(`${prefix}.control.before.json`, controlBytes.bytes); writePrivateStage(`${prefix}.marker.before.json`, markerBytes.bytes);
        if (controlUpgradeFile(`${prefix}.control.before.json`).digest !== priorControl.digest || controlUpgradeFile(`${prefix}.marker.before.json`).digest !== priorMarker.digest) fail("profile-control-upgrade-backup-diverged");
        writePrivateStage(`${prefix}.control.stage`, Buffer.from(JSON.stringify(current)));
        writePrivateStage(`${prefix}.marker.stage`, Buffer.from(JSON.stringify({ schemaVersion: 3 })));
        syncDir(backupDirectory);
        const receipt = ControlUpgradeReceiptSchema.parse({ schemaVersion: 1, operationId, installationId: locator.installationId, prior, current, priorControl, priorMarker,
          controlBackup: controlUpgradeFile(`${prefix}.control.before.json`), markerBackup: controlUpgradeFile(`${prefix}.marker.before.json`),
          controlStage: controlUpgradeFile(`${prefix}.control.stage`), markerStage: controlUpgradeFile(`${prefix}.marker.stage`), sourceEvidence });
        if (!sameControlUpgradeFile(controlPath, priorControl) || !sameControlUpgradeFile(markerPath, priorMarker)
          || priorControlUpgradeEvidence(locator, prior) !== sourceEvidence) fail("profile-control-upgrade-source-changed");
        atomicJson(intentPath, receipt); finish(receipt, afterPublication);
        return { state: "upgraded" as const, runtimeAccess, profileCount: registry.profiles.length, receiptId: operationId };
      });
    },     release() {
      for (const snapshot of inventorySnapshots) {
        try { snapshot.dispose(); }
        catch (error) {
          throw error instanceof AuthoritySourceClosureUnprovedError ? error : retainAuthoritySourceClosure([error], { snapshot });
        }
        inventorySnapshots.delete(snapshot);
      }
      for (const entry of inventoryProofs.values()) releaseStoppedControlCredentialAttestation(entry.proof);
      inventoryProofs.clear(); issuedInventoryClaims.clear();
      if (ownsLease) lease.release();
    },
  });
}
