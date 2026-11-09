import { useRef } from "react";
import { FileText, Upload, X } from "lucide-react";
import { Button, IconButton } from "../../../ds/ui.js";
import { RunList, RunListRow } from "../../run-start/run-list.js";

export function WorkflowPdfInput({ files, busy, onChoose, onRemove }: {
  files: readonly { name: string; size: number }[]; busy: boolean;
  onChoose: (files: readonly File[]) => void; onRemove: (index: number) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <RunList title="PDF documents" description="Choose the scans to read.">
    <input ref={input} hidden name="documents" type="file" multiple accept="application/pdf,.pdf" disabled={busy} onChange={event => { const selected = Array.from(event.currentTarget.files ?? []); if (selected.length) onChoose(selected); event.currentTarget.value = ""; }} />
    <RunListRow title={<span role="status">{busy ? "Reading PDFs…" : files.length ? `${files.length} ${files.length === 1 ? "PDF" : "PDFs"} selected` : "No PDFs selected"}</span>}>
      <Button variant="secondary" disabled={busy} icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>Choose PDFs</Button>
    </RunListRow>
    {files.map((file, index) => <RunListRow key={`${index}:${file.name}`} title={file.name} description={`${Math.ceil(file.size / 1024)} KB`} lead={<FileText aria-hidden className="size-4 shrink-0 text-ui-muted" />}>
      <IconButton label={`Remove ${file.name}`} disabled={busy} icon={<X aria-hidden className="size-3.5" />} onClick={() => onRemove(index)} />
    </RunListRow>)}
  </RunList>;
}
