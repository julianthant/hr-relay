import { useCallback, useEffect, useRef, useState } from "react";
import { OcrSourceUploadSchema } from "../../../models/ocr/review.js";
import type { UploadRunSurface } from "../../../models/workflow/ingress.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { DashboardClient } from "../../client/index.js";
import { DashboardClientError } from "../../client/errors.js";
import type { DashboardCommandBinding } from "../../app/dashboard-app-model.js";
import type { RunInputPreview } from "./run-start-model.js";

type Pdf = { source: ReturnType<typeof OcrSourceUploadSchema.parse>; readingId: string };
export type PdfRunDraft = { files: readonly Pdf[]; asOf: string; reviewer: string };
/** The operator's choice for each declared launch field of a PDF workflow, keyed by input field; a field with no entry is unpicked. */
export type PdfRunPicks = Readonly<Record<string, string>>;
class WrongPdfType extends Error { constructor() { super("Choose valid PDF files."); } }
const refused = () => new Error(formatErrorCatalogFailure(createErrorCatalogFailure("OCR_SOURCE_REFUSED", {})).text);

/** The declared launch fields of a PDF workflow. The Run dialog offers choices only, so any other declared kind is refused. */
export function pdfRunLaunchFields(surface: UploadRunSurface) {
  return surface.fields.map(field => {
    if (field.kind !== "select") throw new Error(`The Run dialog cannot offer the ${field.kind} launch field ${field.field}`);
    return field;
  });
}
/** The first required launch field without a pick, which blocks planning; null when every required field is picked. */
export function unpickedPdfRunField(surface: UploadRunSurface, picks: PdfRunPicks) {
  return pdfRunLaunchFields(surface).find(field => field.required && !field.options.some(option => option.value === picks[field.field])) ?? null;
}

export function previewPdfRun(surface: UploadRunSurface, draft: PdfRunDraft | null, picks: PdfRunPicks = {}): RunInputPreview {
  const input = surface.pdfInput;
  if (input === undefined) throw refused();
  if (draft === null || draft.files.length === 0) return { entries: [], submissions: [], problem: null };
  const picked = Object.fromEntries(pdfRunLaunchFields(surface).flatMap(field => field.options.some(option => option.value === picks[field.field]) ? [[field.field, picks[field.field]]] : []));
  if ("documentField" in input) return { entries: draft.files.map((file, index) => ({ index, sourceText: file.source.fileName })), problem: null,
    submissions: unpickedPdfRunField(surface, picks) !== null ? [] : draft.files.map(({ source, readingId }) => JsonValueSchema.parse({ ...input.fixed, ...picked, [input.documentField]: source.artifact, [input.fileNameField]: source.fileName, [input.readingIdField]: readingId })) };
  return { entries: [{ index: 0, sourceText: draft.files.map(file => file.source.fileName).join(", ") }], problem: null,
    submissions: unpickedPdfRunField(surface, picks) !== null ? [] : [JsonValueSchema.parse({
      ...picked, [input.documentsField]: draft.files.map(({ source, readingId }) => ({ document: source.artifact, fileName: source.fileName, readingId, reading: { kind: "subscription" } })),
      [input.asOfField]: draft.asOf, [input.reviewerField]: draft.reviewer,
    })] };
}

export function usePdfRunInput(client: DashboardClient, binding: DashboardCommandBinding | undefined) {
  const [draft, setDraft] = useState<PdfRunDraft | null>(null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const [picks, setPicks] = useState<PdfRunPicks>({});
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const current = useRef<AbortController | null>(null);
  const authority = useRef(binding); authority.current = binding;
  const reset = useCallback(() => { current.current?.abort(); current.current = null; setLoading(false); setDraft(null); setPicks({}); setError(null); }, []);
  useEffect(() => () => { current.current?.abort(); current.current = null; }, []);
  useEffect(reset, [client, binding?.scope, reset]);
  const choose = useCallback(async (surface: UploadRunSurface, files: readonly File[]) => {
    const owner = authority.current;
    if (owner === undefined || owner.scope.client !== client || surface.pdfInput === undefined || current.current !== null) return;
    const operation = new AbortController(); current.current = operation; setLoading(true); setError(null);
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
      if (current.current === operation && !operation.signal.aborted) setError(cause instanceof DashboardClientError || cause instanceof WrongPdfType ? cause.message : refused().message);
    } finally { if (current.current === operation) { current.current = null; setLoading(false); } }
  }, [client]);
  return { draft, picks, pick: (field: string, value: string) => setPicks(previous => ({ ...previous, [field]: value })), loading, error, reset, choose, remove: (index: number) => {
    setError(null);
    setDraft(previous => previous === null ? null : { ...previous, files: previous.files.filter((_file, position) => position !== index) });
  } };
}
