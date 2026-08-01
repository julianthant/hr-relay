export {
  AuthorityDatabase,
  AuthorityDatabaseOptionsSchema,
  AuthorityMetaSchema,
  AuthoritySchemaInspectionSchema,
  ImmutableInsertDispositionSchema,
  type AuthorityRepositories,
  type AuthorityWriteCommitHooks,
  type ProjectionRepositories,
} from "./authority-database.js";
export {
  ArtifactOutboxStorageRecordSchema,
  OpaqueAuthorityRecordSchema,
  ProjectionStorageRecordSchema,
  SqliteStorageRecordIdSchema,
  VersionPlanStorageRecordSchema,
} from "./storage-records.js";
export {
  AuthorityBackupService,
  AuthorityBackupServiceOptionsSchema,
  verifyBackupManifestAtPath,
  type VerifiedBackup,
} from "./backup-service.js";
export {
  AuthorityBootStore,
  AuthorityMutationUnavailableError,
  storageHealthCauseFromError,
} from "./authority-boot.js";
export { AuthorityHealthPreflightRunner } from "./authority-health-runner.js";
export {
  OfflineAuthorityRestoreService,
  OfflineRestoreOptionsSchema,
  type OfflineRestoreFileOperations,
} from "./offline-restore.js";
export {
  AuthorityBackupManifestSchema,
  AuthorityBackupRequestSchema,
  AuthorityBackupRunReportSchema,
  AuthorityBootReportSchema,
  AuthorityCopyInspectionSchema,
  AuthorityInvariantResultSchema,
  AuthorityPendingCountsSchema,
  BackupHealthSchema,
  BackupVerificationSchema,
  OfflineRestoreReportSchema,
  OfflineRestoreRequestSchema,
  RestoreCandidateSchema,
  StoppedSystemProofSchema,
  StorageDoctorReportSchema,
  StorageHealthCauseSchema,
  type AuthorityBackupManifest,
  type AuthorityBackupRequest,
  type AuthorityBackupRunReport,
  type AuthorityBootReport,
  type AuthorityCopyInspection,
  type AuthorityPendingCounts,
  type OfflineRestoreReport,
  type RestoreCandidate,
  type StoppedSystemProof,
  type StorageDoctorReport,
  type StorageHealthCause,
} from "./recovery-contracts.js";
export {
  doctorAuthorityStorage,
  StorageDoctorOptionsSchema,
} from "./storage-doctor.js";
export {
  AtomicWriteCommitInputSchema,
  AtomicWriteCommitReportSchema,
  AtomicWriteCommitStorageStepSchema,
  PermanentWriteResolutionSchema,
  WriteFenceInputSchema,
  type AtomicWriteCommitInput,
  type AtomicWriteCommitReport,
  type AtomicWriteCommitStorageStep,
  type PermanentWriteResolution,
  type WriteFenceInput,
} from "./write-commit-contracts.js";
