import { useId, useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button, IconButton, dsIcon } from "../../ds/ui.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";

/** PDFs listed before "Show more", so a large pick keeps the dialog's other controls in view. */
const PDFS_SHOWN = 5;

export function WorkflowPdfInput({ files, busy, onChoose, onRemove, onClear }: {
  files: readonly { name: string; size: number }[]; busy: boolean;
  onChoose: (files: readonly File[]) => void; onRemove: (index: number) => void; onClear?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? files : files.slice(0, PDFS_SHOWN);
  const status = busy ? "Reading PDFs…" : files.length ? `${files.length} ${files.length === 1 ? "PDF" : "PDFs"} selected` : "No PDFs selected";
  return <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2">
    <h4 id={titleId} className="m-0 text-body font-normal text-ui-primary">PDF documents</h4>
    <input ref={input} hidden name="documents" type="file" multiple accept="application/pdf,.pdf" disabled={busy} onChange={event => { const selected = Array.from(event.currentTarget.files ?? []); if (selected.length) onChoose(selected); event.currentTarget.value = ""; }} />
    <div className="flex h-9 items-center gap-2 rounded-lg border border-ui-stroke-control bg-ui-field py-1 pr-1 pl-3">
      <span role="status" className={`min-w-0 flex-1 truncate text-body ${files.length ? "text-ui-primary" : "text-ui-muted"}`}>{status}</span>
      {onClear !== undefined && files.length > 1 && <Button size="sm" variant="ghost" disabled={busy} onClick={onClear}>Clear all</Button>}
      <Button size="sm" variant="secondary" disabled={busy} icon={<Upload aria-hidden className={dsIcon.md} />} onClick={() => input.current?.click()}>Choose PDFs</Button>
    </div>
    {files.length > 0 && <RunList label="Selected PDFs">
    {shown.map((file, index) => <RunListRow key={`${index}:${file.name}`} title={file.name} description={`${Math.ceil(file.size / 1024)} KB`} lead={<FileText aria-hidden className={`${dsIcon.lg} shrink-0 text-ui-muted`} />}>
      <IconButton label={`Remove ${file.name}`} disabled={busy} icon={<X aria-hidden className={dsIcon.md} />} onClick={() => onRemove(index)} />
    </RunListRow>)}
    {files.length > PDFS_SHOWN && <div className="flex min-h-[var(--ds-row-h-1)] items-center py-[var(--ds-row-pad-y-1)]">
      <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? "Show fewer" : `Show ${files.length - PDFS_SHOWN} more`}</Button></div>}
    </RunList>}
  </section>;
}
