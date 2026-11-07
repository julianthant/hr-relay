import { useState, type ReactNode } from "react";
import { ArrowUpRight, CheckCheck, CircleStop, Eye, LockKeyhole, Monitor, MousePointer2, PencilLine } from "lucide-react";
import { PageHeading, Select, dsFocus } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { DataTable, PageCard } from "./decision-mock-logs.js";
import { MOCK_SCENES } from "./decision-mock-model.js";
import { DecisionCard } from "../logs/decision-card.js";

type Outcome = Readonly<{ value: string; label: string; then: string; stops?: boolean }>;
const SEARCH: readonly Outcome[] = [
  { value: "one", label: "One person found", then: "Continues to Cross-check identity." },
  { value: "several", label: "Several people match", then: "Waits for you to pick one in Logs, then continues." },
  { value: "none", label: "Nobody found", then: "The run ends as Not found.", stops: true },
  { value: "down", label: "UCPath does not load", then: "The run stops with a failure card.", stops: true },
  { value: "other", label: "Anything else", then: "The run stops with a failure card.", stops: true },
];
const CRM: readonly Outcome[] = [
  { value: "agree", label: "Records agree", then: "Continues to Read employment status." },
  { value: "differ", label: "Records differ", then: "The run ends as Undetermined.", stops: true },
  { value: "missing", label: "No CRM record", then: "Continues without the CRM check." },
  { value: "other", label: "Anything else", then: "The run stops with a failure card.", stops: true },
];

const STATUS: readonly Outcome[] = [
  { value: "active", label: "Active", then: "The run ends as Active." },
  { value: "inactive", label: "Inactive", then: "The run ends as Inactive." },
  { value: "missing", label: "Not found", then: "The run ends as Not found." },
  { value: "other", label: "Anything else", then: "The run stops with a failure card.", stops: true },
];

type Choices = Readonly<{ path: string; by: string; crm: string; dates: string }>;
const OPTIONS: readonly [keyof Choices, string, readonly (readonly [string, string])[]][] = [
  ["path", "Lookup path", [["search", "Search"], ["match", "Match"]]],
  ["by", "Search by", [["name", "Name"], ["eid", "Employee ID"]]],
  ["crm", "CRM cross-check", [["on", "On"], ["off", "Off"]]],
  ["dates", "CRM dates", [["none", "Not requested"], ["requested", "Requested"]]],
];

