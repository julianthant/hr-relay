import { sha256Hex } from "../../domain/sha256.js";
import { ActorIdSchema, IsoInstantSchema } from "../../domain/ids.js";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { canonicalJsonStringify } from "../../domain/canonical-json.js";
import { ArtifactOutboxStorageRecordSchema, ArtifactSinkHeadRecordRequestSchema, GeneratedArtifactSchema,
  GENERATED_ARTIFACT_METADATA_LIMIT, type GeneratedArtifact } from "../../domain/generated-artifact.js";
import { OperatorXlsxExportEvidenceSchema, OperatorXlsxExportRequestSchema, OperatorXlsxExportIdSchema, OPERATOR_XLSX_MEDIA_TYPE } from "../../domain/dashboard/xlsx-export.js";
import { ArtifactRefSchema } from "../../domain/artifacts.js";

export interface GeneratedArtifactPorts {
  database: DatabaseSync;
  mutate<T>(this: void, work: () => Readonly<{ result: T; changes: number }>): T;
}
const RowSchema = z.strictObject({ record_key:z.string(),sink_id:z.string().nullable(),export_id:z.string().nullable(),version:z.number().int(),record_json: z.string(),created_at:z.string() });
export function generatedArtifactFromRow(row: unknown): GeneratedArtifact | undefined {
  if(row===undefined)return undefined;
  const columns=RowSchema.parse(row);const record=GeneratedArtifactSchema.parse(JSON.parse(columns.record_json));
  if(columns.record_key!==record.fileId||columns.sink_id!==record.sinkId||columns.export_id!==record.exportId||columns.version!==record.version||columns.created_at!==record.createdAt)throw new Error("generated artifact mirrored columns disagree with its strict record JSON");
  return record;
}
function encode(record: GeneratedArtifact): string {
  const json = canonicalJsonStringify(GeneratedArtifactSchema.parse(record));
  if (Buffer.byteLength(json, "utf8") > GENERATED_ARTIFACT_METADATA_LIMIT) throw new Error("generated-artifact-metadata-limit");
  return json;
}
export function insertGeneratedArtifact(database: DatabaseSync, record: GeneratedArtifact): void {
  database.prepare(`INSERT INTO generated_artifacts(record_key,sink_id,export_id,version,record_json,created_at) VALUES(?,?,?,?,?,?)`)
    .run(record.fileId, record.sinkId, record.exportId, record.version, encode(record), record.createdAt);
}
export function createGeneratedArtifactRepository(ports: GeneratedArtifactPorts) {
  const { database, mutate } = ports;
  const get = (fileId: string) => generatedArtifactFromRow(database.prepare("SELECT * FROM generated_artifacts WHERE record_key=?").get(fileId));
  const list = () => database.prepare("SELECT * FROM generated_artifacts ORDER BY created_at,record_key").all().map((raw) => {
    const file = generatedArtifactFromRow(raw); if (file === undefined) throw new Error("generated-artifact-missing-row"); return file;
  });
  const save = (old: GeneratedArtifact, next: GeneratedArtifact) => {
    if (next.version !== old.version + 1) throw new Error("generated-artifact-version-conflict");
    if (database.prepare("UPDATE generated_artifacts SET record_json=?,version=? WHERE record_key=? AND version=?")
      .run(encode(next), next.version, old.fileId, old.version).changes !== 1) throw new Error("generated-artifact-version-conflict");
  };
  const locate = (updateId: string) => {
    const files = database.prepare(`SELECT f.* FROM generated_artifacts f, json_each(f.record_json,'$.updates') u
      WHERE json_extract(u.value,'$.record.outboxId')=?`).all(updateId);
    if (files.length > 1) throw new Error("generated-artifact-update-identity-conflict");
    return generatedArtifactFromRow(files[0]);
  };
  const publicationFile = (sinkId: string, updateId: string, expectedGeneration: number) => {
    const file = get(`sink:${sinkId}`);
    if (file === undefined) throw new Error("generated-artifact-head-owner-missing");
    if ((file.head?.generation ?? 0) !== expectedGeneration) throw new Error("generated-artifact-head-generation-conflict");
    if (file.updates.find(u => u.record.state === "pending")?.record.outboxId !== updateId) throw new Error("generated-artifact-out-of-order");
    return file;
  };
  const PublicationIdentitySchema = z.strictObject({ sinkId: z.string(), updateId: z.uuid(), expectedGeneration: z.number().int().nonnegative() });
  return Object.freeze({ get, list,
    publication: Object.freeze({
      assertAvailable(input: unknown) {
        const request = PublicationIdentitySchema.parse(input);
        const file = publicationFile(request.sinkId, request.updateId, request.expectedGeneration);
        if (file.prepared !== null) throw new Error("generated-artifact-prepared-conflict: interrupted publication requires explicit reconciliation");
      },
      assertPrepared(input: unknown) {
        const request = PublicationIdentitySchema.extend({ artifact: ArtifactRefSchema }).parse(input);
        const file = publicationFile(request.sinkId, request.updateId, request.expectedGeneration);
        if (file.prepared === null || file.prepared.updateId !== request.updateId
          || file.prepared.expectedGeneration !== request.expectedGeneration
          || canonicalJsonStringify(file.prepared.artifact) !== canonicalJsonStringify(request.artifact)) {
          throw new Error("generated-artifact-prepared-identity-conflict");
        }
      },
      prepare(input: unknown) {
        const request = PublicationIdentitySchema.extend({ artifact: ArtifactRefSchema }).parse(input);
        return mutate(() => {
          const file = publicationFile(request.sinkId, request.updateId, request.expectedGeneration);
          if (file.prepared !== null) throw new Error("generated-artifact-prepared-conflict");
          if (request.artifact.mediaType !== file.mediaType) throw new Error("generated-artifact-media-type-conflict");
          const prepared = { updateId: request.updateId, expectedGeneration: request.expectedGeneration, artifact: request.artifact };
          const next = { ...file, prepared, state: "writing" as const, version: file.version + 1 };
          // Reserve the complete settlement before external replacement, including an ack timestamp.
          if (file.versions.length >= 10000 || Buffer.byteLength(encode(next), "utf8") + 2048 > GENERATED_ARTIFACT_METADATA_LIMIT) {
            throw new Error("generated-artifact-metadata-limit");
          }
          save(file, next);
          return { result: next, changes: 1 };
        });
      },
      fail(input: unknown) {
        const request = PublicationIdentitySchema.extend({ state: z.enum(["failed", "conflict"]) }).parse(input);
        return mutate(() => {
          const file = publicationFile(request.sinkId, request.updateId, request.expectedGeneration);
          save(file, { ...file, state: request.state, version: file.version + 1 });
          return { result: undefined, changes: 1 };
        });
      },
    }),
    outbox: Object.freeze({
      insert(input: unknown) {
        const record = ArtifactOutboxStorageRecordSchema.parse(input);
        if (record.state !== "pending" || record.projectedAt !== undefined) throw new Error("generated-artifact-new-update-must-be-pending");
        return mutate(() => {
          const existing = locate(record.outboxId);
          const previous = existing?.updates.find((u) => u.record.outboxId === record.outboxId)?.record;
          if (previous !== undefined) {
            const { projectedAt: _projectedAt, ...replay } = previous;
            if (canonicalJsonStringify({ ...replay, state: "pending" }) !== canonicalJsonStringify(record)) throw new Error("generated-artifact-update-replay-divergent");
            return { result: { state: "existing" as const, record: previous }, changes: 0 };
          }
          const old = get(`sink:${record.sinkId}`);
          if (old === undefined) {
            const initial = GeneratedArtifactSchema.parse({ format: 1, fileId: `sink:${record.sinkId}`,
            sinkId: record.sinkId, exportId: null, exportRequest: null, registration: null, exportEvidenceJson: null, exportEvidenceFingerprint: null,
            mediaType: OPERATOR_XLSX_MEDIA_TYPE, state: "pending", historyCoverage: "complete", version: 1, head: null,
            updates: [{ sequence: 1, record }], versions: [], prepared: null, createdAt: record.createdAt });
            if (Buffer.byteLength(encode(initial), "utf8") + 2048 > GENERATED_ARTIFACT_METADATA_LIMIT) throw new Error("generated-artifact-metadata-limit");
            insertGeneratedArtifact(database, initial);
          }
          else {
            const next = { ...old, state: old.prepared === null ? "pending" as const : old.state, version: old.version + 1,
              updates: [...old.updates, { sequence: old.updates.length + 1, record }] };
            const pending = next.updates.filter(u => u.record.state === "pending").length;
            if (next.versions.length + pending > 10000 || Buffer.byteLength(encode(next), "utf8") + pending * 2048 > GENERATED_ARTIFACT_METADATA_LIMIT) {
              throw new Error("generated-artifact-metadata-limit");
            }
            save(old, next);
          }
          return { result: { state: "inserted" as const, record }, changes: 1 };
        });
      },
      get(updateId: string) { return locate(updateId)?.updates.find((u) => u.record.outboxId === updateId)?.record; },
      listPending() { return list().flatMap((f) => f.updates.filter((u) => u.record.state === "pending").map((u) => u.record)); },
      markProjected(input: unknown) {
        const request = z.strictObject({ outboxId: z.uuid(), projectedAt: z.iso.datetime({ offset: true }) }).parse(input);
        return mutate(() => {
          const old = locate(request.outboxId); const update = old?.updates.find((u) => u.record.outboxId === request.outboxId);
          if (old === undefined || update === undefined) throw new Error("generated-artifact-update-missing");
          if (update.record.state === "projected") return { result: { state: "already-projected" as const, record: update.record }, changes: 0 };
          if (old.head?.lastOutboxId !== request.outboxId || old.head.projectedAt !== request.projectedAt) throw new Error("generated-artifact-ack-requires-exact-head");
          if (old.updates.some((u) => u.sequence < update.sequence && u.record.state === "pending")) throw new Error("generated-artifact-out-of-order");
          const record = ArtifactOutboxStorageRecordSchema.parse({ ...update.record, state: "projected", projectedAt: request.projectedAt });
          const updates = old.updates.map((u) => u === update ? { ...u, record } : u);
          const state = updates.some((u) => u.record.state === "pending") ? "pending" : old.versions.at(-1)?.state === "verified" ? "ready" : "unavailable";
          save(old, { ...old, state, updates, prepared: null, version: old.version + 1 });
          return { result: { state: "acknowledged" as const, record }, changes: 1 };
        });
      },
    }),
    heads: Object.freeze({
      get(sinkId: string) { return get(`sink:${sinkId}`)?.head ?? undefined; },
      record(input: unknown) {
        const request = ArtifactSinkHeadRecordRequestSchema.extend({ expectedGeneration: z.number().int().nonnegative(), artifact: ArtifactRefSchema }).parse(input);
        return mutate(() => {
          const old = get(`sink:${request.sinkId}`);
          if (old === undefined) throw new Error("generated-artifact-head-owner-missing");
          if ((old.head?.generation ?? 0) !== request.expectedGeneration) throw new Error("generated-artifact-head-generation-conflict");
          const next = old.updates.find((u) => u.record.state === "pending");
          if (next?.record.outboxId !== request.lastOutboxId) throw new Error("generated-artifact-out-of-order");
          if (old.prepared !== null && (old.prepared.updateId !== request.lastOutboxId
            || old.prepared.expectedGeneration !== request.expectedGeneration
            || canonicalJsonStringify(old.prepared.artifact) !== canonicalJsonStringify(request.artifact))) {
            throw new Error("generated-artifact-prepared-identity-conflict");
          }
          const { expectedGeneration, artifact, ...fields } = request;
          const head = { ...fields, generation: expectedGeneration + 1 };
          const versions = [...old.versions, { state: "verified" as const, artifact }];
          if (artifact !== undefined && artifact.sha256 !== request.contentSha256) throw new Error("generated-artifact-head-bytes-conflict");
          save(old, { ...old, head, versions, version: old.version + 1, state: "writing" });
          return { result: head, changes: 1 };
        });
      },
    }),
    exports: Object.freeze({
      getFile(exportId: string) { return get(`export:${OperatorXlsxExportIdSchema.parse(exportId)}`); },
      register(input:unknown){
        const request=z.strictObject({exportId:OperatorXlsxExportIdSchema,request:OperatorXlsxExportRequestSchema,requestedBy:ActorIdSchema,requestedAt:IsoInstantSchema, contentSha256: ArtifactRefSchema.shape.sha256.optional()}).parse(input);
        return mutate(()=>{
          const old=get(`export:${request.exportId}`);
          const registration={requestedBy:request.requestedBy,requestedAt:request.requestedAt};
          if(old!==undefined){
            if(canonicalJsonStringify(old.exportRequest)!==canonicalJsonStringify(request.request)||canonicalJsonStringify(old.registration)!==canonicalJsonStringify(registration))throw new Error("generated-export-registration-divergent");
            // An unavailable first version commits to intended bytes before publication.
            if (request.contentSha256 !== undefined && old.versions[0]?.state === "unavailable"
              && old.versions[0].sha256 !== request.contentSha256) throw new Error("generated-export-content-divergent");
            return {result:old,changes:0};
          }
          const file=GeneratedArtifactSchema.parse({format:1,fileId:`export:${request.exportId}`,sinkId:null,exportId:request.exportId,exportRequest:request.request,registration,exportEvidenceJson:null,exportEvidenceFingerprint:null,
            mediaType:OPERATOR_XLSX_MEDIA_TYPE,state:"pending",historyCoverage:"complete",version:1,head:null,updates:[],versions:request.contentSha256 === undefined ? [] : [{state:"unavailable",sha256:request.contentSha256,reason:"missing-bytes"}],prepared:null,createdAt:request.requestedAt});
          insertGeneratedArtifact(database,file);return {result:file,changes:1};
        });
      },
      fail(exportId:string,expectedVersion:number){
        return mutate(()=>{const old=get(`export:${OperatorXlsxExportIdSchema.parse(exportId)}`);
          if(old===undefined||old.version!==expectedVersion||old.exportEvidenceJson!==null)throw new Error("generated-export-version-conflict");
          const next=GeneratedArtifactSchema.parse({...old,state:"failed",version:old.version+1});save(old,next);return {result:next,changes:1};
        });
      },
      insert(input: unknown) {
        const evidence = OperatorXlsxExportEvidenceSchema.parse(input); const json = canonicalJsonStringify(evidence);
        return mutate(() => {
          const old = get(`export:${evidence.exportId}`);
          if (old !== undefined && old.exportEvidenceJson === null) {
            if(old.registration===null||old.exportRequest===null||evidence.workbookVersion!==2||old.registration.requestedBy!==evidence.requestedBy||old.exportRequest?.selection.kind!==evidence.selection.kind)throw new Error("generated-export-publication-identity-conflict");
            const selection = old.exportRequest.selection;
            if (evidence.createdAt !== old.registration.requestedAt
              || (selection.kind === "search" && (evidence.selection.kind !== "search"
                || canonicalJsonStringify(selection.query) !== canonicalJsonStringify(evidence.selection.query)
                || selection.snapshot.authorityGeneration !== evidence.selection.snapshot.authorityGeneration
                || selection.snapshot.order !== evidence.selection.snapshot.order))
              || (selection.kind === "activity" && (evidence.selection.kind !== "activity"
                || selection.from !== evidence.selection.snapshot.from || selection.to !== evidence.selection.snapshot.to))
              || (old.versions[0]?.state === "unavailable" && old.versions[0].sha256 !== evidence.artifact.sha256)) {
              throw new Error("generated-export-publication-identity-conflict");
            }
            save(old,{...old,state:"ready",exportEvidenceJson:json,exportEvidenceFingerprint:sha256Hex(json),versions:[...old.versions,{state:"verified",artifact:evidence.artifact}],version:old.version+1});
            return {result:{state:"inserted" as const,record:evidence},changes:1};
          }
          if (old !== undefined) {
            if (old.exportEvidenceJson === null || canonicalJsonStringify(JSON.parse(old.exportEvidenceJson)) !== json) throw new Error(`operator XLSX export ${evidence.exportId} already exists with different content`);
            return { result: { state: "existing" as const, record: evidence }, changes: 0 };
          }
          insertGeneratedArtifact(database, GeneratedArtifactSchema.parse({ format: 1, fileId: `export:${evidence.exportId}`, sinkId: null,
            exportId: evidence.exportId, exportRequest: null, registration: null, exportEvidenceJson: json, exportEvidenceFingerprint: sha256Hex(json), mediaType: evidence.artifact.mediaType,
            state: "ready", historyCoverage: "complete", version: 1, head: null, updates: [], versions: [{ state: "verified", artifact: evidence.artifact }], prepared: null, createdAt: evidence.createdAt }));
          return { result: { state: "inserted" as const, record: evidence }, changes: 1 };
        });
      },
      get(exportId: string) { const file = get(`export:${exportId}`); return file?.exportEvidenceJson == null ? undefined : OperatorXlsxExportEvidenceSchema.parse(JSON.parse(file.exportEvidenceJson)); },
      listByArtifact(artifactId: string) {
        return list().flatMap((f) => f.exportEvidenceJson === null ? [] : [OperatorXlsxExportEvidenceSchema.parse(JSON.parse(f.exportEvidenceJson))]).filter((e) => e.artifact.id === artifactId);
      },
    }),
  });
}
