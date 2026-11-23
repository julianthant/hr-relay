import type { UcpathFoundPresentation, UcpathFoundDecision } from "./ucpath-found-model.js";
import { SkeletonText } from "../../shared/loading/loading.js";
import { createContext, useContext, useEffect, useState } from "react";
import { Check, ImageOff } from "lucide-react";
import { Badge, Table, THead, TBody, TR, TH, TD, Button, DateInput, Field, Input } from "../../../ds/ui.js";
import type { DecisionOptionWire, RunDecisionWire } from "../../../../models/dashboard/run-decision.js";
import { formatTime } from "../../../lib/date-format.js";
import { DecisionCard, DecisionChoice } from "./decision-card.js";
import { answeredOutcome, choiceOptions, decisionAnswerValid, recommendedOption, TYPED_ROW, type LogDecision, type LogDecisionAnswer } from "./log-decision-model.js";
import { LogScreenshots } from "./log-screenshots.js";
import { PickTable } from "./pick-table.js";
import "./log-presentation.css";
import "../../shared/codex-text.css";

export type DecisionAnswerHandler = (option: DecisionOptionWire, answer: LogDecisionAnswer) => void;

function OptionInput({ option, answer, setAnswer, disabled }: { option: DecisionOptionWire; answer: LogDecisionAnswer; setAnswer: (answer: LogDecisionAnswer) => void; disabled: boolean }) {
  const input = option.input;
  if (input === undefined) return null;
  switch (input.kind) {
    case "text": return <Field label={input.label} className="w-64 max-w-full"><Input value={answer.text ?? ""} disabled={disabled} placeholder={input.placeholder} onChange={event => setAnswer({ text: event.target.value })} /></Field>;
    case "date": return <DateInput label={input.label} value={answer.date ?? ""} disabled={disabled} onChange={date => setAnswer({ date })} />;
    case "candidate": return <PickTable table={input.table} disabled={disabled} chosen={answer.typed !== undefined ? TYPED_ROW : answer.candidate} text={answer.typed ?? ""}
      onChoose={id => setAnswer(id === TYPED_ROW ? { typed: answer.typed ?? "" } : { candidate: id })} onText={typed => setAnswer({ typed })} />;
  }
}

function Compare({ rows }: { rows: NonNullable<LogDecision["comparison"]> }) {
  return <Table label="Request and UCPath values" className="log-compare">
    <THead><TR><TH><span className="sr-only">Field</span></TH><TH className="text-caption font-normal normal-case">Request</TH><TH align="right" className="text-caption font-normal normal-case">UCPath</TH></TR></THead>
    <TBody>{rows.map(row => <TR key={row.label}><TH scope="row" className="border-b-0 text-left text-body font-medium normal-case text-ui-primary">{row.label}</TH><TD className="tabular-nums" data-label="Request">{row.expected}</TD>
      <TD align="right" data-label="UCPath" className={row.expected === row.observed ? "tabular-nums" : "tabular-nums font-semibold text-ui-warning"}>{row.observed}{row.expected !== row.observed && <span className="sr-only"> (differs)</span>}</TD></TR>)}</TBody>
  </Table>;
}

const answeredLine = (decision: LogDecision & { answered: NonNullable<LogDecision["answered"]> }) => ({ ...answeredOutcome(decision), time: formatTime(decision.answered.at),
  by: decision.answered.actor.kind === "person" ? decision.answered.actor.name : `assistant on behalf of ${decision.answered.actor.onBehalfOf.name}` });

// The served context line names what is asked; without one, the write outcome is the caution, or the footer note on a failure.
const decisionContext = (decision: LogDecision, served?: RunDecisionWire) => served?.context ?? ([decision.message, decision.caution ?? (decision.state === "failed" ? decision.footer : undefined)].filter(Boolean).join(" ") || undefined);

/** The card content shared by the open and the answered decision; an answered identity strip reads Approved or Rejected. */
function DecisionBody({ decision, fieldLabel }: { decision: LogDecision; fieldLabel?: string }) {
  return <>
    {decision.attemptedAction && <p className="log-attempted">While trying to <strong>{decision.attemptedAction}</strong></p>}
    {decision.lastCompleted && <p className="log-last-completed"><Check aria-hidden className="size-3" />Last completed · {decision.lastCompleted}</p>}
    {decision.field && <div className="log-failed-field"><span>{fieldLabel ?? decision.field.label}</span><strong>{decision.field.value}</strong><span>{decision.field.outcome}</span></div>}
    {decision.comparison && <Compare rows={decision.comparison} />}
    {decision.unavailableCapture && <div className="log-capture-unavailable"><ImageOff aria-hidden className="size-4" />{decision.unavailableCapture}</div>}
  </>;
}

