import { useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button, IconButton, dsIcon } from "../../ds/ui.js";
import { RunHeading, RunList, RunListRow } from "../../ds/primitives/run-list.js";

/** PDFs listed before "Show more", so a large pick keeps the dialog's other controls in view. */
const PDFS_SHOWN = 5;

export function WorkflowPdfInput({ files, busy, onChoose, onRemove, onClear }: {
  files: readonly { name: string; size: number }[]; busy: boolean;
  onChoose: (files: readonly File[]) => void; onRemove: (index: number) => void; onClear?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? files : files.slice(0, PDFS_SHOWN);
  const status = busy ? "Reading PDFs…" : files.length ? `${files.length} ${files.length === 1 ? "PDF" : "PDFs"} selected` : "No PDFs selected";
  const choose = <Button variant="secondary" disabled={busy} icon={<Upload aria-hidden className={dsIcon.md} />} onClick={() => input.current?.click()}>{files.length ? "Add PDFs" : "Choose PDFs"}</Button>;
  // A drop always stays in the dialog: the browser would otherwise open the file over it.
  return <section aria-label="PDF documents" className="flex min-w-0 flex-col gap-2.5"
    onDragOver={event => event.preventDefault()}
    onDrop={event => { event.preventDefault(); const dropped = Array.from(event.dataTransfer.files); if (!busy && dropped.length) onChoose(dropped); }}>
    <input ref={input} hidden name="documents" type="file" multiple accept="application/pdf,.pdf" disabled={busy} onChange={event => { const selected = Array.from(event.currentTarget.files ?? []); if (selected.length) onChoose(selected); event.currentTarget.value = ""; }} />
    <div className="flex items-center justify-between gap-4">
      <RunHeading title="PDF documents" description="One run for all files." />
      {files.length > 0 && <div className="flex items-center gap-2">
        {onClear !== undefined && files.length > 1 && <Button variant="ghost" disabled={busy} onClick={onClear}>Clear all</Button>}
        {choose}
      </div>}
    </div>
    <span role="status" className={busy && files.length > 0 ? "text-[12px] text-ui-muted" : "sr-only"}>{status}</span>
    {files.length === 0 && <div className="flex items-center justify-center gap-3 rounded-xl border border-dashed border-ui-stroke-control p-[18px] text-body text-ui-muted">
      {busy ? "Reading PDFs…" : "Drop PDFs here"}{choose}
    </div>}
    {files.length > 0 && <RunList label="Selected PDFs">
    {shown.map((file, index) => <RunListRow key={`${index}:${file.name}`} title={file.name} lead={<FileText aria-hidden className={`${dsIcon.md} shrink-0 text-ui-muted`} />}>
      <span className="text-[12px] tabular-nums text-ui-muted">{`${Math.ceil(file.size / 1024)} KB`}</span>
      <IconButton label={`Remove ${file.name}`} disabled={busy} icon={<X aria-hidden className={dsIcon.md} />} onClick={() => onRemove(index)} />
    </RunListRow>)}
    {files.length > PDFS_SHOWN && <div className="flex min-h-[var(--ds-row-h-1)] items-center py-[var(--ds-row-pad-y-1)]">
      <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show ${files.length - PDFS_SHOWN} more`}</Button></div>}
    </RunList>}
  </section>;
}
