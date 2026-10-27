import { SkeletonText } from "../../shared/loading/loading.js";
import { useRef, useState } from "react";
import { Check, Clock, ImageOff, PauseCircle, ScanSearch, TriangleAlert, UserRoundSearch } from "lucide-react";
import { Button, DateInput, Dialog, DialogBody, DialogContent, Field, Input } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { decisionAnswerValid, LOG_DECISION_STATUS, type LogDecision, type LogDecisionAction, type LogDecisionAnswer } from "./log-decision-model.js";
import { LogScreenshots } from "./log-screenshots.js";
import "./log-presentation.css";

function DecisionForm({ action, onSubmit, onCalendarOpenChange }: { action: LogDecisionAction; onSubmit: (answer: LogDecisionAnswer) => void; onCalendarOpenChange: (open: boolean) => void }) {
  const [answer, setAnswer] = useState<LogDecisionAnswer>({});
  const input = action.input;
  if (!input) throw new Error("log-decision-form-input-missing");
  return <form className="log-decision-form" onSubmit={event => { event.preventDefault(); if (decisionAnswerValid(action, answer)) onSubmit(answer); }}>
    {input.kind === "verification" && <><fieldset><legend>{input.question}</legend>{([["present", "Yes, it was submitted"], ["absent", "No, it was not submitted"]] as const).map(([value, label]) => <label key={value} className="log-decision-choice"><input type="radio" name="outcome" value={value} checked={answer.outcome === value} required onChange={() => setAnswer({ outcome: value })} /><span><strong>{label}</strong></span></label>)}</fieldset>{answer.outcome === "present" && <Field label="Transaction number" required><Input value={answer.transaction ?? ""} required onChange={event => setAnswer({ ...answer, transaction: event.target.value })} placeholder="Enter the submitted transaction number" /></Field>}</>}
    {input.kind === "candidate" && <fieldset><legend>{input.question}</legend>{input.candidates.map(candidate => <label key={candidate.id} className="log-decision-choice"><input type="radio" name="candidate" value={candidate.id} checked={answer.candidate === candidate.id} required onChange={() => setAnswer({ candidate: candidate.id })} /><span><strong>{candidate.name} · {candidate.id}</strong><span>{candidate.description}</span></span></label>)}</fieldset>}
    {input.kind === "text" && <Field label={input.label} required><Input value={answer.text ?? ""} required placeholder={input.placeholder} onChange={event => setAnswer({ text: event.target.value })} /></Field>}
    {input.kind === "date" && <DateInput label={input.label} value={answer.date ?? ""} required onOpenChange={onCalendarOpenChange} onChange={date => setAnswer({ date })} />}
    <div className="log-decision-form-actions"><span>{input.kind === "text" ? (decisionAnswerValid(action, answer) ? input.hint ?? "Ready to continue" : `${input.label} required`) : decisionAnswerValid(action, answer) ? "Ready to continue" : input.kind === "date" ? "Date required" : input.kind === "candidate" ? "No candidate selected" : "Choose the result to continue"}</span><Button type="submit" variant="primary" disabled={!decisionAnswerValid(action, answer)}>Continue run</Button></div>
  </form>;
}
export function LogDecisionBlock({ decision, onAction }: { decision: LogDecision; onAction?: (action: LogDecisionAction, answer: LogDecisionAnswer) => void }) {
  const [active, setActive] = useState<LogDecisionAction>();
  const [calendarOpen, setCalendarOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const status = LOG_DECISION_STATUS[decision.state];
  const Icon = decision.state === "parked" ? PauseCircle : decision.state === "failed" ? TriangleAlert : decision.state === "review" ? UserRoundSearch : decision.state === "loading" ? Clock : ScanSearch;
  return <Dialog open={active !== undefined} onOpenChange={open => { if (!open) { setActive(undefined); setCalendarOpen(false); } }}><article className="log-decision" aria-label={decision.title} data-decision-state={decision.state}>
    <header className="log-decision-header"><h4>{decision.title}</h4><span className={cn("log-decision-badge", status.className)}><Icon aria-hidden className="size-3.5" />{status.label}</span></header>
    <div className="log-decision-body">
      {decision.state === "loading" ? <div className="log-decision-loading" role="status" aria-label={decision.title}><SkeletonText className="w-4/5 text-body" /><SkeletonText className="w-3/5 text-body" /></div> : <>
        {decision.message && <p className={decision.state === "failed" ? "text-ui-danger" : decision.state === "review" ? "text-ui-info" : undefined}>{decision.message}</p>}
        {decision.attemptedAction && <p className="log-attempted">While trying to <strong>{decision.attemptedAction}</strong></p>}
        {decision.lastCompleted && <p className="log-last-completed"><Check aria-hidden className="size-3" />Last completed · {decision.lastCompleted}</p>}
        {decision.field && <div className="log-failed-field"><span>{decision.field.label}</span><strong>{decision.field.value}</strong><span>{decision.field.outcome}</span></div>}
        {decision.caution && <p className="log-caution">{decision.caution}</p>}
        {decision.comparison && <div className="log-comparison-frame"><table className="log-comparison" aria-label="Expected and observed values"><thead><tr><th scope="col">Field</th><th scope="col">Expected</th><th scope="col">Observed</th></tr></thead><tbody>{decision.comparison.map(row => <tr key={row.label} className={row.expected !== row.observed ? "different" : undefined}><th scope="row">{row.label}</th><td>{row.expected}</td><td>{row.observed}</td></tr>)}</tbody></table></div>}
        {decision.screenshots && <LogScreenshots screenshots={decision.screenshots} />}
        {decision.unavailableCapture && <div className="log-capture-unavailable"><ImageOff aria-hidden className="size-4" />{decision.unavailableCapture}</div>}
      </>}
    </div>
    {(decision.footer || decision.actions?.length) && <footer className="log-decision-footer"><span>{decision.footer}</span><div className="log-decision-actions">{decision.actions?.map(action => <Button key={action.id} size="sm" variant={action.primary ? "primary" : "secondary"} disabled={onAction === undefined} onClick={event => { opener.current = event.currentTarget; if (action.input) setActive(action); else onAction?.(action, {}); }}>{action.label}</Button>)}</div></footer>}
  </article><DialogContent title={active?.label ?? decision.title} description={<span className="sr-only">Run continuation</span>} className="ui-theme-scope font-ui text-ui-primary" onEscapeKeyDown={event => { if (calendarOpen) event.preventDefault(); }} onCloseAutoFocus={event => { event.preventDefault(); opener.current?.focus(); }}><DialogBody>{active && <DecisionForm key={active.id} action={active} onCalendarOpenChange={setCalendarOpen} onSubmit={answer => { onAction?.(active, answer); setActive(undefined); }} />}</DialogBody></DialogContent></Dialog>;
}
