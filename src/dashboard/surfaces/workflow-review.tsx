import { Button, Checkbox, Field, Input, Select } from "../ds/ui.js";
import { addMockReviewRecord, reviewCanApprove, reviewIsReadOnly, reviewName, reviewRecords, reviewValue, seedReviewRecords, editReviewRecord, REVIEW_RELATIONSHIPS, type ReviewRecord } from "./workflow-review-model.js";
import type { MockRun } from "./workflow-mock-model.js";

export function WorkflowMockReview({ run, onChange }: { run: MockRun; onChange: (records: readonly ReviewRecord[]) => void }) {
  const records = reviewRecords(run);
  const originals = seedReviewRecords(run);
  const readOnly = reviewIsReadOnly(run);
  const update = (record: ReviewRecord, key: string, value: string) => onChange(records.map(item => item.id === record.id ? editReviewRecord(item, key, value) : item));
  return <div className="space-y-5 p-4">
    <p className="m-0 text-caption text-ui-muted">Fictional extracted records · {run.draft.files.map(file => file.name).join(", ")}. {run.workflowId === "i9-check" ? "Paired I-9 pages and retention results are read only. Rerun appends another tracker row." : run.workflowId === "ocr" ? "Standalone inspection; no downstream approval." : "Review the source fields and select the people to process."}</p>
    {records.map(record => <section key={record.id} aria-label={`Record ${record.id}`} className="overflow-hidden rounded-lg border border-ui-stroke">
      <header className="flex min-h-11 flex-wrap items-center gap-3 border-b border-ui-stroke bg-ui-table px-4 py-2">
        {!readOnly && <Checkbox label={<span className="sr-only">Select {reviewName(record)}</span>} checked={record.selected} disabled={record.unknown} onCheckedChange={selected => onChange(records.map(item => item.id === record.id ? { ...item, selected: selected === true } : item))} />}
        <h3 className="m-0 text-body font-semibold">{reviewName(record)}</h3><span className="ml-auto text-caption text-ui-muted">Page {record.page} · {record.match === "manual" ? "Manual identity" : record.match === "matched" ? "Matched identity" : "Identity unresolved"}</span>
      </header>
      <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] divide-x divide-ui-stroke">
        <aside aria-label={`Fictional source page ${record.page}`} className="bg-ui-canvas p-4">
          <h4 className="mb-4 mt-0 text-caption font-medium text-ui-muted">Fictional source transcription</h4>
          {record.id.startsWith("manual-") ? <p className="text-body text-ui-muted">No source transcription — manually added record.</p> : <dl className="m-0 space-y-3">{originals.find(item => item.id === record.id)?.fields.filter(item => item.value && item.kind !== "boolean").map(item => <div key={item.key}><dt className="text-caption text-ui-muted">{item.label}</dt><dd className="m-0 mt-1 break-words text-body">{item.value}</dd></div>)}</dl>}
        </aside>
        <div className="min-w-0 space-y-3 p-4">
          {record.warnings.map(warning => <p key={warning} className="m-0 text-caption text-ui-warning">{warning}</p>)}
          {record.fields.filter(item => !(record.kind === "contact" && reviewValue(record, "sameAddress") === "true" && ["street", "city", "state", "zip", "country"].includes(item.key))).map(item => readOnly ? <div key={item.key} className="flex flex-wrap justify-between gap-2 border-b border-ui-stroke pb-2 text-body"><span className="text-ui-muted">{item.label}</span><span className="break-words">{item.kind === "boolean" ? item.value === "true" ? "Yes" : "No" : item.value || "—"}</span></div> : item.kind === "boolean" ? <Checkbox key={item.key} label={item.label} checked={item.value === "true"} onCheckedChange={value => update(record, item.key, String(value === true))} /> : <Field key={item.key} label={item.label}>
            {item.kind === "relationship" ? <Select aria-label={item.label} value={item.value} onChange={event => update(record, item.key, event.target.value)}>{REVIEW_RELATIONSHIPS.map(value => <option key={value} value={value}>{value}</option>)}</Select> : <Input type={item.kind === "date" ? "date" : "text"} value={item.value} onChange={event => update(record, item.key, event.target.value)} />}
          </Field>)}
          {!readOnly && record.selected && !reviewCanApprove(record) && <p role="status" className="m-0 text-caption text-ui-warning">This record needs a resolved Employee ID of at least five digits before approval.</p>}
        </div>
      </div>
    </section>)}
    {!readOnly && <Button size="sm" onClick={() => onChange(addMockReviewRecord(records))}>Add record</Button>}
  </div>;
}
