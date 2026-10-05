import { useRef, useState } from "react";
import { FileText, Plus, Check, AlertCircle } from "lucide-react";
import { Badge, Button, Checkbox, Field, Input, Select, dsFocus } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { addMockReviewRecord, reviewCanApprove, reviewIsReadOnly, reviewName, reviewRecords, reviewValue, seedReviewRecords, editReviewRecord, REVIEW_RELATIONSHIPS, type ReviewField, type ReviewRecord } from "./workflow-review-model.js";
import type { MockRun } from "./workflow-mock-model.js";

export function WorkflowMockReview({ run, onChange, onApprove, onDiscard, onRestore }: {
  run: MockRun; onChange: (records: readonly ReviewRecord[]) => void; onApprove?: () => void; onDiscard?: () => void; onRestore: () => void;
}) {
  const records = reviewRecords(run);
  const [activeId, setActiveId] = useState(records[0]?.id);
  const [sourceOpen, setSourceOpen] = useState(false);
  const identityInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const record = records.find(item => item.id === activeId);
  if (records.length === 0) return <div className="flex min-h-0 flex-1 flex-col">
    <div role="status" className="flex flex-1 items-center justify-center p-5 text-body text-ui-muted">No records extracted</div>
    {(onApprove || run.discarded) && <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-ui-stroke bg-ui-table px-5 py-3">
      <Button onClick={run.discarded ? onRestore : onDiscard}>{run.discarded ? "Undo discard" : "Discard"}</Button>
      {onApprove && <Button variant="primary" disabled>Approve records</Button>}
    </footer>}
  </div>;
  if (!record) throw new Error(`MOCK_REVIEW_RECORD_MISSING: ${activeId}`);
  const original = seedReviewRecords(run).find(item => item.id === record.id);
  const readOnly = reviewIsReadOnly(run);
  const count = records.filter(reviewCanApprove).length;
  const update = (key: string, value: string) => onChange(records.map(item => item.id === record.id ? editReviewRecord(item, key, value) : item));
  const visibleFields = record.fields.filter(item => !(record.kind === "contact" && reviewValue(record, "sameAddress") === "true" && ["street", "city", "state", "zip", "country"].includes(item.key)));
  const identity = visibleFields.filter(item => ["employeeId", "firstName", "lastName"].includes(item.key));
  const extracted = visibleFields.filter(item => !identity.includes(item) && !item.readOnly);
  const results = visibleFields.filter(item => item.readOnly);
  const renderField = (item: ReviewField) => {
    const changed = original?.fields.find(field => field.key === item.key)?.value !== item.value;
    if (readOnly || item.readOnly) return <dl key={item.key} className="m-0 min-w-0"><dt className="text-caption text-ui-muted">{item.label}</dt><dd className="m-0 mt-1 break-words text-body">{item.kind === "boolean" ? item.value === "true" ? "Yes" : "No" : item.value || "—"}</dd></dl>;
    if (item.kind === "boolean") return <div key={item.key} className="flex min-h-8 items-center"><Checkbox label={item.label} checked={item.value === "true"} onCheckedChange={value => update(item.key, String(value === true))} /></div>;
    return <Field key={item.key} label={<span className="inline-flex items-center gap-2">{item.label}{changed && original && <span className="text-caption font-normal text-ui-info">Edited</span>}</span>}>
      {item.kind === "relationship" ? <Select aria-label={item.label} value={item.value} onChange={event => update(item.key, event.target.value)}>{REVIEW_RELATIONSHIPS.map(value => <option key={value} value={value}>{value}</option>)}</Select> : <Input ref={item.key === "employeeId" ? identityInput : undefined} aria-label={item.label} name={item.key} spellCheck={item.key === "employeeId" ? false : undefined} type={item.kind === "date" ? "date" : "text"} value={item.value} onChange={event => update(item.key, event.target.value)} />}
    </Field>;
  };
  return <div className="@container/review flex min-h-0 flex-1 flex-col text-ui-primary">
    <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
      <span className="text-caption text-ui-muted">{records.length} {records.length === 1 ? "record" : "records"}{!readOnly && ` · ${count} ready`}</span>
      {!readOnly && <Button variant="secondary" icon={<Plus aria-hidden className="size-4" />} onClick={() => {
        const next = addMockReviewRecord(records); onChange(next); setActiveId(next[next.length - 1].id); setSourceOpen(false);
        requestAnimationFrame(() => identityInput.current?.focus());
      }}>Add record</Button>}
      {readOnly && <Badge tone={run.approved ? "success" : "neutral"}>{run.discarded ? "Discarded" : "Approved"}</Badge>}
    </div>
    <div className="max-h-48 shrink-0 overflow-auto border-y border-ui-stroke">
      <table aria-label="Extracted records" className="w-full border-collapse text-body">
        <thead className="sticky top-0 bg-ui-table text-left text-caption font-normal text-ui-muted"><tr>
          <th className="w-10 py-2 pl-5 font-normal"><span className="sr-only">Include</span></th>
          <th className="px-3 py-2 font-normal">Employee</th><th className="px-3 py-2 font-normal">Employee ID</th><th className="px-3 py-2 font-normal">Page</th><th className="py-2 pr-5 font-normal">Identity</th>
        </tr></thead>
        <tbody>{records.map(item => <tr key={item.id} className={cn("border-t border-ui-stroke", item.id === record.id ? "bg-ui-selected" : "hover:bg-ui-hover")}>
          <td className="py-2 pl-5"><Checkbox label={<span className="sr-only">Include {reviewName(item)}</span>} checked={item.selected} disabled={readOnly || item.unknown} onCheckedChange={selected => onChange(records.map(row => row.id === item.id ? { ...row, selected: selected === true } : row))} /></td>
          <td className="px-3 py-2"><button type="button" aria-pressed={item.id === record.id} onClick={() => { setActiveId(item.id); setSourceOpen(false); }} className={cn("block min-h-8 w-full rounded-sm text-left font-medium", dsFocus)}>{reviewName(item)}</button></td>
          <td className="px-3 py-2 tabular-nums">{reviewValue(item, "employeeId") || "—"}</td><td className="px-3 py-2 tabular-nums">{item.id.startsWith("manual-") ? "—" : item.page}</td>
          <td className="py-2 pr-5 text-caption"><span className={cn("inline-flex items-center gap-1.5", item.match === "matched" ? "text-ui-muted" : "text-ui-warning")}>{item.match === "matched" ? <Check aria-hidden className="size-3.5" /> : <AlertCircle aria-hidden className="size-3.5" />}{item.match === "matched" ? "Matched" : item.match === "manual" ? "Manual" : "Unresolved"}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
    <section aria-label={`Record ${record.id}`} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-4">
      <header className="mb-5 flex items-center gap-3">
        <div className="min-w-0 flex-1"><h3 ref={heading} tabIndex={-1} className={cn("m-0 break-words rounded-sm text-section font-medium", dsFocus)}>{reviewName(record)}</h3><span className="mt-1 block text-caption text-ui-muted">{record.id.startsWith("manual-") ? "Added record" : `Page ${record.page}`}</span></div>
        {original && <Button variant="secondary" icon={<FileText aria-hidden className="size-4" />} aria-expanded={sourceOpen} aria-controls={`source-${record.id}`} onClick={() => setSourceOpen(!sourceOpen)}>Source fields</Button>}
      </header>
      {sourceOpen && original && <aside id={`source-${record.id}`} aria-label={`Source page ${record.page}`} className="mb-5 border-b border-ui-stroke pb-4">
        <h4 className="mb-3 mt-0 text-body font-medium">Extracted source</h4>
        <dl className="m-0 grid grid-cols-3 gap-x-4 gap-y-3">{original.fields.filter(item => !item.readOnly && item.value).map(item => <div key={item.key} className="min-w-0"><dt className="text-caption text-ui-muted">{item.label}</dt><dd className="m-0 mt-1 break-words text-body">{item.kind === "boolean" ? item.value === "true" ? "Yes" : "No" : item.value}</dd></div>)}</dl>
      </aside>}
      <div className="space-y-5">
        {record.warnings.length > 0 && <div role="status" className="rounded-md border border-ui-stroke bg-ui-table px-3 py-2">{record.warnings.map(warning => <p key={warning} className="m-0 text-caption text-ui-warning">{warning}</p>)}</div>}
        <div><h4 className="mb-3 mt-0 text-body font-medium">Identity</h4><div className="grid grid-cols-3 gap-3">{identity.map(renderField)}</div></div>
        {extracted.length > 0 && <div className="border-t border-ui-stroke pt-4"><h4 className="mb-3 mt-0 text-body font-medium">{record.kind === "contact" ? "Emergency contact" : record.kind === "oath" ? "Oath" : record.kind === "i9" ? "I-9 pages" : "Paper forms"}</h4><div className="grid grid-cols-2 gap-3">{extracted.map(renderField)}</div></div>}
        {results.length > 0 && <div className="border-t border-ui-stroke pt-4"><h4 className="mb-3 mt-0 text-body font-medium">{record.kind === "i9" ? "Retention results" : "Verification results"}</h4><div className="grid grid-cols-2 gap-x-4 gap-y-3">{results.map(renderField)}</div></div>}
        {onApprove && record.selected && !reviewCanApprove(record) && <p role="status" className="m-0 text-caption text-ui-warning">Enter an Employee ID of at least five digits to approve this record.</p>}
      </div>
    </section>
    {(onApprove || run.discarded) && <footer className="flex shrink-0 items-center gap-3 border-t border-ui-stroke bg-ui-table px-5 py-3">
      <span className="mr-auto text-caption text-ui-muted">{onApprove ? `${count} selected for approval` : ""}</span>
      <Button onClick={run.discarded ? onRestore : onDiscard}>{run.discarded ? "Undo discard" : "Discard"}</Button>
      {onApprove && <Button variant="primary" disabled={count === 0} onClick={() => { onApprove(); requestAnimationFrame(() => heading.current?.focus()); }}>Approve records</Button>}
    </footer>}
  </div>;
}
