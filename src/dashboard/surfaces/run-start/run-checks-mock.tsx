import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { BareButton, Badge, BodySection, Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, FormGroup, Input, MetaLine, Spinner, dsFocus } from "../../ds/ui.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { RunWorkflowPicker } from "./run-start-picker.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { useState } from "react";
import { cn } from "../../lib/utils.js";
import "./launch-presentation.css";
import { RUN_CHECKS_KEPT, RUN_CHECKS_STAGES, checkRows, runChecksCounts, runChecksFrame, type RunCheckRow, type RunChecksFrame } from "./run-checks-mock-model.js";

const WORKFLOW = "Person Lookup";

/** The right side of a check row: its state in words, and Fix only where Settings can fix it. */
function RowEnd({ item }: { item: RunCheckRow }) {
  if (item.verdict === "checking") return <span className="flex items-center gap-2 text-body text-ui-secondary"><Spinner label="Checking" className="size-4" />Checking</span>;
  if (item.verdict === "pass") return <span className="flex items-center gap-1.5 text-body text-ui-secondary"><Check aria-hidden className="size-3.5" />Ready</span>;
  return <>
    <Badge tone={item.verdict === "fail" ? "danger" : "warning"}>{item.verdict === "fail" ? "Failed" : "Warning"}</Badge>
    {item.fixSection !== undefined && <Button variant="secondary" aria-label={`Fix ${item.title}`}>Fix</Button>}
  </>;
}

const CheckRow = ({ item }: { item: RunCheckRow }) => <RunListRow title={item.title} description={item.description}><RowEnd item={item} /></RunListRow>;

/** Direction A: the whole list. Every check is a row, so nothing is hidden and the step reads the same every time. */
function ChecksEveryRow({ rows }: { rows: readonly RunCheckRow[] }) {
  const { ready, total, checking } = runChecksCounts(rows);
  const rank = { fail: 0, warning: 1, checking: 2, pass: 3 } as const;
  return <section className="flex flex-col gap-[var(--ds-space-loose)]">
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3"><h3 className="text-heading font-semibold">Before you start</h3><span className="text-caption text-ui-muted">{checking > 0 ? "Checking…" : `${ready} of ${total} ready`}</span></div>
      <p className="text-body text-ui-secondary">What {WORKFLOW} needs. Problems come first.</p>
    </div>
    <RunList label="Checks">{rows.toSorted((a, b) => rank[a.verdict] - rank[b.verdict]).map(item => <CheckRow key={item.title} item={item} />)}</RunList>
  </section>;
}

/** Direction B: the count, then only the problems. A ready workflow shows one line. */
function ChecksCountAndProblems({ rows, again }: { rows: readonly RunCheckRow[]; again: boolean }) {
  const { ready, total, checking } = runChecksCounts(rows);
  const problems = rows.filter(item => item.verdict === "fail" || item.verdict === "warning");
  const pending = rows.filter(item => item.verdict === "checking");
  return <section className="flex flex-col gap-[var(--ds-space-loose)]">
    <div className="flex flex-col gap-1">
      <h3 className="text-heading font-semibold">{checking > 0 ? again ? "Checking again…" : "Checking…" : `${ready} of ${total} checks ready`}</h3>
      <p className="text-body text-ui-secondary">{checking > 0 ? `${WORKFLOW} needs ${total} things to be ready.` : problems.length === 0 ? "Everything this run needs is ready." : "Only what needs attention is listed."}</p>
    </div>
    {checking > 0 && ready === 0 ? <RunList label="Checking"><RunListRow title={`Checking ${total} things`} description="This takes a few seconds."><RowEnd item={pending[0]} /></RunListRow></RunList>
      : [...problems, ...pending].length > 0 && <RunList label="Needs attention" title="Needs attention">{[...problems, ...pending].map(item => <CheckRow key={item.title} item={item} />)}</RunList>}
  </section>;
}

