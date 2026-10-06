import { useRef } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button, IconButton } from "../../../ds/ui.js";

export function WorkflowPdfInput({ files, busy, onChoose, onRemove }: {
  files: readonly { name: string; size: number }[]; busy: boolean;
  onChoose: (files: readonly File[]) => void; onRemove: (index: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <section aria-label="PDF documents" className="flex min-w-0 flex-col gap-2">
    <h4 className="m-0 text-body font-semibold">PDF documents</h4>
    <div className="overflow-hidden rounded-md border border-ui-stroke bg-ui-table">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <input ref={input} hidden name="documents" type="file" multiple accept="application/pdf,.pdf" disabled={busy} onChange={event => { const selected = Array.from(event.currentTarget.files ?? []); if (selected.length) onChoose(selected); event.currentTarget.value = ""; }} />
        <Button variant="secondary" disabled={busy} icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>Choose PDFs</Button>
        <span className="text-caption text-ui-muted" role="status">{busy ? "Reading PDFs…" : files.length ? `${files.length} ${files.length === 1 ? "PDF" : "PDFs"} selected` : "No PDFs selected"}</span>
      </div>
      {files.length > 0 && <ul aria-label="Selected PDFs" className="m-0 list-none border-t border-ui-stroke p-0">{files.map((file, index) => <li key={`${index}:${file.name}`} className="flex min-w-0 items-center gap-3 border-b border-ui-stroke px-3 py-2 last:border-0">
        <FileText aria-hidden className="size-4 shrink-0 text-ui-muted" /><span className="min-w-0 flex-1 break-words text-body">{file.name}</span><span className="shrink-0 text-caption tabular-nums text-ui-muted">{Math.ceil(file.size / 1024)} KB</span><IconButton label={`Remove ${file.name}`} variant="ghost" disabled={busy} icon={<X className="size-3.5" />} onClick={() => onRemove(index)} />
      </li>)}</ul>}
    </div>
  </section>;
}
