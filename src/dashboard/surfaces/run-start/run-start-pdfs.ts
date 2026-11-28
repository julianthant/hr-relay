import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { OcrSourceUploadSchema } from "../../../models/ocr/review.js";
import type { UploadRunSurface } from "../../../models/workflow/ingress.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { JsonValueSchema, type JsonObject } from "../../../rules/validation/canonical-json.js";
import type { DashboardClient } from "../../client/index.js";
import { DashboardClientError } from "../../client/errors.js";
import type { DashboardCommandBinding } from "../../app/dashboard-app-model.js";
import type { RunInputPreview } from "./run-start-model.js";

const PdfSourceSchema = OcrSourceUploadSchema.pick({ artifact: true, fileName: true });
/** `original` is the document as an earlier run of it was started, its reading included. */
type Pdf = { source: z.infer<typeof PdfSourceSchema>; readingId: string; original?: JsonObject };
/** `input` is the earlier run's whole input, when the draft was restored from one. */
export type PdfRunDraft = { files: readonly Pdf[]; asOf: string; reviewer: string; input?: JsonObject };
/** The operator's choice for each declared launch field of a PDF workflow, keyed by input field; a select with no entry is unpicked, a switch with no entry holds its declared initial value. */
export type PdfRunPicks = Readonly<Record<string, string | boolean>>;
class WrongPdfType extends Error { constructor() { super("Choose valid PDF files."); } }
const refused = () => new Error(formatErrorCatalogFailure(createErrorCatalogFailure("OCR_SOURCE_REFUSED", {})).text);
const uploadFailed = () => formatErrorCatalogFailure(createErrorCatalogFailure("OCR_UPLOAD_FAILED", {})).text;

/** The declared launch fields of a PDF workflow: choices and switches. Any other declared kind is refused. */
export function pdfRunLaunchFields(surface: UploadRunSurface) {
  return surface.fields.map(field => {
    if (field.kind !== "select" && field.kind !== "boolean") throw new Error(`The Run dialog cannot offer the ${field.kind} launch field ${field.field}`);
    return field;
  });
}
/** A declared switch's current value: the operator's pick, else its declared initial value. */
export function pdfRunSwitchValue(field: Readonly<{ field: string; initial: boolean }>, picks: PdfRunPicks): boolean {
  const pick = picks[field.field];
  return typeof pick === "boolean" ? pick : field.initial;
}
/** The pick of a select launch field; empty when unpicked. */
export function pdfRunSelectValue(field: Readonly<{ field: string }>, picks: PdfRunPicks): string {
  const pick = picks[field.field];
  return typeof pick === "string" ? pick : "";
}
const OCR_FIELD = "extractWithOcr";
const ManualReadingSchema = z.object({ reading: z.object({ kind: z.literal("manual"), actorId: z.string() }) });
const readManually = (file: Pdf) => ManualReadingSchema.safeParse(file.original).success;
/** The launch fields Start offers: a run that keeps a manual reading cannot start without OCR, so it has no OCR switch. */
export function pdfRunOfferedFields(surface: UploadRunSurface, draft: PdfRunDraft | null) {
  return pdfRunLaunchFields(surface).filter(({ field }) => field !== OCR_FIELD || draft === null || !draft.files.some(readManually));
}
export function pdfRunReadingMode(surface: UploadRunSurface, draft: PdfRunDraft | null, picks: PdfRunPicks): "manual" | "off" | "subscription" {
  if (draft !== null && draft.files.length > 0 && draft.files.every(readManually)) return "manual";
  const field = pdfRunLaunchFields(surface).find(candidate => candidate.kind === "boolean" && candidate.field === OCR_FIELD);
  return field?.kind === "boolean" && !pdfRunSwitchValue(field, picks) ? "off" : "subscription";
}

export function pdfRunOcrFooter(surface: UploadRunSurface, draft: PdfRunDraft | null, picks: PdfRunPicks): string {
  return { manual: "Manual reading", off: "OCR off", subscription: "OCR on" }[pdfRunReadingMode(surface, draft, picks)];
}
/** The first required launch field without a pick, which blocks planning; null when every required field is picked. */
export function unpickedPdfRunField(surface: UploadRunSurface, picks: PdfRunPicks) {
  return pdfRunLaunchFields(surface).flatMap(field => field.kind === "select" ? [field] : []).find(field => field.required && !field.options.some(option => option.value === picks[field.field])) ?? null;
}

export function previewPdfRun(surface: UploadRunSurface, draft: PdfRunDraft | null, picks: PdfRunPicks = {}): RunInputPreview {
  const input = surface.pdfInput;
  if (input === undefined) throw refused();
  if (draft === null || draft.files.length === 0) return { entries: [], submissions: [], problem: null };
  const picked = Object.fromEntries(pdfRunLaunchFields(surface).flatMap(field => field.kind === "boolean" ? draft.input !== undefined && picks[field.field] === undefined ? [] : [[field.field, pdfRunSwitchValue(field, picks)]]
    : field.options.some(option => option.value === picks[field.field]) ? [[field.field, picks[field.field]]] : []));
  if ("documentField" in input) return { entries: draft.files.map((file, index) => ({ index, sourceText: file.source.fileName })), problem: null,
    submissions: unpickedPdfRunField(surface, picks) !== null ? [] : draft.files.map(({ source, readingId }) => JsonValueSchema.parse({ ...(draft.input ?? input.fixed), ...picked, [input.documentField]: source.artifact, [input.fileNameField]: source.fileName, [input.readingIdField]: readingId })) };
  return { entries: [{ index: 0, sourceText: draft.files.map(file => file.source.fileName).join(", ") }], problem: null,
    submissions: unpickedPdfRunField(surface, picks) !== null ? [] : [JsonValueSchema.parse({
      ...draft.input, ...picked, [input.documentsField]: draft.files.map(({ source, readingId, original }) => ({ reading: { kind: "subscription" }, ...original, document: source.artifact, fileName: source.fileName, readingId })),
      [input.asOfField]: draft.asOf, [input.reviewerField]: draft.reviewer,
    })] };
}

