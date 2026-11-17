import type { AuthorityEvidenceSchemaUpgradeRecord, AuthorityForwardUpgradeRecord, AuthorityUpgradeRecord } from "../../models/config/authority.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS } from "../../models/config/authority-schema-versions.js";
import type { EvidenceSchemaConversion } from "../../models/storage/evidence-schema-admission.js";

/** One authority store's upgrade journal, derived from its append-only `database_upgrades` rows. */
export type AuthorityUpgradeJournalState =
  | Readonly<{ journal: "empty" }>
  | Readonly<{ journal: "baseline"; schemaVersion: number }>
  | Readonly<{
    journal: "settled";
    /** The last row's target schema. */
    schemaVersion: number;
    /** The latest forward upgrade, which carries any startup logout; a later evidence row never hides it. */
    latestForward: AuthorityForwardUpgradeRecord | undefined;
    evidence: readonly AuthorityEvidenceSchemaUpgradeRecord[];
  }>;

export type AuthorityUpgradeJournalEvent =
  | Readonly<{ type: "initialize" }>
  | Readonly<{ type: "forward-upgrade"; from: number }>
  | Readonly<{ type: "convert-evidence"; id: EvidenceSchemaConversion["id"] }>;

export type AuthorityUpgradeRefusal = "already-initialized" | "not-upgradeable" | "evidence-schema-conversion-duplicate";

/** The journal only appends: a legal event names the phase of the row it appends. */
export type AuthorityUpgradeTransition =
  | Readonly<{ append: "baseline" | "settled" }>
  | Readonly<{ refused: AuthorityUpgradeRefusal }>;

const isEvidence = (record: AuthorityUpgradeRecord): record is AuthorityEvidenceSchemaUpgradeRecord => "evidenceSchemas" in record;

export function authorityUpgradeJournalOf(records: readonly AuthorityUpgradeRecord[]): AuthorityUpgradeJournalState {
  const last = records.at(-1);
  if (last === undefined) return { journal: "empty" };
  if (records.every(record => record.phase === "baseline")) return { journal: "baseline", schemaVersion: last.toSchemaVersion };
  const evidence = records.filter(isEvidence);
  const latestForward = records.findLast((record): record is AuthorityForwardUpgradeRecord => record.phase === "settled" && !isEvidence(record));
  return { journal: "settled", schemaVersion: last.toSchemaVersion, latestForward, evidence };
}

/** Every supported stopped schema, including the unbound 1 through 7, upgrades straight to the current schema. */
const isUpgradeable = (version: number) => SUPPORTED_STOPPED_AUTHORITY_SCHEMA_VERSIONS.some(stopped => stopped === version);

/**
 * Which row an event appends. A forward upgrade's source is the store's stopped schema, which the writer reads, whatever
 * the journal holds; evidence conversion runs only at the current schema and records each conversion once.
 */
export function authorityUpgradeTransition(state: AuthorityUpgradeJournalState, event: AuthorityUpgradeJournalEvent): AuthorityUpgradeTransition {
  if (event.type === "initialize") return state.journal === "empty" ? { append: "baseline" } : { refused: "already-initialized" };
  // Stopped stores from before the baseline row have an empty journal and still upgrade.
  if (event.type === "forward-upgrade") return isUpgradeable(event.from) ? { append: "settled" } : { refused: "not-upgradeable" };
  if (state.journal === "empty" || state.schemaVersion !== CURRENT_AUTHORITY_SCHEMA_VERSION) return { refused: "not-upgradeable" };
  if (state.journal === "settled" && state.evidence.some(record => record.evidenceSchemas.id === event.id)) return { refused: "evidence-schema-conversion-duplicate" };
  return { append: "settled" };
}
