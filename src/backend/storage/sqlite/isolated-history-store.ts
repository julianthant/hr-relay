import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { lstatSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { IsoInstant } from "../../../rules/identity/ids.js";
import type { ProfileDatabaseBinding } from "../../../models/profiles/profile.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, OCR_SEARCH_TERMS_COLUMN_SQL } from "./migrations.js";
import { openReadOnlyDatabase } from "./readonly-authority-snapshot.js";
import { runRecordColumns, runRecordFromRow } from "./run-record-row.js";
import { backfillRunSearchOcrSubjects } from "./run-search-index.js";
import { privatePathRejects } from "../private-path.js";

export function historyArchivePath(stateRoot: string): string {
  const directory = join(stateRoot, "files");
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (stat !== undefined && (!stat.isDirectory() || realpathSync(directory) !== directory || privatePathRejects(directory, stat, "group-write"))) {
    throw new Error("isolated-history-directory-unsafe");
  }
  return join(directory, "imported-history.sqlite");
}

const commandFamilies = "family IN ('run-lifecycle','run','start','bulk-parent','bulk-child','failure-resolution','ocr-review','gate','workflow-batch') OR (family='worker-browser' AND json_extract(request_json,'$.type')='check-parked-write')";
const historyTables = {
  runs: "", run_batches: "", deleted_runs: "", run_delegations: "", delegation_dependencies: "",
  run_checkpoints: "", gate_results: "", run_results: "", run_failures: "", run_receipts: "",
  write_intents: "", write_attempts: "", timeline_events: "", notifications: "", run_search: "",
  diagnostic_snapshots: "", diagnostic_files: "", dryrun_results: "", ocr_approved_snapshots: "", ocr_review_revisions: "",
  commands: ` WHERE ${commandFamilies}`,
  command_audits: ` WHERE command_id IN (SELECT id FROM commands WHERE ${commandFamilies})`,
  run_references: " WHERE table_name IN ('commands','command_audits','run_delegations','delegation_dependencies','run_results','run_receipts')",
  workbook_operations: " WHERE json_extract(request_json,'$.source.kind') IN ('run','run-reference') AND receipt_json IS NOT NULL",
} as const;
const tables = Object.entries(historyTables);
const headers = z.strictObject({ format: z.literal(1), schema_version: z.literal(CURRENT_AUTHORITY_SCHEMA_VERSION),
  installation_id: z.uuid(), profile_id: z.uuid() });
const Column = z.string().regex(/^[a-z_]+$/u);
const validatedVersion = new WeakMap<DatabaseSync, number>();

/** An index hint applies to a native table. The planner selects each side's index independently on the history union. */
export function runIndex(database: DatabaseSync, name: "runs_day_idx" | "runs_workflow_day_idx" | "runs_parent_idx" | "runs_nonterminal_idx"): string {
  return validatedVersion.has(database) ? "" : `INDEXED BY ${name}`;
}

export function writeHistoryArchive(source: DatabaseSync, path: string, binding: ProfileDatabaseBinding, at: IsoInstant) {
  const archive = new DatabaseSync(path);
  try {
    archive.exec("BEGIN");
    archive.exec("CREATE TABLE history_header(format INTEGER, schema_version INTEGER, installation_id TEXT, profile_id TEXT)");
    archive.prepare("INSERT INTO history_header VALUES(1,?,?,?)").run(CURRENT_AUTHORITY_SCHEMA_VERSION, binding.installationId, binding.profileId);
    const counts: Record<string, number> = {};
    for (const [name, where] of tables) {
      const select = source.prepare(`SELECT * FROM ${name}${where}`);
      const columns = select.columns().map(column => Column.parse(column.name));
      archive.exec(`CREATE TABLE ${name} (${columns.join(",")})`);
      const insert = archive.prepare(`INSERT INTO ${name} VALUES(${columns.map(() => "?").join(",")})`);
      let count = 0;
      for (let row of select.iterate()) {
        if (name === "runs" && row.state !== "terminal") {
          const record = { ...runRecordFromRow(row) };
          delete record.cancelRequested;
          delete record.pause;
          row = runRecordColumns({ ...record, updatedAt: at, lifecycle: { state: "terminal", outcome: "discarded",
            endedAt: at, errorSummary: "Closed when imported as isolated history" } });
        }
        insert.run(...columns.map(key => row[key]));
        count++;
      }
      const key = columns.includes("id") ? "id" : columns.includes("run_id") ? "run_id" : columns[0];
      archive.exec(`CREATE INDEX ${name}_lookup ON ${name}(${key})`);
      if (columns.includes("run_id") && key !== "run_id") archive.exec(`CREATE INDEX ${name}_owner ON ${name}(run_id)`);
      counts[name] = count;
    }
    archive.exec("UPDATE run_search SET state='discarded' WHERE run_id IN (SELECT id FROM runs WHERE outcome='discarded') AND state NOT IN ('done','failed','cancelled','discarded','interrupted','superseded')");
    archive.exec("COMMIT");
    return counts;
  } finally { archive.close(); }
}

/** Refuse ambiguous identities before replacing the last usable archive, and after local commits while serving it. */
function checkIdentities(database: DatabaseSync): void {
  for (const [table] of tables) {
    const hasId = database.prepare(`SELECT * FROM history.${table} LIMIT 0`).columns().some(column => column.name === "id");
    if (hasId && database.prepare(`SELECT 1 FROM history.${table} JOIN main.${table} USING(id) LIMIT 1`).get()) {
      throw new Error(`isolated-history-local-id-collision: ${table}`);
    }
  }
  if (database.prepare(`SELECT run_id FROM history.deleted_runs INTERSECT SELECT run_id FROM main.deleted_runs`).get()
    || database.prepare("SELECT 1 FROM history.deleted_runs h JOIN main.runs l ON l.id=h.run_id LIMIT 1").get()
    || database.prepare("SELECT 1 FROM history.runs h JOIN main.deleted_runs l ON l.run_id=h.id LIMIT 1").get()) {
    throw new Error("isolated-history-local-id-collision: deleted_runs");
  }
  if (database.prepare(`SELECT 1 FROM history.run_checkpoints JOIN main.run_checkpoints
    USING(workflow,item_id,node_id,attempt,claim_generation) LIMIT 1`).get()) {
    throw new Error("isolated-history-local-checkpoint-collision");
  }
}

export function validateHistoryRead(database: DatabaseSync, version: number): void {
  if (validatedVersion.get(database) === version) return;
  checkIdentities(database);
  validatedVersion.set(database, version);
}

export function checkStagedHistory(localPath: string, archivePath: string, binding: ProfileDatabaseBinding): void {
  const local = openReadOnlyDatabase(localPath, 5000);
  try {
    attach(local, archivePath, binding);
    checkIdentities(local);
  } finally { local.close(); }
}

function attach(database: DatabaseSync, path: string, binding: ProfileDatabaseBinding) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || privatePathRejects(path, stat, "private")) throw new Error("isolated-history-unsafe");
  upgradeHistoryArchive(path, binding);
  const url = pathToFileURL(path);
  url.search = "mode=ro&immutable=1";
  database.prepare("ATTACH DATABASE ? AS history").run(url.href);
  const header = headers.parse(database.prepare("SELECT * FROM history.history_header").get());
  if (header.installation_id !== binding.installationId || header.profile_id !== binding.profileId) throw new Error("isolated-history-binding-mismatch");
}