const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

/** An earlier run's input, each PDF under a new reading ID and everything else as it was; null when it cannot be reused, as a reading another operator asserted or a manual reading started without OCR cannot. */
export function restorePdfRun(surface: UploadRunSurface, value: unknown, actorId: string): { draft: PdfRunDraft; picks: PdfRunPicks } | null {
  const input = surface.pdfInput, record = JsonObjectSchema.safeParse(value).data;
  if (input === undefined || record === undefined) return null;
  const documents = "documentField" in input ? [{ ...record, document: record[input.documentField], fileName: record[input.fileNameField] }]
    : z.array(JsonObjectSchema).min(1).safeParse(record[input.documentsField]).data;
  const about = z.object({ asOf: z.string(), reviewer: z.string() }).safeParse("documentField" in input ? { asOf: "", reviewer: "" } : { asOf: record[input.asOfField], reviewer: record[input.reviewerField] }).data;
  if (documents === undefined || about === undefined) return null;
  const files: Pdf[] = [];
  for (const original of documents) {
    const source = PdfSourceSchema.safeParse({ artifact: original.document, fileName: original.fileName }).data;
    const asserter = ManualReadingSchema.safeParse(original).data?.reading.actorId;
    if (source === undefined || asserter !== undefined && (asserter !== actorId || record[OCR_FIELD] === false)) return null;
    files.push({ source, readingId: crypto.randomUUID(), original });
  }
  const picks = Object.fromEntries(pdfRunLaunchFields(surface).flatMap(({ field }) => {
    const pick = record[field];
    return typeof pick === "string" || typeof pick === "boolean" ? [[field, pick]] : [];
  }));
  return { draft: { files, ...about, input: record }, picks };
}

export function usePdfRunInput(client: DashboardClient, binding: DashboardCommandBinding | undefined) {
  const [draft, setDraft] = useState<PdfRunDraft | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const [picks, setPicks] = useState<PdfRunPicks>({});
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null);
  /** The files of an upload that failed, kept so Retry can send them again. */
  const failed = useRef<{ surface: UploadRunSurface; files: readonly File[] } | null>(null);
  const authority = useRef(binding); authority.current = binding;
  const reset = useCallback(() => { current.current?.abort(); current.current = null; failed.current = null; setLoading(false); setDraft(null); setPicks({}); setError(null); }, []);
  useEffect(() => () => { current.current?.abort(); current.current = null; }, []);
  useEffect(reset, [client, binding?.scope, reset]);
  const choose = useCallback(async (surface: UploadRunSurface, files: readonly File[]) => {
    const owner = authority.current;
    if (owner === undefined || owner.scope.client !== client || surface.pdfInput === undefined || current.current !== null) return;
    const operation = new AbortController(); current.current = operation; failed.current = null; setLoading(true); setError(null);
    try {
      const uploaded: Pdf[] = [];
      for (const file of files) {
        const accepted = surface.accepts.find(accept => accept.mediaType === "application/pdf");
        if (accepted === undefined || !accepted.extensions.some(extension => file.name.toLowerCase().endsWith(extension))
          || file.type !== "" && file.type !== "application/pdf") throw new WrongPdfType();
        if (file.size === 0 || file.size > accepted.maxBytes) throw refused();
        const source = OcrSourceUploadSchema.parse(await client.uploadOcrSource({ fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }, operation.signal));
        if (source.uploadedBy !== owner.scope.actorId || source.fileName !== file.name || source.artifact.bytes !== file.size) throw refused();
        uploaded.push({ source, readingId: crypto.randomUUID() });
      }
      if (current.current !== operation || operation.signal.aborted || authority.current?.scope !== owner.scope) return;
      const previous = draftRef.current, combined = [...(previous?.files ?? []), ...uploaded];
      if (new Set(combined.map(file => file.source.artifact.sha256)).size !== combined.length) throw refused();
      setDraft({ files: combined, asOf: previous?.asOf ?? owner.authority.today, reviewer: previous?.reviewer ?? owner.authority.epoch.bootstrap.actor.label });
    } catch (cause) {
      if (current.current === operation && !operation.signal.aborted) {
        if (cause instanceof DashboardClientError) failed.current = { surface, files };
        setError(cause instanceof DashboardClientError ? uploadFailed() : cause instanceof WrongPdfType ? cause.message : refused().message);
      }
    } finally { if (current.current === operation) { current.current = null; setLoading(false); } }
  }, [client]);
  const restore = useCallback((restored: { draft: PdfRunDraft; picks: PdfRunPicks }) => { reset(); setDraft(restored.draft); setPicks(restored.picks); }, [reset]);
  return { draft, picks, restore, pick: (field: string, value: string | boolean) => setPicks(previous => ({ ...previous, [field]: value })), loading, error, reset, choose, retryable: error !== null && failed.current !== null, retry: () => { const last = failed.current; if (last !== null) void choose(last.surface, last.files); }, clear: () => { setError(null); setDraft(previous => previous === null ? null : { ...previous, files: [] }); }, remove: (index: number) => {
    setError(null);
    setDraft(previous => previous === null ? null : { ...previous, files: previous.files.filter((_file, position) => position !== index) });
  } };
}
