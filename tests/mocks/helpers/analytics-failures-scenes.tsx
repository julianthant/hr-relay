import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { BodySection, DsBodyScope, IconButton, TooltipProvider, dsIcon } from "../../../src/dashboard/ds/ui.js";
import { RunList, RunListRow } from "../../../src/dashboard/ds/primitives/run-list.js";

/** "Why runs failed" grouped by failure class: three structure variants on synthetic data, hosted with real components. */
export const FAILURE_VARIANTS = ["accordion", "share-bars", "drill-in"] as const;
export const FAILURE_CASES = ["full", "single", "none"] as const;
export const FAILURE_STATES = ["closed", "open"] as const;
export type FailureVariant = typeof FAILURE_VARIANTS[number];
export type FailureCase = typeof FAILURE_CASES[number];
export type FailureState = typeof FAILURE_STATES[number];

interface WorkflowHit { workflow: string; text: string; runs: number; people: readonly string[] }
interface FailureClass { id: string; label: string; hits: readonly WorkflowHit[] }

const PEOPLE = ["Dana Whitfield", "Marcus Oyelaran", "Priya Raman", "Lena Hartmann", "Tomas Reyes", "Aiko Tanaka", "Grace Okafor", "Noah Lindqvist"];
const SESSION = "Your UCPath session ended before the step finished.";

const CLASSES: readonly FailureClass[] = [
  { id: "signin", label: "Sign-in expired", hits: [
    { workflow: "Separations", text: SESSION, runs: 22, people: PEOPLE.slice(0, 5) },
    { workflow: "Person Lookup", text: SESSION, runs: 11, people: PEOPLE.slice(2, 7) },
    { workflow: "Emergency Contact", text: SESSION, runs: 7, people: PEOPLE.slice(1, 6) },
  ] },
  { id: "page", label: "Page did not load", hits: [
    { workflow: "Separations", text: "UCPath did not open the Job Data page.", runs: 5, people: PEOPLE.slice(0, 5) },
    { workflow: "Onboarding", text: "UCPath did not open the Personal Data page.", runs: 4, people: PEOPLE.slice(3, 7) },
  ] },
  { id: "input", label: "Input problem", hits: [
    { workflow: "Emergency Contact", text: "The employee ID is missing from the spreadsheet row.", runs: 4, people: PEOPLE.slice(0, 4) },
    { workflow: "Onboarding", text: "The start date is not a date.", runs: 2, people: PEOPLE.slice(5, 7) },
  ] },
  { id: "other", label: "Other failures", hits: [
    { workflow: "Person Lookup", text: "Relay could not tell what went wrong.", runs: 1, people: PEOPLE.slice(4, 5) },
    { workflow: "Onboarding", text: "Relay could not tell what went wrong.", runs: 1, people: PEOPLE.slice(7, 8) },
  ] },
];
const SINGLE: readonly FailureClass[] = [{ id: "page", label: "Page did not load", hits: [{ workflow: "Separations", text: "UCPath did not open the Job Data page.", runs: 1, people: [PEOPLE[0]!] }] }];

export const classesFor = (scene: FailureCase): readonly FailureClass[] => scene === "full" ? CLASSES : scene === "single" ? SINGLE : [];
const total = (hits: readonly WorkflowHit[]) => hits.reduce((n, hit) => n + hit.runs, 0);
const runWord = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;
const workflowsOf = (cls: FailureClass) => cls.hits.map(hit => hit.workflow).join(", ");
const sumAll = (classes: readonly FailureClass[]) => classes.reduce((n, cls) => n + total(cls.hits), 0);

