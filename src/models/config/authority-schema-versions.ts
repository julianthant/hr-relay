/**
 * One home for authority schema versions. A schema bump edits
 * CURRENT_AUTHORITY_SCHEMA_VERSION and appends the previous current version to
 * UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS. The other lists are derived here.
 */
export const AUTHORITY_APPLICATION_ID = 1_217_249_861;
export const CURRENT_AUTHORITY_SCHEMA_VERSION = 48;

/** Stopped versions a database may be upgraded from. */
export const UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47] as const;
/** Stopped schemas: those too old to upgrade (1 through 7) and every upgradeable schema. */
export const SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS = [1, 2, 3, 4, 5, 6, 7, ...UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS] as const;
/** Versions startup, restore and admission open: every upgradeable version plus the current one. */
export const OPENABLE_AUTHORITY_SCHEMA_VERSIONS = [...UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS, CURRENT_AUTHORITY_SCHEMA_VERSION] as const;

const [
  unbound1, unbound2, unbound3, unbound4, unbound5, unbound6,
  ...boundStoppedAuthoritySchemaVersions
] = SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS;
/** Schemas 1 through 6, which have no profile binding. */
export const UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS = [unbound1, unbound2, unbound3, unbound4, unbound5, unbound6] as const;
/** Bound profile schemas, including 7, which is bound but not upgradeable. */
export const BOUND_AUTHORITY_SCHEMA_VERSIONS = [...boundStoppedAuthoritySchemaVersions, CURRENT_AUTHORITY_SCHEMA_VERSION] as const;
const [
  /* 8 */ , /* 9 */ , /* 10 */ , /* 11 */ ,
  /* 12 */ , /* 13 */ , /* 14 */ , /* 15 */ ,
  /* 16 */ , /* 17 */ , /* 18 */ , /* 19 */ ,
  ...evidenceStoppedAuthoritySchemaVersions
] = UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS;
/** Evidence-schema upgrade journal versions: upgradeable schemas from 20 through the current schema. */
export const EVIDENCE_SCHEMA_UPGRADE_VERSIONS = [...evidenceStoppedAuthoritySchemaVersions, CURRENT_AUTHORITY_SCHEMA_VERSION] as const;
/** Every schema that has existed, including the current one. */
export const RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS = [...SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS, CURRENT_AUTHORITY_SCHEMA_VERSION] as const;
/** A fresh baseline (0) or any recognized schema. */
export const BASELINE_FROM_AUTHORITY_SCHEMA_VERSIONS = [0, ...RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS] as const;
const flatBackupSchemaVersion = UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS[5];
/** Flat-backup schema 6, or any openable schema. Schema 7 stays refused. */
export const MAINTENANCE_AUTHORITY_SCHEMA_VERSIONS = [flatBackupSchemaVersion, ...OPENABLE_AUTHORITY_SCHEMA_VERSIONS] as const;

export type SupportedStoppedAuthoritySchemaVersion = (typeof SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS)[number];
export type UpgradeableAuthoritySchemaVersion = (typeof UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS)[number];
export type OpenableAuthoritySchemaVersion = (typeof OPENABLE_AUTHORITY_SCHEMA_VERSIONS)[number];
export type UnboundPredecessorAuthoritySchemaVersion = (typeof UNBOUND_PREDECESSOR_AUTHORITY_SCHEMA_VERSIONS)[number];
export type BoundAuthoritySchemaVersion = (typeof BOUND_AUTHORITY_SCHEMA_VERSIONS)[number];
export type EvidenceSchemaAuthorityVersion = (typeof EVIDENCE_SCHEMA_UPGRADE_VERSIONS)[number];
export type RecognizedAuthoritySchemaVersion = (typeof RECOGNIZED_AUTHORITY_SCHEMA_VERSIONS)[number];
export type BaselineFromAuthoritySchemaVersion = (typeof BASELINE_FROM_AUTHORITY_SCHEMA_VERSIONS)[number];
export type MaintenanceAuthoritySchemaVersion = (typeof MAINTENANCE_AUTHORITY_SCHEMA_VERSIONS)[number];

export function isSupportedStoppedAuthoritySchemaVersion(version: number): version is SupportedStoppedAuthoritySchemaVersion {
  return SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS.some(supported => supported === version);
}

export function isUpgradeableAuthoritySchemaVersion(version: number): version is UpgradeableAuthoritySchemaVersion {
  return UPGRADEABLE_AUTHORITY_SCHEMA_VERSIONS.some(supported => supported === version);
}

export function isOpenableAuthoritySchemaVersion(version: number): version is OpenableAuthoritySchemaVersion {
  return OPENABLE_AUTHORITY_SCHEMA_VERSIONS.some(supported => supported === version);
}

export function isCurrentAuthoritySchemaVersion(version: number): version is typeof CURRENT_AUTHORITY_SCHEMA_VERSION {
  return version === CURRENT_AUTHORITY_SCHEMA_VERSION;
}
