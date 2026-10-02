import { readFileSync, existsSync, mkdirSync, writeFileSync, lstatSync, unlinkSync, openSync, closeSync, fsyncSync, constants } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { backup as sqliteBackup, DatabaseSync } from "node:sqlite";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../admission/admission.js";
import { ArchiveReportSchema, ArchiveFileReferenceSchema, ArchiveQuerySchema, ArchiveGroupQuerySchema,
  type ArchiveQuery, type ArchiveGroupQuery, type ArchiveReport } from "../../../domain/archive/report.js";
import { DeletedRunRecordSchema, type DeletedRunRecord } from "../../../domain/run/deleted-run.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { attestPublishedArchiveReport } from "./archive-records.js";
import { z } from "zod";

export const ARCHIVE_APPLICATION_ID = 1213350482;
export const ARCHIVE_SCHEMA_VERSION = 2;
const ARCHIVE_V1_DDL = `CREATE TABLE archive_records (
 run_id TEXT PRIMARY KEY, transfer_id TEXT NOT NULL UNIQUE, workflow TEXT NOT NULL,
 title TEXT NOT NULL, descriptor_version TEXT NOT NULL, outcome TEXT NOT NULL,
 completed_at TEXT NOT NULL, captured_at TEXT NOT NULL, digest TEXT NOT NULL,
 report_json TEXT NOT NULL CHECK(json_valid(report_json)),
 state TEXT NOT NULL CHECK(state IN ('captured','verified','published'))
) STRICT;
CREATE TABLE archive_deletions (run_id TEXT PRIMARY KEY, digest TEXT NOT NULL,
 receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)), files_json TEXT NOT NULL CHECK(json_valid(files_json)),
 state TEXT NOT NULL CHECK(state IN ('deleting','deleted'))) STRICT;
CREATE INDEX archive_records_workflow_idx ON archive_records(workflow,completed_at,run_id);
CREATE INDEX archive_records_title_idx ON archive_records(title,run_id);
CREATE INDEX archive_records_version_idx ON archive_records(workflow,descriptor_version,outcome,captured_at,run_id);
CREATE TRIGGER archive_records_immutable BEFORE UPDATE ON archive_records
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.transfer_id IS NOT OLD.transfer_id OR NEW.digest IS NOT OLD.digest
 OR NEW.report_json IS NOT OLD.report_json OR NEW.workflow IS NOT OLD.workflow OR NEW.title IS NOT OLD.title
 OR NEW.descriptor_version IS NOT OLD.descriptor_version OR NEW.outcome IS NOT OLD.outcome
 OR NEW.completed_at IS NOT OLD.completed_at OR NEW.captured_at IS NOT OLD.captured_at
 OR NOT ((OLD.state='captured' AND NEW.state='verified') OR (OLD.state='verified' AND NEW.state='published'))
BEGIN SELECT RAISE(ABORT,'archive-report-immutable'); END;
CREATE TRIGGER archive_records_no_replace BEFORE INSERT ON archive_records
WHEN EXISTS(SELECT 1 FROM archive_records WHERE run_id=NEW.run_id OR transfer_id=NEW.transfer_id)
 OR EXISTS(SELECT 1 FROM archive_deletions WHERE run_id=NEW.run_id)
BEGIN SELECT RAISE(ABORT,'archive-report-identity-reserved'); END;
CREATE TRIGGER archive_records_delete_receipt BEFORE DELETE ON archive_records
WHEN NOT EXISTS(SELECT 1 FROM archive_deletions WHERE run_id=OLD.run_id AND digest=OLD.digest AND state='deleting')
BEGIN SELECT RAISE(ABORT,'archive-delete-receipt-required'); END;
CREATE TRIGGER archive_deletions_immutable BEFORE UPDATE ON archive_deletions
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.digest IS NOT OLD.digest OR NEW.receipt_json IS NOT OLD.receipt_json
 OR NEW.files_json IS NOT OLD.files_json OR NOT(OLD.state='deleting' AND NEW.state='deleted')
BEGIN SELECT RAISE(ABORT,'archive-deletion-immutable'); END;
CREATE TRIGGER archive_deletions_retained BEFORE DELETE ON archive_deletions
BEGIN SELECT RAISE(ABORT,'archive-deletion-retained'); END;`;
const ARCHIVE_V2_INDEX_DDL = `CREATE INDEX archive_records_dashboard_runtime_version_idx ON archive_records(
 workflow, json_extract(report_json,'$.content.runtimeVersion.dashboard.major'),
 json_extract(report_json,'$.content.runtimeVersion.dashboard.minor'), completed_at, run_id
) WHERE state='published';
CREATE INDEX archive_records_workflow_runtime_version_idx ON archive_records(
 workflow, json_extract(report_json,'$.content.runtimeVersion.workflow.major'),
 json_extract(report_json,'$.content.runtimeVersion.workflow.minor'), completed_at, run_id
) WHERE state='published';
CREATE INDEX archive_records_runtime_version_state_idx ON archive_records(
 workflow, json_extract(report_json,'$.content.runtimeVersion.state'), completed_at, run_id
) WHERE state='published';`;
const ARCHIVE_DDL = `${ARCHIVE_V1_DDL}\n${ARCHIVE_V2_INDEX_DDL}`;
const RowSchema = z.strictObject({ run_id:z.string(), transfer_id:z.string(), workflow:z.string(),title:z.string(),descriptor_version:z.string(),outcome:z.string(),completed_at:z.string(),captured_at:z.string(),report_json:z.string(),digest:z.string(),state:z.enum(["captured","verified","published"]) });
const DeletionRowSchema = z.strictObject({run_id:z.string(),digest:z.string(),receipt_json:z.string(),files_json:z.string(),state:z.enum(["deleting","deleted"])});
const SchemaRow = z.strictObject({type:z.string(),name:z.string(),tbl_name:z.string(),sql:z.string()});
function schemaRows(database: DatabaseSync) { return database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all().map(row=>SchemaRow.parse(row)); }
const expectedSchemas = new Map<number, string>();
function archiveSchemaIdentity(version: 1 | 2): string {
  const cached = expectedSchemas.get(version);
  if (cached !== undefined) return cached;
  const reference = new DatabaseSync(":memory:");
  try {
    reference.exec(version === 1 ? ARCHIVE_V1_DDL : ARCHIVE_DDL);
    const identity = canonicalJsonStringify(schemaRows(reference));
    expectedSchemas.set(version, identity);
    return identity;
  }
  finally { reference.close(); }
}
function syncPath(path:string) { const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{fsyncSync(fd);}finally{closeSync(fd);} }
function fileBytes(path:string): Buffer {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { return readFileSync(fd); } finally { closeSync(fd); }
}
/** Independent archive authority. Source capture and visible publication are separate durable states. */
export class ArchiveDatabase {
  readonly #database: DatabaseSync;
  readonly #readOnly: boolean;
  #schemaVersion: 1 | 2;
  get schemaVersion(): 1 | 2 { return this.#schemaVersion; }
  #memoryFiles: Map<string, Buffer> | undefined;
  constructor(admission: RuntimeAdmission, readonly path: string, options: Readonly<{readOnly?:boolean; validation?:"all"|"selected"}> = {}) {
    requireRuntimeAdmission(admission).assertArchiveDatabase(path, options.readOnly === true ? "read-only" : "read-write");
    const existed=existsSync(path); this.#readOnly=options.readOnly===true;
    if(options.validation==="selected"&&!this.#readOnly)throw new Error("archive-selected-validation-requires-read-only");
    if ((!existed && this.#readOnly) || (existed && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink() || lstatSync(path).size===0))) throw new Error("archive-database-invalid-path");
    this.#database=new DatabaseSync(path,{readOnly:this.#readOnly,enableForeignKeyConstraints:true,enableDoubleQuotedStringLiterals:false,allowExtension:false,timeout:5000,defensive:true});
    try {
      if (!existed) { this.#database.exec(`BEGIN IMMEDIATE; PRAGMA application_id=${String(ARCHIVE_APPLICATION_ID)}; PRAGMA user_version=${String(ARCHIVE_SCHEMA_VERSION)}; ${ARCHIVE_DDL} COMMIT;`); }
      const app=z.strictObject({application_id:z.literal(ARCHIVE_APPLICATION_ID)}).safeParse(this.#database.prepare("PRAGMA application_id").get());
      const version=z.strictObject({user_version:z.union([z.literal(1),z.literal(2)])}).safeParse(this.#database.prepare("PRAGMA user_version").get());
      if (!app.success || !version.success || canonicalJsonStringify(schemaRows(this.#database))!==archiveSchemaIdentity(version.data.user_version)) throw new Error("archive-database-identity-mismatch");
      this.#schemaVersion = version.data.user_version;
      const check=z.strictObject({integrity_check:z.literal("ok")}).safeParse(this.#database.prepare("PRAGMA integrity_check").get());
      if(!check.success)throw new Error("archive-database-integrity-failed");
      if(!this.#readOnly)this.#database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
      // Lifecycle admission validates all custody. Bounded report queries validate each selected
      // immutable report in read()/verifiedReport(), after SQL membership selection.
      if(options.validation!=="selected") {
        for(const raw of this.#database.prepare("SELECT run_id FROM archive_records").all())this.read(z.strictObject({run_id:z.string()}).parse(raw).run_id);
        for(const raw of this.#database.prepare("SELECT * FROM archive_deletions").all())this.parseDeletion(raw);
      }
    } catch(error) {this.#database.close();throw error;}
  }
  /** Called only by the stopped, backed-up storage upgrade. Ordinary opens retain schema 1. */
  static upgradeStopped(admission: RuntimeAdmission, path: string): void {
    if (!existsSync(path)) throw new Error("archive-database-missing");
    const archive = new ArchiveDatabase(admission, path);
    try {
      if (archive.schemaVersion === 2) return;
      archive.#database.exec("BEGIN EXCLUSIVE");
      try {
        archive.#database.exec(`${ARCHIVE_V2_INDEX_DDL} PRAGMA user_version=2`);
        if (canonicalJsonStringify(schemaRows(archive.#database)) !== archiveSchemaIdentity(2)) throw new Error("archive-upgrade-schema-mismatch");
        archive.#database.exec("COMMIT");
        archive.#schemaVersion = 2;
      } catch (error) { archive.#database.exec("ROLLBACK"); throw error; }
    } finally { archive.close(); }
  }
  /** Disposable preflight snapshot; neither database nor retained files write to disk. */
  static preflightCopy(admission: RuntimeAdmission, path: string): ArchiveDatabase {
    const copy = new ArchiveDatabase(admission, ":memory:");
    copy.#memoryFiles = new Map();
    if (!existsSync(path)) return copy;
    const source = new ArchiveDatabase(admission, path, {readOnly:true});
    try {
      source.#database.exec("BEGIN");
      for (const table of ["archive_records", "archive_deletions"]) {
        for (const row of source.#database.prepare(`SELECT * FROM ${table}`).all()) {
          const columns = Object.keys(row);
          copy.#database.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).run(...Object.values(row));
        }
      }
      for (const file of source.files()) copy.#memoryFiles.set(file.digest, source.readFile(file));
      source.#database.exec("COMMIT");
      return copy;
    } catch (error) { copy.close(); throw error; }
    finally { source.close(); }
  }
  close():void{this.#database.close();}
  async onlineBackupTo(path:string):Promise<number>{return sqliteBackup(this.#database,path,{rate:100});}
  fingerprint():string{
    return createHash("sha256").update(canonicalJsonStringify({reports:this.#database.prepare("SELECT * FROM archive_records ORDER BY run_id").all(),deletions:this.#database.prepare("SELECT * FROM archive_deletions ORDER BY run_id").all()})).digest("hex");
  }
  capture(input:ArchiveReport):ArchiveReport{
    const report=ArchiveReportSchema.parse(input),c=report.content;
    this.#database.exec("BEGIN IMMEDIATE");
    try{
      if(this.deletion(c.runId)!==undefined)throw new Error("archive-report-deleted");
      const prior=this.read(c.runId);
      if(prior!==undefined){if(canonicalJsonStringify(prior)!==canonicalJsonStringify(report))throw new Error("archive-report-replay-conflict");}
      else this.#database.prepare("INSERT INTO archive_records VALUES (?,?,?,?,?,?,?,?,?,?,'captured')").run(c.runId,c.transferId,c.workflow,c.title,c.descriptorVersion,c.outcome,c.completedAt,c.capturedAt,report.digest,canonicalJsonStringify(report));
      this.#database.exec("COMMIT");return report;
    }catch(error){this.#database.exec("ROLLBACK");throw error;}
  }
  read(runId:string):ArchiveReport|undefined{
    const raw=this.#database.prepare("SELECT * FROM archive_records WHERE run_id=?").get(runId);if(raw===undefined)return undefined;
    const row=RowSchema.parse(raw),report=ArchiveReportSchema.parse(JSON.parse(row.report_json)),c=report.content;
    if(c.runId!==runId||report.digest!==row.digest||c.transferId!==row.transfer_id||c.workflow!==row.workflow||c.title!==row.title||c.descriptorVersion!==row.descriptor_version||c.outcome!==row.outcome||c.completedAt!==row.completed_at||c.capturedAt!==row.captured_at)throw new Error("archive-report-index-mismatch");
    return report;
  }
  pendingManualReports(): ArchiveReport[] {
    return this.#database.prepare("SELECT run_id FROM archive_records WHERE state IN ('captured','verified') AND json_extract(report_json,'$.content.manualArchive') IS NOT NULL").all()
      .map(raw => {
        const runId = z.object({ run_id: z.string() }).parse(raw).run_id;
        const report = this.read(runId);
        if (report === undefined) throw new Error("manual-archive-report-missing");
        return report;
      });
  }
  workflows() { return this.#database.prepare("SELECT DISTINCT workflow FROM archive_records WHERE state='published' ORDER BY workflow").all().map(row=>z.object({workflow:z.string()}).parse(row).workflow); }
  private queryConditions(q: ArchiveGroupQuery & { after?: ArchiveQuery["after"] }) {
    const clauses = ["state='published'"], values: (string | number)[] = [];
    if (q.workflow !== undefined) { clauses.push("workflow=?"); values.push(q.workflow); }
    if(q.title!==undefined){clauses.push("title=?");values.push(q.title);}
    if(q.search!==undefined){
      const publicPaths=["$.content.runId","$.content.transferId","$.content.workflow","$.content.itemId","$.content.attempt",
        "$.content.runNumber","$.content.title","$.content.descriptorVersion","$.content.outcome","$.content.completedAt",
        "$.content.capturedAt","$.content.sections","$.content.files","$.content.runtimeVersion",
        "$.content.versionChange.review.changeId","$.content.versionChange.review.change",
        "$.content.versionChange.review.scope","$.content.versionChange.review.targetVersion",
        "$.content.versionChange.review.reviewedAt","$.content.versionChange.application.actorId",
        "$.content.versionChange.application.startedAt"];
      clauses.push(`(${publicPaths.map(path=>`instr(lower(coalesce(cast(json_extract(report_json,'${path}') as text),'')),lower(?))>0`).join(" OR ")})`);
      values.push(...publicPaths.map(()=>q.search!));
    }
    if(q.capturedFrom!==undefined){clauses.push("captured_at>=?");values.push(q.capturedFrom);}
    if(q.capturedTo!==undefined){clauses.push("captured_at<=?");values.push(q.capturedTo);}
    if(q.from!==undefined){clauses.push("completed_at>=?");values.push(q.from);}
    if(q.to!==undefined){clauses.push("completed_at<=?");values.push(q.to);}
    if(q.descriptorVersion!==undefined){clauses.push("descriptor_version=?");values.push(q.descriptorVersion);}
    if(q.outcome!==undefined){clauses.push("outcome=?");values.push(q.outcome);}
    if(q.dashboardVersion!==undefined){clauses.push("json_extract(report_json,'$.content.runtimeVersion.dashboard.major')=? AND json_extract(report_json,'$.content.runtimeVersion.dashboard.minor')=?");values.push(q.dashboardVersion.major,q.dashboardVersion.minor);}
    if(q.workflowVersion!==undefined){clauses.push("json_extract(report_json,'$.content.runtimeVersion.workflow.major')=? AND json_extract(report_json,'$.content.runtimeVersion.workflow.minor')=?");values.push(q.workflowVersion.major,q.workflowVersion.minor);}
    if(q.versionState!==undefined){
      if(q.versionState==="unrecorded")clauses.push("json_extract(report_json,'$.content.runtimeVersion') IS NULL");
      else {clauses.push("json_extract(report_json,'$.content.runtimeVersion.state')=?");values.push(q.versionState);}
    }
    if(q.after!==undefined){clauses.push("(completed_at,run_id)>(?,?)");values.push(q.after.completedAt,q.after.runId);}
    return { clauses, values };
  }
  query(input:ArchiveQuery) {
    this.#database.exec("BEGIN");
    try { const result=this.querySnapshot(input);this.#database.exec("COMMIT");return result; }
    catch(error){this.#database.exec("ROLLBACK");throw error;}
  }
  private querySnapshot(input:ArchiveQuery) {
    const q=ArchiveQuerySchema.parse(input),{clauses,values}=this.queryConditions(q);
    const rows=this.#database.prepare(`SELECT run_id FROM archive_records WHERE ${clauses.join(" AND ")} ORDER BY completed_at,run_id LIMIT ?`).all(...values,q.limit+1);
    const reports=rows.map(raw=>{const id=z.object({run_id:z.string()}).parse(raw).run_id;const report=this.readPublishedReport(id);if(report===undefined)throw new Error("archive-query-state-changed");return report;});
    const items=reports.slice(0,q.limit),last=items.at(-1);
    return {items,next:reports.length>q.limit && last!==undefined ? {completedAt:last.content.completedAt,runId:last.content.runId}:null};
  }
  groups(input: ArchiveGroupQuery, excludedRunIds: readonly string[] = []) {
    const q = ArchiveGroupQuerySchema.parse(input);
    this.#database.exec("BEGIN");
    try {
      const { clauses, values } = this.queryConditions(q);
      if (excludedRunIds.length > 0) { clauses.push("run_id NOT IN (SELECT value FROM json_each(?))"); values.push(JSON.stringify(excludedRunIds)); }
      const rows = this.#database.prepare(`SELECT workflow,
        json_extract(report_json,'$.content.runtimeVersion.dashboard.major') AS dashboard_major,
        json_extract(report_json,'$.content.runtimeVersion.dashboard.minor') AS dashboard_minor,
        json_extract(report_json,'$.content.runtimeVersion.workflow.major') AS workflow_major,
        json_extract(report_json,'$.content.runtimeVersion.workflow.minor') AS workflow_minor,
        count(*) AS report_count, max(completed_at) AS latest_completed_at, max(captured_at) AS latest_captured_at
        FROM archive_records WHERE ${clauses.join(" AND ")}
        GROUP BY workflow,dashboard_major,dashboard_minor,workflow_major,workflow_minor
        ORDER BY dashboard_major DESC,dashboard_minor DESC,workflow,workflow_major DESC,workflow_minor DESC`).all(...values);
      const groups = rows.map(raw => {
        const row = z.strictObject({ workflow: z.string().min(1), dashboard_major: z.number().int().nullable(),
          dashboard_minor: z.number().int().nullable(), workflow_major: z.number().int().nullable(),
          workflow_minor: z.number().int().nullable(), report_count: z.number().int().positive(),
          latest_completed_at: z.string().datetime(), latest_captured_at: z.string().datetime() }).parse(raw);
        if ((row.dashboard_major === null) !== (row.dashboard_minor === null)
          || (row.workflow_major === null) !== (row.workflow_minor === null)
          || (row.dashboard_major === null) !== (row.workflow_major === null)) throw new Error("archive-group-version-invalid");
        return { dashboardVersion: row.dashboard_major === null ? null : { major: row.dashboard_major, minor: row.dashboard_minor! },
          workflow: row.workflow, workflowVersion: row.workflow_major === null ? null : { major: row.workflow_major, minor: row.workflow_minor! },
          reportCount: row.report_count, latestCompletedAt: row.latest_completed_at, latestCapturedAt: row.latest_captured_at };
      });
      this.#database.exec("COMMIT");
      return groups;
    } catch (error) { this.#database.exec("ROLLBACK"); throw error; }
  }
  state(runId:string):"captured"|"verified"|"published"|"deleting"|"deleted"|undefined{
    const row=this.#database.prepare("SELECT state FROM archive_records WHERE run_id=?").get(runId);
    return row===undefined?this.deletion(runId)?.state:z.strictObject({state:z.enum(["captured","verified","published"])}).parse(row).state;
  }
  private fileRoot():string{
    const root=join(dirname(this.path),"archive-files");
    if(existsSync(root)&&(!lstatSync(root).isDirectory()||lstatSync(root).isSymbolicLink()))throw new Error("archive-file-root-invalid");
    return root;
  }
  retainFile(input:ArchiveReport["content"]["files"][number],bytes:Uint8Array):void{
    const file=ArchiveFileReferenceSchema.parse(input);
    if(bytes.length!==file.byteLength||createHash("sha256").update(bytes).digest("hex")!==file.digest)throw new Error("archive-file-source-mismatch");
    if (this.#memoryFiles !== undefined) { this.#memoryFiles.set(file.digest, Buffer.from(bytes)); return; }
    const root=this.fileRoot();mkdirSync(root,{recursive:true,mode:0o700});
    const path=join(root,file.digest);
    if(!existsSync(path))writeFileSync(path,bytes,{flag:"wx",mode:0o600,flush:true});
    this.readFile(file);syncPath(root);
  }
  readFile(input:ArchiveReport["content"]["files"][number]):Buffer{
    const file=ArchiveFileReferenceSchema.parse(input);
    if (this.#memoryFiles !== undefined) {
      const bytes = this.#memoryFiles.get(file.digest);
      if (bytes === undefined || bytes.length !== file.byteLength || createHash("sha256").update(bytes).digest("hex") !== file.digest) throw new Error("archive-file-integrity-mismatch");
      return Buffer.from(bytes);
    }
    const path=join(this.fileRoot(),file.digest);
    if(!existsSync(path)||!lstatSync(path).isFile()||lstatSync(path).isSymbolicLink())throw new Error("archive-file-unavailable");
    const bytes=fileBytes(path);
    if(bytes.length!==file.byteLength||createHash("sha256").update(bytes).digest("hex")!==file.digest)throw new Error("archive-file-integrity-mismatch");
    return bytes;
  }
  verifiedReport(runId:string,digest:string):ArchiveReport{
    const report=this.read(runId);
    if(report?.digest!==digest)throw new Error("archive-verification-report-mismatch");
    if(!["verified","published"].includes(this.state(runId)??""))throw new Error("archive-report-unverified");
    return report;
  }
  verified(runId:string,digest:string):ArchiveReport{
    const report=this.verifiedReport(runId,digest);
    for(const file of report.content.files)this.readFile(file);
    return report;
  }
  verify(runId:string,digest:string):ArchiveReport{
    const report=this.read(runId);if(report?.digest!==digest)throw new Error("archive-verification-report-mismatch");
    for(const file of report.content.files)this.readFile(file);
    if(this.state(runId)==="captured")this.advance(runId,digest,"captured","verified");
    return this.verified(runId,digest);
  }
  publish(runId:string,digest:string):void{this.verified(runId,digest);if(this.state(runId)!=="published")this.advance(runId,digest,"verified","published");}
  readPublishedReport(runId:string):ArchiveReport|undefined{if(this.state(runId)!=="published")return undefined;const report=this.read(runId);if(report===undefined)throw new Error("archive-report-missing");return attestPublishedArchiveReport(this.verifiedReport(runId,report.digest));}
  readPublished(runId:string):ArchiveReport|undefined{const report=this.readPublishedReport(runId);return report===undefined?undefined:this.verified(runId,report.digest);}
  /** Metadata-only membership for independently located backup file bundles. */
  fileReferences(includeCaptured = true): ArchiveReport["content"]["files"] {
    return this.#database.prepare("SELECT run_id FROM archive_records ORDER BY run_id").all().flatMap(raw => {
      const runId = z.strictObject({run_id:z.string()}).parse(raw).run_id;
      if (!includeCaptured && this.state(runId) === "captured") return [];
      const report = this.read(runId);
      if (report === undefined) throw new Error("archive-report-missing");
      return report.content.files;
    });
  }
  files():ArchiveReport["content"]["files"]{
    const files=new Map<string,ArchiveReport["content"]["files"][number]>();
    for(const raw of this.#database.prepare("SELECT run_id FROM archive_records ORDER BY run_id").all()){
      const runId=z.strictObject({run_id:z.string()}).parse(raw).run_id,report=this.read(runId);
      if(report===undefined)throw new Error("archive-report-missing");
      // Pending capture may legitimately have no file yet; backup must still preserve its interruption state.
      for(const file of report.content.files){if(this.state(runId)==="captured"&&!existsSync(join(this.fileRoot(),file.digest)))continue;this.readFile(file);const old=files.get(file.digest);if(old!==undefined&&old.byteLength!==file.byteLength)throw new Error("archive-shared-file-mismatch");files.set(file.digest,file);}
    }return [...files.values()];
  }
  private parseDeletion(raw:unknown){const row=DeletionRowSchema.parse(raw),receipt=DeletedRunRecordSchema.parse(JSON.parse(row.receipt_json)),files=ArchiveFileReferenceSchema.array().parse(JSON.parse(row.files_json));if(receipt.runId!==row.run_id||receipt.origin!=="archive")throw new Error("archive-deletion-receipt-mismatch");return{...row,receipt,files};}
  deletion(runId:string){const row=this.#database.prepare("SELECT * FROM archive_deletions WHERE run_id=?").get(runId);return row===undefined?undefined:this.parseDeletion(row);}
  beginDelete(input:DeletedRunRecord,digest:string):void{
    const receipt=DeletedRunRecordSchema.parse(input),prior=this.deletion(receipt.runId);
    if(prior!==undefined){if(prior.digest!==digest||canonicalJsonStringify(prior.receipt)!==canonicalJsonStringify(receipt))throw new Error("archive-deletion-replay-conflict");return;}
    const report=this.verified(receipt.runId,digest);
    if(receipt.origin!=="archive"||receipt.workflow!==report.content.workflow||receipt.itemId!==report.content.itemId||receipt.attempt!==report.content.attempt)throw new Error("archive-deletion-owner-mismatch");
    this.#database.exec("BEGIN IMMEDIATE");try{
      this.#database.prepare("INSERT INTO archive_deletions VALUES (?,?,?,?,'deleting')").run(receipt.runId,digest,canonicalJsonStringify(receipt),canonicalJsonStringify(report.content.files));
      this.#database.prepare("DELETE FROM archive_records WHERE run_id=? AND digest=?").run(receipt.runId,digest);
      this.#database.exec("COMMIT");
    }catch(error){this.#database.exec("ROLLBACK");throw error;}
  }
  settleDelete(runId:string,afterFile?:(digest:string)=>void,pendingDigests:ReadonlySet<string> = new Set()):void{
    const deletion=this.deletion(runId);if(deletion===undefined)throw new Error("archive-deletion-missing");if(deletion.state==="deleted")return;
    this.#database.exec("BEGIN IMMEDIATE");try{
      const retained=this.fileReferences();
      for(const file of deletion.files){if(pendingDigests.has(file.digest)||retained.some(other=>other.digest===file.digest))continue;const path=join(this.fileRoot(),file.digest);if(existsSync(path)){this.readFile(file);unlinkSync(path);syncPath(this.fileRoot());}afterFile?.(file.digest);}
      this.#database.prepare("UPDATE archive_deletions SET state='deleted' WHERE run_id=? AND state='deleting'").run(runId);this.#database.exec("COMMIT");
    }catch(error){this.#database.exec("ROLLBACK");throw error;}
  }
  private advance(runId:string,digest:string,from:"captured"|"verified",to:"verified"|"published"):void{
    if(this.#database.prepare("UPDATE archive_records SET state=? WHERE run_id=? AND digest=? AND state=?").run(to,runId,digest,from).changes!==1)throw new Error("archive-progress-stale");
  }
}