function FillRow({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-ui-stroke last:border-b-0"><button type="button" aria-label={`Show source for ${label}`} className={`grid w-full grid-cols-[1rem_minmax(9rem,1fr)_minmax(11rem,1fr)] items-start gap-2.5 py-1.5 text-left text-body hover:bg-ui-hover ${dsFocus}`}>
    <PencilLine aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-info" /><span className="self-center">{label}</span>
    <span className="flex min-h-7 min-w-0 items-center justify-between gap-2 self-center rounded-md border border-ui-stroke-control bg-ui-field px-2.5 py-1 text-ui-info">{value}<ArrowUpRight aria-hidden className="size-3.5 shrink-0" /></span>
  </button></div>;
}
function ReadRow({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[1rem_minmax(9rem,1fr)_minmax(11rem,1fr)] items-start gap-2.5 border-b border-ui-stroke py-2 text-body last:border-b-0"><Eye aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-muted" /><span className="self-center">{label}</span><span className="self-center text-right text-ui-secondary">{value}</span></div>;
}
function Card({ title, mode, children }: { title: string; mode: string; children: ReactNode }) {
  return <PageCard title={title} mode={mode}><div className="px-4 py-1.5">{children}</div></PageCard>;
}
function Check({ children }: { children: ReactNode }) {
  return <p className="m-0 flex items-center gap-2.5 text-body text-ui-secondary"><CheckCheck aria-hidden className="size-3.5 shrink-0 text-ui-positive" />{children}</p>;
}
function Click({ children }: { children: ReactNode }) {
  return <p className="m-0 flex items-center gap-2.5 text-body text-ui-secondary"><MousePointer2 aria-hidden className="size-3.5 shrink-0 text-ui-muted" /><span>Clicks <span className="font-medium text-ui-primary">{children}</span></span></p>;
}

/** The decision point: the outcomes declared here, one chosen, and what follows. */
function Decision({ label, outcomes, value, onChange }: { label: string; outcomes: readonly Outcome[]; value: string; onChange: (value: string) => void }) {
  const outcome = outcomes.find(item => item.value === value) ?? outcomes[0];
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
    <Select aria-label={label} className="w-60" value={outcome.value} onChange={event => onChange(event.target.value)}>{outcomes.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select>
    {!outcome.stops && <span className="text-body text-ui-secondary">{outcome.then}</span>}
  </div>;
}

type Step = Readonly<{ title: string; system?: string; body: ReactNode }>;

export function DecisionExplorer() {
  const [choices, setChoices] = useState<Choices>({ path: "search", by: "name", crm: "on", dates: "none" });
  const [search, setSearch] = useState("several");
  const [crm, setCrm] = useState("agree");
  const [status, setStatus] = useState("active");
  const statusOutcome = STATUS.find(item => item.value === status) ?? STATUS[0];
  const searchOutcomes = choices.by === "eid" ? SEARCH.filter(item => item.value !== "several") : SEARCH;
  const searchOutcome = searchOutcomes.find(item => item.value === search) ?? searchOutcomes[0];
  const crmOutcome = CRM.find(item => item.value === crm) ?? CRM[0];
  const pick = MOCK_SCENES.d2.decision?.kind === "card" ? MOCK_SCENES.d2.decision.control : undefined;
  if (pick?.kind !== "pick") throw new Error("DECISION_MOCK_D2_PICK_MISSING");
  const people = pick.table;
  const decision = (key: "search" | "crm") => key === "search"
    ? <Decision label="Search result" outcomes={searchOutcomes} value={searchOutcome.value} onChange={setSearch} />
    : <Decision label="CRM cross-check result" outcomes={CRM} value={crmOutcome.value} onChange={setCrm} />;
  const steps: Step[] = [{ title: "Open browser sessions", body: <div className="flex flex-wrap gap-2">{["UCPath", "CRM"].filter(system => system !== "CRM" || choices.crm === "on").map(system => <span key={system} className="flex h-9 items-center gap-2 rounded-md border border-ui-stroke bg-ui-table px-3 text-body"><Monitor aria-hidden className="size-4 text-ui-muted" />{system}<LockKeyhole aria-hidden className="ml-2 size-3 text-ui-muted" /></span>)}</div> }];
  steps.push({ title: "Search for person", system: "UCPath", body: <>
    <p className="m-0 text-body text-ui-secondary">Searches UCPath by {choices.by === "eid" ? "employee ID" : "name"}.</p>
    <Check>Keeps HDH departments only</Check>
    <Card title="Person Organizational Summary" mode="Fill">{choices.by === "eid" ? <FillRow label="Employee ID" value="10000001" /> : <><FillRow label="Last name" value="Morrow" /><FillRow label="First name" value="Bea" /></>}</Card>
    <Click>Search</Click>
    {searchOutcome.value === "several" ? <DecisionCard preview title="Which Bea Morrow is this run about?" context="Logs asks you to pick one, or to type the employee ID."><DataTable table={{ ...people, label: "Sample search results" }} pick={{ choose: () => undefined }} /></DecisionCard> : <Card title="Search results" mode="Read">{searchOutcome.value === "one" ? <><ReadRow label="Employee ID" value="10000001" /><ReadRow label="Name" value="Morrow, Bea A." /><ReadRow label="Department" value="Campus Dining Operations" /></> : <ReadRow label="Results" value={searchOutcome.value === "none" ? "No people found" : "Not read"} />}</Card>}
    {decision("search")}
  </> });
  if (!searchOutcome.stops) {
    if (choices.crm === "on") steps.push({ title: "Cross-check identity", system: "CRM", body: <>
      <p className="m-0 text-body text-ui-secondary">Compares the person with their CRM onboarding record.</p>
      <Check>Employee ID agrees with UCPath</Check>
      <Card title="CRM onboarding search" mode="Fill"><FillRow label="Name" value="Morrow, Bea A." /></Card>
      {crm !== "missing" && <Card title="CRM onboarding record" mode="Read"><ReadRow label="Employee ID" value={crm === "differ" ? "10000420" : "10000001"} /><ReadRow label="Start date" value="03/14/2031" /></Card>}
      {decision("crm")}
    </> });
    if (choices.crm !== "on" || !crmOutcome.stops) {
      steps.push({ title: "Read employment status", system: "UCPath", body: <>
        <p className="m-0 text-body text-ui-secondary">Reads department, HR status and hire date.</p>
        <Card title="Workforce Job Summary" mode="Read"><ReadRow label="Department" value="Campus Dining Operations" /><ReadRow label="HR status" value={statusOutcome.label === "Anything else" ? "Not read" : statusOutcome.label} /><ReadRow label="Hire date" value="03/14/2031" /></Card>
        <Decision label="Employment status result" outcomes={STATUS} value={statusOutcome.value} onChange={setStatus} />
      </> });
      if (choices.dates === "requested") steps.push({ title: "Read CRM dates", system: "CRM", body: <Card title="CRM onboarding history" mode="Read"><ReadRow label="Employment date" value="03/14/2031" /></Card> });
    }
  }
  const stop = searchOutcome.stops ? searchOutcome : choices.crm === "on" && crmOutcome.stops ? crmOutcome : statusOutcome.stops ? statusOutcome : undefined;
  return <section aria-label="Workflow explorer preview" className="settings-reference-page settings-data-section ui-theme-scope text-ui-primary">
    <PageHeading title="Explorer" description="Browse workflows, their steps and field sources." className="settings-heading-actions" actions={<Select aria-label="Explorer workflow" className="settings-heading-select" value="person-lookup"><option value="person-lookup">Person Lookup</option></Select>} />
    <section aria-labelledby="run-options" className="mb-8 mt-6 border-b border-ui-stroke pb-6">
      <h2 id="run-options" className="m-0 mb-4 ds-text-section font-semibold">Run options</h2>
      <div className="grid grid-cols-4 gap-4">{OPTIONS.map(([key, label, options]) => <div key={key} className="flex min-w-0 flex-col gap-1.5"><span id={`option-${key}`} className="text-body font-medium text-ui-secondary">{label}</span><Select aria-labelledby={`option-${key}`} value={choices[key]} onChange={event => setChoices(current => ({ ...current, [key]: event.target.value }))}>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</Select></div>)}</div>
    </section>
    <ol aria-label="Workflow steps" className="relative m-0 list-none pl-10 before:absolute before:bottom-5 before:left-3.5 before:top-3 before:w-px before:bg-ui-stroke">
      {steps.map((step, index) => <li key={step.title} className="relative border-b border-ui-stroke pb-6 pt-6 first:pt-0 last:border-b-0">
        <span aria-hidden className={cn("absolute -left-10 flex size-7 items-center justify-center rounded-full border border-ui-stroke bg-ui-panel text-caption tabular-nums text-ui-secondary", index === 0 ? "top-0" : "top-6")}>{index + 1}</span>
        <div>
          <div className="min-w-0">
            <div className="mb-3 flex min-h-7 flex-wrap items-center gap-3"><h2 className="m-0 ds-text-section font-semibold">{step.title}</h2>{step.system && <span className="flex items-center gap-1.5 border-l border-ui-stroke pl-3 text-caption text-ui-muted"><Monitor aria-hidden className="size-3.5" />{step.system}</span>}</div>
            <div className="flex min-w-0 flex-col gap-3">{step.body}</div>
          </div>
        </div>
      </li>)}
    </ol>
    {stop && <p className="ml-10 mt-3 flex items-center gap-2.5 border-t border-ui-stroke pt-4 text-body text-ui-danger"><CircleStop aria-hidden className="size-3.5" />{stop.then}</p>}
  </section>;
}