/** One served decision as a DecisionCard: its options, hints, recommended option and inputs all come from the wire. */
type ServedDraft = Readonly<{ selected: string | undefined; answers: Readonly<Record<string, LogDecisionAnswer>> }>;
/** A windowed log unmounts steps scrolled away; the feed keeps each served decision's draft so it comes back as the operator left it. */
export const ServedDraftsContext = createContext<Map<string, ServedDraft> | undefined>(undefined);

function ServedDecision({ decision, served, onAnswer, onCancel }: { decision: LogDecision; served: RunDecisionWire; onAnswer?: DecisionAnswerHandler; onCancel?: () => void }) {
  const choices = choiceOptions(served);
  const drafts = useContext(ServedDraftsContext);
  const draftKey = JSON.stringify(served);
  const [selected, setSelected] = useState(() => drafts?.get(draftKey)?.selected ?? recommendedOption(served)?.id);
  const [answers, setAnswers] = useState(() => drafts?.get(draftKey)?.answers ?? {});
  useEffect(() => { drafts?.set(draftKey, { selected, answers }); }, [drafts, draftKey, selected, answers]);
  const option = choices.find(candidate => candidate.id === selected) ?? recommendedOption(served);
  const answer = option === undefined ? {} : answers[option.id] ?? (option.input?.kind === "text" && option.input.prefill !== undefined ? { text: option.input.prefill } : {});
  const disabled = onAnswer === undefined;
  const pick = option?.input?.kind === "candidate";
  const named = choices.length === 1 && option !== undefined && (option.input === undefined || option.input.kind === "text" || option.input.kind === "date");
  const context = decisionContext(decision, served);
  return <div className="flex min-w-0 flex-col gap-3" data-decision-state={decision.state}>
    {decision.screenshots && <LogScreenshots screenshots={decision.screenshots} />}
    <DecisionCard title={decision.title} context={context} tone={decision.state === "failed" ? "danger" : undefined} badge={decision.state === "held" ? "Held" : undefined} inline={pick}
      noConfirm={option === undefined && decision.state === "failed"} confirmLabel={named ? option.label : "Confirm"} confirmDisabled={disabled || option === undefined || !decisionAnswerValid(option, answer)}
      onConfirm={() => { if (option !== undefined && decisionAnswerValid(option, answer)) onAnswer?.(option, answer); }} onCancel={onCancel}>
      <DecisionBody decision={decision} />
      {choices.length > 1 && option !== undefined && served.choiceLabel !== undefined && <DecisionChoice label={served.choiceLabel} value={option.id} disabled={disabled} onChange={setSelected}
        options={choices.map(candidate => ({ value: candidate.id, label: candidate.label, hint: candidate.hint }))} />}
      {option !== undefined && <OptionInput option={option} answer={answer} disabled={disabled} setAnswer={next => setAnswers({ ...answers, [option.id]: next })} />}
    </DecisionCard>
  </div>;
}