const SCENE_CSS = `
.af-root.ds-body-scope{max-width:none;margin:0}
.af-root{box-sizing:border-box;width:100vw;min-height:100vh;padding:24px;background:var(--ds-surface-0, var(--background));color:var(--ds-fg)}
.af-root *{box-sizing:border-box}
.af-wrap{max-width:960px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.af-count{white-space:nowrap;font-size:13px;font-variant-numeric:tabular-nums;color:var(--ds-fg)}
.af-sub{font-size:12px;color:var(--ds-fg-secondary);line-height:16px}
.af-hit{display:flex;justify-content:space-between;gap:16px;padding:8px 0 8px 40px;border-top:1px solid var(--ds-stroke, rgba(128,128,128,.25));font-size:13px}
.af-hit small{display:block;color:var(--ds-fg-secondary);font-size:12px;margin-top:2px}
.af-link{display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;padding:0;color:var(--ds-fg);font-size:13px;cursor:pointer}
.af-link:hover{text-decoration:underline}
.af-bar{flex:none;height:6px;border-radius:3px;background:color-mix(in srgb,var(--ds-fg) 14%,transparent);overflow:hidden;width:160px}
.af-bar>span{display:block;height:100%;background:var(--chart-failed, #d4574e)}
.af-share{display:flex;flex:none;align-items:center;justify-content:flex-end;gap:12px}.af-share .af-count{min-width:64px;text-align:right}
.af-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.af-chip{font-size:12px;padding:2px 8px;border-radius:999px;background:var(--ds-surface-2);color:var(--ds-fg-secondary)}
.af-back{display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;padding:0 0 8px;font-size:13px;color:var(--ds-fg);cursor:pointer}
.af-empty{margin:0;font-size:13px;color:var(--ds-fg-secondary)}
.af-btn{border:0;background:transparent;padding:0;text-align:left;width:100%;cursor:pointer;color:inherit;font:inherit}
`;
function SceneStyle() { return <style>{SCENE_CSS}</style>; }
const noop = () => undefined;
const openRuns = (label: string) => <button type="button" className="af-link" onClick={noop}>Open runs <ArrowUpRight aria-hidden className={dsIcon.md} /><span className="sr-only"> for {label}</span></button>;

function Chevron({ open, label, onClick }: { open: boolean; label: string; onClick: () => void }) {
  return <IconButton size="xs" label={`${open ? "Hide" : "Show"} ${label}`} aria-expanded={open} onClick={onClick} icon={<ChevronRight aria-hidden className={`size-5 ${open ? "rotate-90" : ""}`} />} />;
}

function useOpen(state: FailureState, classes: readonly FailureClass[]) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set(state === "open" && classes[0] ? [classes[0].id] : []));
  return { open, toggle: (id: string) => setOpen(current => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; }) };
}

/** Variant 1: one row per class with its count and the workflows it hit; open a class to see each workflow's text and count. */
function Accordion({ classes, state }: { classes: readonly FailureClass[]; state: FailureState }) {
  const { open, toggle } = useOpen(state, classes);
  return <RunList label="Why runs failed">{classes.map(cls => {
    const isOpen = open.has(cls.id);
    return <RunListRow key={cls.id} title={cls.label} description={workflowsOf(cls)} lead={<Chevron open={isOpen} label={`${cls.label} details`} onClick={() => toggle(cls.id)} />}
      below={isOpen ? <div>{cls.hits.map(hit => <div key={hit.workflow} className="af-hit"><span>{hit.workflow}<small>{hit.text}</small></span><span className="flex items-center gap-4"><span className="af-count">{runWord(hit.runs)}</span>{openRuns(hit.workflow)}</span></div>)}</div> : undefined}>
      <span className="af-count">{runWord(total(cls.hits))}</span></RunListRow>;
  })}</RunList>;
}

/** Variant 2: the same grouping with each class's share of failed runs drawn beside its count; open a class for per-workflow shares and the latest people. */
function ShareBars({ classes, state }: { classes: readonly FailureClass[]; state: FailureState }) {
  const { open, toggle } = useOpen(state, classes);
  const all = sumAll(classes);
  const percent = (n: number) => `${Math.max(1, Math.round(n / all * 100))}%`;
  return <RunList label="Why runs failed">{classes.map(cls => {
    const isOpen = open.has(cls.id), count = total(cls.hits);
    return <RunListRow key={cls.id} title={cls.label} description={`${cls.hits.length} ${cls.hits.length === 1 ? "workflow" : "workflows"} · ${percent(count)} of failed runs`} lead={<Chevron open={isOpen} label={`${cls.label} details`} onClick={() => toggle(cls.id)} />}
      below={isOpen ? <div>{cls.hits.map(hit => <div key={hit.workflow} className="af-hit"><span>{hit.workflow}<small>{hit.text}</small><span className="af-chips">{hit.people.map(person => <span key={person} className="af-chip">{person}</span>)}{hit.runs > hit.people.length && <span className="af-chip">+{hit.runs - hit.people.length} more</span>}</span></span><span className="af-share"><span className="af-bar" aria-hidden><span style={{ width: `${hit.runs / count * 100}%` }} /></span><span className="af-count">{runWord(hit.runs)}</span></span></div>)}</div> : undefined}>
      <span className="af-share"><span className="af-bar" aria-hidden><span style={{ width: `${count / all * 100}%` }} /></span><span className="af-count">{runWord(count)}</span></span></RunListRow>;
  })}</RunList>;
}

