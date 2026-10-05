import { useRef, useState } from "react";
import { FileText, Plus } from "lucide-react";
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
  if (!record) throw new Error(`MOCK_REVIEW_RECORD_MISSING: ${activeId}`);
  const original = seedReviewRecords(run).find(item => item.id === record.id);
  const readOnly = reviewIsReadOnly(run);
  const approval = onApprove !== undefined;
  const count = records.filter(reviewCanApprove).length;
  const update = (key: string, value: string) => onChange(records.map(item => item.id === record.id ? editReviewRecord(item, key, value) : item));
  const visibleFields = record.fields.filter(item => !(record.kind === "contact" && reviewValue(record, "sameAddress") === "true" && ["street", "city", "state", "zip", "country"].includes(item.key)));
  const identity = visibleFields.filter(item => ["employeeId", "firstName", "lastName"].includes(item.key));
  const extracted = visibleFields.filter(item => !identity.includes(item) && !item.readOnly);
  const results = visibleFields.filter(item => item.readOnly);
  const renderField = (item: ReviewField) => {
    const changed = original?.fields.find(field => field.key === item.key)?.value !== item.value;
    if (readOnly || item.readOnly) return <dl key={item.key} className="m-0 min-w-0"><dt className="text-caption text-ui-muted">{item.label}</dt><dd className="m-0 mt-1 break-words text-body">{item.kind === "boolean" ? item.value === "true" ? "Yes" : "No" : item.value || "—"}</dd></dl>;
    if (item.kind === "boolean") return <div key={item.key} className="col-span-2 flex min-h-8 items-center"><Checkbox label={item.label} checked={item.value === "true"} onCheckedChange={value => update(item.key, String(value === true))} /></div>;
    return <Field key={item.key} className={item.key === "employeeId" ? "col-span-2 @min-[44rem]/review:col-span-1" : undefined} label={<span className="inline-flex items-center gap-2">{item.label}{changed && original && <span className="text-caption font-normal text-ui-info">Edited</span>}</span>}>
      {item.kind === "relationship" ? <Select aria-label={item.label} value={item.value} onChange={event => update(item.key, event.target.value)}>{REVIEW_RELATIONSHIPS.map(value => <option key={value} value={value}>{value}</option>)}</Select> : <Input ref={item.key === "employeeId" ? identityInput : undefined} aria-label={item.label} name={item.key} spellCheck={item.key === "employeeId" ? false : undefined} type={item.kind === "date" ? "date" : "text"} value={item.value} onChange={event => update(item.key, event.target.value)} />}
    </Field>;
  };
  return <div className="@container/review flex min-h-0 flex-1 flex-col overflow-hidden">
    <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] @min-[44rem]/review:grid-cols-[11rem_minmax(0,1fr)] @min-[44rem]/review:grid-rows-1">
      <nav aria-label="Extracted records" className="flex min-w-0 items-center gap-2 border-b border-ui-stroke bg-ui-canvas p-3 @min-[44rem]/review:flex-col @min-[44rem]/review:items-stretch @min-[44rem]/review:border-r @min-[44rem]/review:border-b-0">
        <div className="hidden items-center justify-between gap-2 text-caption text-ui-muted @min-[44rem]/review:flex"><span>{records.length} {records.length === 1 ? "record" : "records"}</span>{approval && <span>{records.filter(item => item.selected && !item.unknown).length} selected</span>}</div>
        <ul className="m-0 flex min-w-0 flex-1 list-none gap-2 overflow-x-auto p-0 @min-[44rem]/review:flex-none @min-[44rem]/review:flex-col">{records.map(item => <li key={item.id} className="max-w-56 shrink-0 @min-[44rem]/review:shrink">
          <button type="button" aria-pressed={item.id === record.id} onClick={() => { setActiveId(item.id); setSourceOpen(false); }} className={cn("min-h-11 w-full rounded-md border px-3 py-2 text-left hover:bg-ui-hover", dsFocus, item.id === record.id ? "border-ui-stroke-control bg-ui-selected" : "border-transparent")}>
            <span className="block truncate text-body font-medium">{reviewName(item)}</span><span className="mt-0.5 block text-caption text-ui-muted">{reviewValue(item, "employeeId") || "No Employee ID"}</span>
          </button>
        </li>)}</ul>
        {!readOnly && <Button size="sm" variant="ghost" className="shrink-0 @min-[44rem]/review:self-start" icon={<Plus aria-hidden className="size-4" />} onClick={() => {
          const next = addMockReviewRecord(records); onChange(next); setActiveId(next[next.length - 1].id); setSourceOpen(false);
          requestAnimationFrame(() => identityInput.current?.focus());
        }}>Add record</Button>}
      </nav>
      <section aria-label={`Record ${record.id}`} className="min-h-0 min-w-0 overflow-y-auto">
        <header className="flex min-h-12 flex-wrap items-center gap-3 border-b border-ui-stroke px-4 py-3">
          <div className="min-w-0 flex-1"><h3 ref={heading} tabIndex={-1} className={cn("m-0 break-words rounded-sm text-section font-medium", dsFocus)}>{reviewName(record)}</h3><span className="mt-1 block text-caption text-ui-muted">{record.id.startsWith("manual-") ? "Added record" : `Page ${record.page}`} · {record.match === "manual" ? "Manual identity" : record.match === "matched" ? "Matched identity" : "Identity unresolved"}</span></div>
          {approval && <Checkbox label="Include in approval" checked={record.selected} disabled={record.unknown} onCheckedChange={selected => onChange(records.map(item => item.id === record.id ? { ...item, selected: selected === true } : item))} />}
          {original && <Button size="sm" variant="ghost" icon={<FileText aria-hidden className="size-4" />} aria-expanded={sourceOpen} aria-controls={`source-${record.id}`} onClick={() => setSourceOpen(!sourceOpen)}>Source fields</Button>}
          {readOnly && <Badge tone="neutral">{run.discarded ? "Discarded" : run.approved && run.role !== "person" ? "Approved" : "Read only"}</Badge>}
        </header>
        {sourceOpen && original && <aside id={`source-${record.id}`} aria-label={`Source page ${record.page}`} className="border-b border-ui-stroke bg-ui-canvas px-4 py-3">
          <p className="mb-3 mt-0 flex items-center gap-2 text-caption text-ui-muted"><FileText aria-hidden className="size-4" /><span className="min-w-0 break-words">{run.draft.files.map(file => file.name).join(", ")} · Page {record.page}</span></p>
          <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-3">{original.fields.filter(item => !item.readOnly && item.value).map(item => <div key={item.key} className="min-w-0"><dt className="text-caption text-ui-muted">{item.label}</dt><dd className="m-0 mt-1 break-words text-body">{item.kind === "boolean" ? item.value === "true" ? "Yes" : "No" : item.value}</dd></div>)}</dl>
        </aside>}
        <div className="space-y-5 p-4">
          {record.warnings.length > 0 && <div role="status" className="border-l-2 border-ui-warning pl-3">{record.warnings.map(warning => <p key={warning} className="m-0 text-caption text-ui-warning">{warning}</p>)}</div>}
          <div><h4 className="mb-3 mt-0 text-caption font-medium text-ui-muted">Identity</h4><div className="grid grid-cols-2 gap-3 @min-[44rem]/review:grid-cols-3">{identity.map(renderField)}</div></div>
          {extracted.length > 0 && <div><h4 className="mb-3 mt-0 text-caption font-medium text-ui-muted">{record.kind === "contact" ? "Emergency contact" : record.kind === "oath" ? "Oath" : record.kind === "i9" ? "I-9 pages" : "Paper forms"}</h4><div className="grid grid-cols-2 gap-3">
            {record.kind === "oath" && !readOnly ? <>{extracted.filter(item => item.kind !== "boolean").map(renderField)}<div role="group" aria-label="Signatures" className="col-span-2 flex flex-wrap gap-x-5 gap-y-2">{extracted.filter(item => item.kind === "boolean").map(renderField)}</div></> : extracted.map(renderField)}
          </div></div>}
          {results.length > 0 && <div><h4 className="mb-3 mt-0 text-caption font-medium text-ui-muted">{record.kind === "i9" ? "Retention results" : "Verification results"}</h4><div className="grid grid-cols-2 gap-x-4 gap-y-4">{results.map(renderField)}</div></div>}
          {approval && record.selected && !reviewCanApprove(record) && <p role="status" className="m-0 text-caption text-ui-warning">Enter an Employee ID of at least five digits to approve this record.</p>}
        </div>
      </section>
    </div>
    {(approval || run.discarded) && <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-ui-stroke bg-ui-table px-4 py-3">
      <span className="mr-auto text-caption text-ui-muted">{approval ? `${count} of ${records.length} ready` : ""}</span>
      <Button size="sm" onClick={run.discarded ? onRestore : onDiscard}>{run.discarded ? "Undo discard" : "Discard"}</Button>
      {approval && <Button size="sm" variant="primary" disabled={count === 0} onClick={() => { onApprove(); requestAnimationFrame(() => heading.current?.focus()); }}>Approve records</Button>}
    </footer>}
  </div>;
}