/** Each step lifts an archive written at its key's schema to the next one; the archive keeps every row it imported. */
const ARCHIVE_UPGRADES: Readonly<Record<number, (archive: DatabaseSync) => void>> = {
  39: archive => archive.exec(`ALTER TABLE delegation_dependencies ADD COLUMN parent_run_id;
    UPDATE delegation_dependencies SET parent_run_id=json_extract(payload_json,'$.parentRunId')`),
  40: archive => {
    archive.exec(OCR_SEARCH_TERMS_COLUMN_SQL);
    backfillRunSearchOcrSubjects(archive);
  },
};
const ArchiveVersion = z.object({ schema_version: z.number().int(), installation_id: z.string(), profile_id: z.string() });

/** Brings an archive an older build wrote up to the current schema in place, in one transaction. */
function upgradeHistoryArchive(path: string, binding: ProfileDatabaseBinding): void {
  const probe = new DatabaseSync(path, { readOnly: true });
  let header: z.infer<typeof ArchiveVersion>;
  try { header = ArchiveVersion.parse(probe.prepare("SELECT schema_version,installation_id,profile_id FROM history_header").get()); } finally { probe.close(); }
  if (header.schema_version >= CURRENT_AUTHORITY_SCHEMA_VERSION) return;
  if (header.installation_id !== binding.installationId || header.profile_id !== binding.profileId) throw new Error("isolated-history-binding-mismatch");
  let version: number;
  const archive = new DatabaseSync(path);
  try {
    archive.exec("BEGIN IMMEDIATE");
    try {
      for (version = ArchiveVersion.parse(archive.prepare("SELECT schema_version,installation_id,profile_id FROM history_header").get()).schema_version;
        version < CURRENT_AUTHORITY_SCHEMA_VERSION; version += 1) {
        const step = ARCHIVE_UPGRADES[version];
        if (step === undefined) throw new Error(`isolated-history-schema-unsupported: ${String(version)}`);
        step(archive);
      }
      archive.prepare("UPDATE history_header SET schema_version=?").run(version);
      archive.exec("COMMIT");
    } catch (error) { archive.exec("ROLLBACK"); throw error; }
  } finally { archive.close(); }
}

export function attachHistoryArchive(database: DatabaseSync, path: string, binding: ProfileDatabaseBinding) {
  attach(database, path, binding);
  const { offset } = z.strictObject({ offset: z.number().int().nonnegative() }).parse(
    database.prepare("SELECT coalesce(max(cursor),0) AS offset FROM history.timeline_events").get());
  for (const [name] of tables) {
    const columns = database.prepare(`SELECT * FROM main.${name} LIMIT 0`).columns().map(column => Column.parse(column.name));
    const selection = columns.map(key => {
      if (name === "timeline_events" && key === "cursor") return `cursor+${String(offset)} AS cursor`;
      if (name === "timeline_events" && key === "payload_json") return `json_set(payload_json,'$.cursor',cursor+${String(offset)}) AS payload_json`;
      return key;
    });
    database.exec(`CREATE TEMP VIEW ${name} AS SELECT ${selection.join(",")} FROM main.${name} UNION ALL SELECT ${columns.join(",")} FROM history.${name}`);
  }
  checkIdentities(database);
  validatedVersion.set(database, -1);
  return offset;
}