export function LogDecisionBlock({ decision, onAnswer, onCancel }: { decision: LogDecision; onAnswer?: DecisionAnswerHandler; onCancel?: () => void }) {
  if (decision.answered) {
    const line = answeredLine({ ...decision, answered: decision.answered });
    const fieldLabel = decision.field?.label === "Approving employee" ? (line.kind === "rejected" ? "Rejected" : "Approved") : undefined;
    return <div className="flex min-w-0 flex-col gap-3" data-decision-state={decision.state} data-answered={line.kind}>
      {decision.screenshots && <LogScreenshots screenshots={decision.screenshots} />}
      <DecisionCard title={decision.title} context={decisionContext(decision, decision.served)} tone={decision.state === "failed" ? "danger" : undefined} badge={decision.state === "held" ? "Held" : undefined} answered={line}>
        <DecisionBody decision={decision} fieldLabel={fieldLabel} />
      </DecisionCard>
    </div>;
  }
  // A new served revision resets the operator's selection.
  if (decision.served) return <ServedDecision key={JSON.stringify(decision.served)} decision={decision} served={decision.served} onAnswer={onAnswer} onCancel={onCancel} />;
  const context = [decision.message, decision.caution, decision.footer].filter(Boolean).join(" ") || undefined;
  return <div className="flex min-w-0 flex-col gap-3" data-decision-state={decision.state}>
    {decision.screenshots && <LogScreenshots screenshots={decision.screenshots} />}
    <DecisionCard title={decision.title} context={context} tone={decision.state === "failed" ? "danger" : undefined} badge={decision.state === "held" ? "Held" : undefined} preview>
      {decision.state === "loading" ? <div className="flex flex-col gap-2.5" role="status" aria-label={decision.title}><SkeletonText className="w-4/5 text-body" /><SkeletonText className="w-3/5 text-body" /></div> : <DecisionBody decision={decision} />}
    </DecisionCard>
  </div>;
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
  const checkAgain = () => onDecision?.({ kind: "check-again", ...(transaction.trim() ? { transactionNumber: transaction.trim() } : {}) });
  return <div className="flex min-w-0 flex-col gap-3" aria-label="UCPath found transactions">
    <DecisionCard title="Did this submit reach UCPath?" context={`${attemptLabel}. Relay won’t submit it again.`}
      confirmLabel={submitted && row ? `Submitted as ${row.transactionNumber}` : "Submitted"} confirmDisabled={!submitted || busy || !onDecision}
      onConfirm={() => { if (row && submitted) onDecision?.({ kind: "submitted", transactionNumber: row.transactionNumber }); }}
      extra={<>
        <Button type="button" variant="secondary" disabled={!absent || busy || !onDecision} onClick={() => { if (absent) onDecision?.({ kind: "not-submitted" }); }}>Not submitted</Button>
        <Button type="button" variant="secondary" disabled={busy || !onDecision} onClick={checkAgain}>Check again</Button>
      </>}>
      {busy && <p role="status" className="m-0 text-body text-ui-secondary">{presentation.state === "loading" ? "Reading transactions" : "Checking again"}</p>}
      {presentation.state === "unavailable" && <p className="m-0 text-body text-ui-secondary">Confirmation couldn’t be read. Check again.</p>}
      {found && <>
        <div className="flex items-center justify-between gap-4"><h4 className="m-0 text-control font-semibold">Found in UCPath</h4><span className="text-caption text-ui-muted">{found.complete ? "Complete list" : "Partial list"}{!found.authoritative && " · authority unverified"}</span></div>
        {uncertain && <p className="m-0 text-body text-ui-warning">{!found.complete ? "The list is incomplete. Check again or look up a transaction." : !found.authoritative ? "The list is unverified. Check again." : "These transactions need verification. Check again or look up a transaction."}</p>}
        <Table label="Transactions found in UCPath"><THead><TR><TH><span className="sr-only">Select</span></TH><TH>Transaction</TH><TH>Person</TH><TH>Action</TH><TH>Submitted</TH><TH>Match</TH></TR></THead><TBody>{found.rows.map(candidate => <TR key={candidate.transactionNumber}>
          <TD><input type="radio" name="found-transaction" aria-label={`Select transaction ${candidate.transactionNumber}`} checked={selected === candidate.transactionNumber} disabled={!found.authoritative || candidate.match !== "exact" || !candidate.detailVerified || !onDecision} onChange={() => setSelected(candidate.transactionNumber)} /></TD>
          <TD className="tabular-nums">{candidate.transactionNumber}</TD><TD className="tabular-nums">{candidate.person}<span className="block text-caption text-ui-muted">{candidate.employeeId}</span></TD><TD>{candidate.transactionType}<span className="block text-caption text-ui-muted">Effective {candidate.effectiveDate}</span></TD><TD className="tabular-nums">{candidate.submittedAt}</TD><TD>{candidate.match === "exact" && candidate.detailVerified ? <Badge tone="success">Exact</Badge> : candidate.match === "different" ? "Different action" : candidate.detailVerified ? "Possible" : "Detail unverified"}</TD>
        </TR>)}</TBody></Table>
        {found.rows.length === 0 && <p className="m-0 text-body text-ui-secondary">{found.complete && found.authoritative ? "No matching transactions in the complete, authoritative list." : "No transactions loaded; absence is not established."}</p>}
      </>}
      {(!found || uncertain || !found.rows.some(candidate => candidate.match === "exact" && candidate.detailVerified)) && <div className="flex items-end gap-2"><Field label="Know the transaction number?"><Input aria-label="Exact transaction number" value={transaction} disabled={busy || !onDecision} onChange={event => setTransaction(event.target.value)} /></Field><Button variant="secondary" disabled={busy || !onDecision || !transaction.trim()} onClick={checkAgain}>Look up</Button></div>}
    </DecisionCard>
  </div>;
}
