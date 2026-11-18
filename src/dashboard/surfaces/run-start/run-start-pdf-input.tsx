import { useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button, IconButton } from "../../ds/ui.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";

/** PDFs listed before "Show more", so a large pick keeps the dialog's other controls in view. */
const PDFS_SHOWN = 5;

export function WorkflowPdfInput({ files, busy, onChoose, onRemove, onClear }: {
  files: readonly { name: string; size: number }[]; busy: boolean;
  onChoose: (files: readonly File[]) => void; onRemove: (index: number) => void; onClear?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? files : files.slice(0, PDFS_SHOWN);
  return <RunList title="PDF documents" description="Choose the scans to read.">
    <input ref={input} hidden name="documents" type="file" multiple accept="application/pdf,.pdf" disabled={busy} onChange={event => { const selected = Array.from(event.currentTarget.files ?? []); if (selected.length) onChoose(selected); event.currentTarget.value = ""; }} />
    <RunListRow title={<span role="status">{busy ? "Reading PDFs…" : files.length ? `${files.length} ${files.length === 1 ? "PDF" : "PDFs"} selected` : "No PDFs selected"}</span>}>
      {onClear !== undefined && files.length > 1 && <Button variant="ghost" disabled={busy} onClick={onClear}>Clear all</Button>}
      <Button variant="secondary" disabled={busy} icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>Choose PDFs</Button>
    </RunListRow>
    {shown.map((file, index) => <RunListRow key={`${index}:${file.name}`} title={file.name} description={`${Math.ceil(file.size / 1024)} KB`} lead={<FileText aria-hidden className="size-4 shrink-0 text-ui-muted" />}>
      <IconButton label={`Remove ${file.name}`} disabled={busy} icon={<X aria-hidden className="size-3.5" />} onClick={() => onRemove(index)} />
    </RunListRow>)}
    {files.length > PDFS_SHOWN && <div className="flex min-h-[var(--ds-row-h-1)] items-center py-[var(--ds-row-pad-y-1)]">
      <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show ${files.length - PDFS_SHOWN} more`}</Button></div>}
  </RunList>;
}
