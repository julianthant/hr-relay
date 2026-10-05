import { CrossDateSearchScopeSchema, CrossDateSearchStateFacetSchema, CrossDateSearchShapeFacetSchema, CrossDateSearchSystemFacetSchema } from "../../../domain/dashboard/search.js";
import { Button, DateRangeInput, Disclosure, Field, Input, Select, dsText } from "../../ds/ui.js";
import type { SearchFilterDraft } from "./search-filters-model.js";

export function SearchFilters({value,onChange}:{value:SearchFilterDraft;onChange:(value:SearchFilterDraft)=>void}) {
  const set=(key:keyof SearchFilterDraft,next:string)=>onChange({...value,[key]:next});
  return <Disclosure className="mt-[var(--ds-space-base)]" summaryClassName={dsText.ui} summary={`Filters · ${Object.values(value).filter(Boolean).length} selected`}>
    <div className="grid grid-cols-3 gap-[var(--ds-space-base)] py-[var(--ds-space-base)]">
      <Field label="Search field"><Select value={value.scope} onChange={event=>set("scope",event.target.value)}><option value="">All metadata</option>{CrossDateSearchScopeSchema.options.filter(scope=>scope!=="all").map(scope=><option key={scope} value={scope}>{scope}</option>)}</Select></Field>
      <DateRangeInput label="Search date range" fromLabel="From" toLabel="To" className="col-span-2" value={{ from: value.from, to: value.to }} onChange={next => onChange({ ...value, ...next })} />
      <Field label="Workflow ID"><Input value={value.workflow} onChange={event=>set("workflow",event.target.value)} placeholder="Any workflow"/></Field>
      <Field label="Subject name"><Input value={value.subject} maxLength={160} onChange={event=>set("subject",event.target.value)} placeholder="Declared name"/></Field>
      <Field label="Actor"><Input value={value.actor} onChange={event=>set("actor",event.target.value)} placeholder="Recorded actor"/></Field>
      <Field label="Status"><Select value={value.state} onChange={event=>set("state",event.target.value)}><option value="">Any status</option>{CrossDateSearchStateFacetSchema.options.map(state=><option key={state}>{state}</option>)}</Select></Field>
      <Field label="Version"><Input type="number" min={1} step={1} value={value.version} onChange={event=>set("version",event.target.value)}/></Field>
      <Field label="Failure code"><Input value={value.failure} onChange={event=>set("failure",event.target.value)} placeholder="Any failure"/></Field>
      <Field label="Evidence"><Select value={value.evidence} onChange={event=>set("evidence",event.target.value)}><option value="">Any evidence</option><option value="receipt">Receipt present</option><option value="failure">Failure present</option><option value="diagnostic">Diagnostic present</option><option value="none">No evidence recorded</option></Select></Field>
      <Field label="Run shape"><Select value={value.shape} onChange={event=>set("shape",event.target.value)}><option value="">Any shape</option>{CrossDateSearchShapeFacetSchema.options.map(shape=><option key={shape}>{shape}</option>)}</Select></Field>
      <Field label="Mode"><Select value={value.dryRun} onChange={event=>set("dryRun",event.target.value)}><option value="">Any mode</option><option value="true">Dry run</option><option value="false">Live</option></Select></Field>
      <Field label="System"><Select value={value.system} onChange={event=>set("system",event.target.value)}><option value="">Any system</option>{CrossDateSearchSystemFacetSchema.options.map(system=><option key={system}>{system}</option>)}</Select></Field>
      <div className="self-end"><Button variant="secondary" size="sm" onClick={()=>onChange(Object.fromEntries(Object.keys(value).map(key=>[key,""])) as SearchFilterDraft)}>Clear filters</Button></div>
    </div>
  </Disclosure>;
}