/** Variant 3: a short list of classes; choosing one replaces the list with that class's workflows and runs, with a way back. */
function DrillIn({ classes, state }: { classes: readonly FailureClass[]; state: FailureState }) {
  const [picked, setPicked] = useState<string | null>(state === "open" ? classes[0]?.id ?? null : null);
  const cls = classes.find(item => item.id === picked);
  if (cls) return <div>
    <button type="button" className="af-back" onClick={() => setPicked(null)}><ChevronLeft aria-hidden className={dsIcon.md} />All failures</button>
    <RunList title={cls.label} description={`${runWord(total(cls.hits))} across ${cls.hits.length} ${cls.hits.length === 1 ? "workflow" : "workflows"}`} label={`${cls.label} runs`}>{cls.hits.map(hit =>
      <RunListRow key={hit.workflow} title={hit.workflow} description={hit.text}
        below={<div className="af-chips" style={{ marginTop: 0 }}>{hit.people.map(person => <span key={person} className="af-chip">{person}</span>)}{hit.runs > hit.people.length && <span className="af-chip">+{hit.runs - hit.people.length} more</span>}</div>}>
        <span className="af-count">{runWord(hit.runs)}</span>{openRuns(hit.workflow)}</RunListRow>)}</RunList>
  </div>;
  return <RunList label="Why runs failed">{classes.map(item => <RunListRow key={item.id} title={<button type="button" className="af-btn" onClick={() => setPicked(item.id)} aria-label={`Open ${item.label}`}>{item.label}</button>} description={workflowsOf(item)}>
    <span className="af-count">{runWord(total(item.hits))}</span><ChevronRight aria-hidden className={dsIcon.md} /></RunListRow>)}</RunList>;
}

export function FailuresScenePage({ variant, scene, state }: { variant: FailureVariant; scene: FailureCase; state: FailureState }) {
  const classes = classesFor(scene);
  const all = sumAll(classes);
  const description = all === 0 ? undefined : `${runWord(all)} failed in this period, in ${classes.length} ${classes.length === 1 ? "kind" : "kinds"} of failure.`;
  return <TooltipProvider><SceneStyle /><DsBodyScope className="af-root"><div className="af-wrap">
    <BodySection title="Why runs failed" description={description ?? "Failed runs in this period."}>
      {all === 0 ? <p className="af-empty">No runs failed in this period</p>
        : variant === "accordion" ? <Accordion classes={classes} state={state} />
        : variant === "share-bars" ? <ShareBars classes={classes} state={state} />
        : <DrillIn classes={classes} state={state} />}
    </BodySection>
  </div></DsBodyScope></TooltipProvider>;
}

function parseOption<T extends string>(value: string | null, options: readonly T[], name: string): T {
  const match = options.find(option => option === value);
  if (match === undefined) throw new Error(`analytics-failures-${name}-invalid:${String(value)}`);
  return match;
}

/** Browser entry: variant, case, state and theme come from the URL. */
export function mountFailuresScene(): void {
  const query = new URLSearchParams(location.search);
  const theme = query.get("theme") === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-demo-theme", theme);
  document.body.setAttribute("data-demo-theme", theme);
  const root = document.getElementById("root");
  if (root === null) throw new Error("analytics-failures-root-missing");
  createRoot(root).render(<FailuresScenePage variant={parseOption(query.get("variant"), FAILURE_VARIANTS, "variant")} scene={parseOption(query.get("case"), FAILURE_CASES, "case")} state={parseOption(query.get("state"), FAILURE_STATES, "state")} />);
}
