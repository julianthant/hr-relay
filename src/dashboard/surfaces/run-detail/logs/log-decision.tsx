import type { UcpathFoundPresentation, UcpathFoundDecision } from "./ucpath-found-model.js";
import { SkeletonText } from "../../shared/loading/loading.js";
import { useRef, useState } from "react";
import { Check, Clock, ImageOff, PauseCircle, ScanSearch, TriangleAlert, UserRoundSearch } from "lucide-react";
import { Badge, Table, THead, TBody, TR, TH, TD, Button, DateInput, Dialog, DialogBody, DialogContent, Field, Input } from "../../../ds/ui.js";
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

export function UcpathFoundTransactions({ attemptLabel, presentation, onDecision }: {
  attemptLabel: string;
  presentation: UcpathFoundPresentation;
  onDecision?: (decision: UcpathFoundDecision) => void;
}) {
  const [selected, setSelected] = useState("");
  const [transaction, setTransaction] = useState("");
  const found = presentation.state === "found" ? presentation : undefined;
  const row = found?.rows.find(candidate => candidate.transactionNumber === selected);
  const submitted = found?.authoritative === true && row?.match === "exact" && row.detailVerified;
  const absent = found?.complete === true && found.authoritative && found.rows.every(candidate => candidate.match === "different" && candidate.detailVerified);
  const busy = presentation.state === "checking" || presentation.state === "loading";
  const uncertain = found && (!found.complete || !found.authoritative || found.rows.some(candidate => candidate.match === "ambiguous" || !candidate.detailVerified));
  return <section className="log-decision ucpath-found" aria-label="UCPath found transactions">
    <div className="log-decision-body"><h3 className="text-title font-semibold">Did this submit reach UCPath?</h3><p>{attemptLabel}. Relay won’t submit it again.</p>
      {busy && <p role="status">{presentation.state === "loading" ? "Reading transaction list…" : "Checking confirmation again…"}</p>}
      {presentation.state === "unavailable" && <p>Confirmation couldn’t be read. Check again.</p>}
      {found && <><div className="flex items-center justify-between gap-4"><h4 className="font-medium">Found in UCPath</h4><span className="text-caption text-ui-muted">{found.complete ? "Complete list" : "Partial list"}{!found.authoritative && " · authority unverified"}</span></div>
        {uncertain && <p className="text-ui-warning">{!found.complete ? "The list is incomplete. Check again or look up a transaction." : !found.authoritative ? "The list is unverified. Check again." : "These transactions need verification. Check again or look up a transaction."}</p>}
        <Table label="Transactions found in UCPath"><THead><TR><TH><span className="sr-only">Select</span></TH><TH>Transaction</TH><TH>Person</TH><TH>Action</TH><TH>Submitted</TH><TH>Match</TH></TR></THead><TBody>{found.rows.map(candidate => <TR key={candidate.transactionNumber}>
          <TD><input type="radio" name="found-transaction" aria-label={`Select transaction ${candidate.transactionNumber}`} checked={selected === candidate.transactionNumber} disabled={!found.authoritative || candidate.match !== "exact" || !candidate.detailVerified || !onDecision} onChange={() => setSelected(candidate.transactionNumber)} /></TD>
          <TD><span className="font-mono">{candidate.transactionNumber}</span></TD><TD>{candidate.person}<span className="block font-mono text-caption text-ui-muted">{candidate.employeeId}</span></TD><TD>{candidate.transactionType}<span className="block text-caption text-ui-muted">Eff. {candidate.effectiveDate}</span></TD><TD>{candidate.submittedAt}</TD><TD>{candidate.match === "exact" && candidate.detailVerified ? <Badge tone="success">Exact</Badge> : candidate.match === "different" ? "Different action" : candidate.detailVerified ? "Possible" : "Detail unverified"}</TD>
        </TR>)}</TBody></Table>
        {found.rows.length === 0 && <p>{found.complete && found.authoritative ? "No matching transactions in the complete, authoritative list." : "No transactions loaded; absence is not established."}</p>}
      </>}
      {(!found || uncertain || !found.rows.some(candidate => candidate.match === "exact" && candidate.detailVerified)) && <div className="flex items-end gap-2"><Field label="Know the transaction number?"><Input aria-label="Exact transaction number" value={transaction} disabled={busy || !onDecision} onChange={event => setTransaction(event.target.value)} /></Field><Button variant="secondary" disabled={busy || !onDecision || !transaction.trim()} onClick={() => onDecision?.({ kind: "check-again", transactionNumber: transaction.trim() })}>Look up</Button></div>}
    </div>
    <footer className="log-decision-footer"><Button size="sm" variant="secondary" disabled={busy || !onDecision} onClick={() => onDecision?.({ kind: "check-again", ...(transaction.trim() ? { transactionNumber: transaction.trim() } : {}) })}>Check again</Button><div className="log-decision-actions">
      <Button size="sm" variant="secondary" disabled={!absent || busy || !onDecision} onClick={() => { if (absent) onDecision?.({ kind: "not-submitted" }); }}>Not submitted</Button>
      <Button size="sm" disabled={!submitted || busy || !onDecision} onClick={() => { if (row && submitted) onDecision?.({ kind: "submitted", transactionNumber: row.transactionNumber }); }}>{submitted && row ? `Submitted as ${row.transactionNumber}` : "Submitted"}</Button>
    </div></footer>
  </section>;
}