/** Settings opened from a Fix button: a takeover page over the hidden dialog, with the way back at the top. */
function SettingsOverRun() {
  return <div className="fixed inset-0 z-[60] flex flex-col bg-[color:var(--ds-surface-page)]" role="region" aria-label="Settings">
    <header className="flex h-[54px] shrink-0 items-center gap-3 border-b border-ui-stroke px-4">
      <Button variant="ghost" icon={<ArrowLeft aria-hidden className="size-3" />}>Back to run</Button>
      <span aria-hidden className="text-ui-muted">/</span>
      <h2 className="text-body font-semibold">Settings · Credentials</h2>
    </header>
    <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-[var(--ds-space-loose)] overflow-auto px-4 py-6">
      <BodySection title="UCPath" description="Used to sign in to UCPath for runs.">
        <FormGroup label="UCPath sign-in">
          <div className="flex flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-base)]">
            <Field label="UCPath username"><Input defaultValue="hr.operator" /></Field>
            <Field label="UCPath password"><Input type="password" placeholder="Required" /></Field>
            <div><Button variant="primary">Save</Button></div>
          </div>
        </FormGroup>
      </BodySection>
    </div>
  </div>;
}

function RunChecksDialog({ frame, catalog }: { frame: RunChecksFrame; catalog: readonly WorkflowCatalogEntry[] }) {
  const [query, setQuery] = useState("");
  const rerun = frame.kind === "rerun";
  const rows = checkRows(frame.scenario);
  const counts = runChecksCounts(rows);
  const stages = RUN_CHECKS_STAGES[frame.direction][frame.kind];
  const active = stages.indexOf("Checks");
  const blocked = counts.failed > 0 || counts.checking > 0;
  const kept = frame.scenario === "back" || frame.direction === "b" || frame.scenario === "settings";
  const next = stages[active + 1];
  return <Dialog open onOpenChange={() => undefined}>
    <DialogContent size="xl" band title={rerun ? "Rerun" : "Start run"} description={rerun ? `${WORKFLOW} · EID 10000001` : WORKFLOW} className={cn("launch-design launch-dialog", rerun && "launch-rerun")}>
      {!rerun && <RunWorkflowPicker catalog={catalog} value={catalog.find(entry => entry.label === WORKFLOW)?.id ?? ""} onChange={() => undefined} query={query} onQuery={setQuery} />}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ol aria-label="Run configuration path" className="launch-stagebar">
          {stages.map((label, index) => {
            const current = index === active;
            return <li key={label} aria-current={current ? "step" : undefined}>
              <BareButton disabled={index > active} aria-label={`${index + 1} ${label}`} className={dsFocus}>
                <span aria-hidden className="launch-stage-marker" data-current={current || undefined} data-completed={index < active || undefined}>{index < active ? <Check className="size-3" /> : index + 1}</span>
                <span className={cn("text-body", current ? "font-semibold" : "text-ui-secondary")}>{label}</span>
                {label === "Checks" && counts.failed > 0 && <Badge tone="danger">{counts.failed} failed</Badge>}
                {label === "Checks" && counts.failed === 0 && counts.warnings > 0 && <Badge tone="warning">{counts.warnings} {counts.warnings === 1 ? "warning" : "warnings"}</Badge>}
              </BareButton>
            </li>;
          })}
        </ol>
        <DialogBody className="launch-content @container">
          {frame.direction === "a" ? <ChecksEveryRow rows={rows} /> : <ChecksCountAndProblems rows={rows} again={frame.scenario === "back"} />}
        </DialogBody>
      </div>
      <DialogFooter meta={<MetaLine tone="faint" items={[
        WORKFLOW,
        kept ? RUN_CHECKS_KEPT[frame.kind] : undefined,
        counts.failed > 0 ? `${counts.failed} ${counts.failed === 1 ? "check" : "checks"} must pass to continue` : counts.checking > 0 ? "Checking…" : undefined,
      ].filter((item): item is string => item !== undefined)} />}>
        {!blocked && <span className="text-[12px] text-ui-muted">Enter to continue</span>}
        {active > 0 && <Button variant="ghost" icon={<ArrowLeft aria-hidden className="size-3" />}>Back</Button>}
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary" disabled={blocked} iconAfter={<ArrowRight aria-hidden className="size-[14px]" />}>{next === "Confirm" ? "Preview plan" : "Continue"}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

/** Mounted once beside the launcher; renders nothing unless the mock harness asked for a Checks frame. */
export function RunChecksMockHost({ catalog }: { catalog: readonly WorkflowCatalogEntry[] }) {
  const frame = runChecksFrame();
  if (frame === undefined) return null;
  return frame.scenario === "settings" ? <SettingsOverRun /> : <RunChecksDialog frame={frame} catalog={catalog} />;
}
