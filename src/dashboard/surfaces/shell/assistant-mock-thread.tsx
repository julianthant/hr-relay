import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Ban, Check, CircleCheck, Eye, Minus, Monitor, Paperclip, PencilLine } from "lucide-react";
import { Button, useToasts } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { DecisionCard } from "../run-detail/logs/decision-card.js";
import { DataTable, PageCard } from "../run-detail/decision-mock/decision-mock-logs.js";
import { ACTIVITY, type AssistantFrame, type ChatItem, type Change, type ListRow, type Proposal } from "../assistant/assistant-mock-frames.js";
import { AssistantReply } from "./assistant-panel.js";

/** `**bold**` spans in mock replies. */
function Rich({ text }: { text: string }) {
  return <>{text.split("**").map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>)}</>;
}

function LogLink({ label = "Log" }: { label?: string }) {
  return <button type="button" className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-caption font-medium text-ui-info hover:bg-ui-hover">{label}<ArrowUpRight aria-hidden className="size-3" /></button>;
}

/** Page-card rows: label left, old (struck, muted) -> new flush right; a differing source on its own muted line under the value. */
function Changes({ changes }: { changes: NonNullable<Proposal["changes"]> }) {
  const [picked, setPicked] = useState(() => changes.rows.map(() => true));
  return <PageCard title={changes.title} mode={changes.source ?? (changes.pick ? `${picked.filter(Boolean).length} of ${changes.rows.length}` : "")}>
    <div className="px-3">{changes.rows.map((row: Change, index) => <div key={row.label} className="flex items-baseline gap-3 border-b border-ui-stroke py-2.5 text-body last:border-b-0">
      {changes.pick && <input type="checkbox" className="size-3.5 shrink-0 translate-y-0.5 self-start accent-[var(--ui-info)]" checked={picked[index]} aria-label={`Include ${row.label}`} onChange={event => setPicked(values => values.map((value, at) => at === index ? event.target.checked : value))} />}
      <span className="min-w-0 shrink-0 font-medium">{row.label}</span>
      <span className="ml-auto flex min-w-0 flex-col items-end text-right tabular-nums">
        <span className="flex flex-wrap items-baseline justify-end gap-x-1.5">{row.before !== undefined && <><s className="text-ui-muted decoration-ui-muted/60">{row.before}</s><ArrowRight aria-label="to" className="size-3 shrink-0 self-center text-ui-muted" /></>}
          <span className="font-medium">{row.after}</span></span>
        {row.source && <span className="text-caption text-ui-muted">{row.source}</span>}
      </span>
    </div>)}</div>
  </PageCard>;
}

function Steps({ steps }: { steps: NonNullable<Proposal["steps"]> }) {
  return <ol className="m-0 flex list-none flex-col gap-1.5 p-0">{steps.map((step, index) => <li key={step.title} className={cn("flex items-baseline gap-2.5 text-body", step.state === "not-run" && "text-ui-muted")}>
    <span className={cn("grid size-4.5 shrink-0 translate-y-0.5 place-items-center self-start rounded-full border text-[10px] font-semibold tabular-nums",
      step.state === "done" ? "border-transparent bg-ui-positive/15 text-ui-positive" : "border-ui-stroke-control text-ui-secondary")}>
      {step.state === "done" ? <Check aria-label="Done" className="size-3" /> : step.state === "not-run" ? <Minus aria-label="Not run" className="size-3" /> : index + 1}</span>
    <span><span className="font-medium">{step.title}</span> <span className="text-ui-muted">· {step.detail}</span></span>
  </li>)}</ol>;
}

/** Every proposal is one DecisionCard: title, steps, one values table, buttons. Applied and blocked cards have no Approve. */
function ProposalCard({ proposal }: { proposal: Proposal }) {
  const body = <>{proposal.steps && <Steps steps={proposal.steps} />}{proposal.changes && <Changes changes={proposal.changes} />}
    {proposal.evidence && <p className="m-0 flex items-center gap-2 text-body text-ui-muted"><span className="min-w-0 flex-1">{proposal.evidence}</span><LogLink /></p>}
    {proposal.state === "applied" && <div><Button size="sm">Undo</Button></div>}</>;
  if (proposal.state === "applied" || proposal.state === "blocked") return <DecisionCard preview title={proposal.title} tone={proposal.state === "blocked" ? "danger" : undefined} context={proposal.reason}>{body}</DecisionCard>;
  return <DecisionCard title={proposal.title} context={proposal.reason} confirmLabel={proposal.confirm} cancelLabel={proposal.state === "stopped" ? "Cancel plan" : "Cancel"}>{body}</DecisionCard>;
}

function Row({ row }: { row: ListRow }) {
  const Icon = { read: Eye, session: Monitor, edit: PencilLine, confirm: CircleCheck, refused: Ban }[row.icon ?? "read"];
  const tone = { danger: "text-ui-danger", warning: "text-ui-warning", positive: "text-ui-positive", info: "text-ui-info" }[row.tone ?? "info"];
  return <li className="flex items-baseline gap-2.5 border-b border-ui-stroke py-2.5 text-body last:border-b-0">
    {row.icon ? <Icon aria-hidden className={cn("size-3.5 shrink-0 translate-y-0.5 self-start", row.icon === "confirm" ? "text-ui-positive" : row.icon === "refused" ? "text-ui-danger" : "text-ui-muted")} />
      : <span aria-hidden className={cn("size-1.5 shrink-0 -translate-y-px self-center rounded-full bg-current", tone)} />}
    <span className="shrink-0 font-medium tabular-nums">{row.lead}</span><span className="min-w-0 flex-1 text-ui-secondary">{row.text}</span>
    {row.meta && <span className={cn("shrink-0 text-caption", row.tone === "danger" || row.tone === "warning" ? tone : "text-ui-muted")}>{row.meta}</span>}
    {row.link && <LogLink label={row.link} />}
  </li>;
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "you": return <div className="hub-message operator">{item.text}{item.file && <span className="hub-sent-file"><Paperclip aria-hidden />{item.file}</span>}</div>;
    case "reply": return <AssistantReply><Rich text={item.text} /></AssistantReply>;
    case "nav": return <p className="hub-nav-line"><ArrowUpRight aria-hidden /><span>{item.text}</span></p>;
    case "started": return <p className="m-0 flex items-center gap-2.5 text-body text-ui-secondary"><Check aria-hidden className="size-3.5 shrink-0 text-ui-positive" /><span>{item.text}</span></p>;
    case "session": return <div className="hub-session" data-state={item.state} role="status">
      <span className="hub-session-icon">{item.state === "running" ? <span className="hub-spinner" aria-hidden /> : <Check aria-hidden />}</span>
      <span className="hub-session-copy"><span>{item.label}</span>{item.meta && <small>{item.meta}</small>}</span>
      {item.state === "running" ? <button type="button" className="hub-pill">Stop</button> : <LogLink />}
    </div>;
    case "proposal": return <ProposalCard proposal={item.proposal} />;
    case "list": return <PageCard title={item.title} mode={item.meta ?? ""}><ul className="m-0 list-none px-3 py-0">{item.rows.map(row => <Row key={row.lead + row.text} row={row} />)}</ul></PageCard>;
    case "table": return <DataTable table={item.table} />;
    case "ask": return <><AssistantReply>{item.text}</AssistantReply><div className="hub-choices">{item.choices.map(choice => <Button key={choice} size="sm">{choice}</Button>)}</div></>;
  }
}

/** Today's assistant actions for the History view's Activity tab. */
export function AssistantMockActivity() {
  return <PageCard title="Today" mode={`${ACTIVITY.length}`}><ul className="m-0 list-none px-3 py-0">{ACTIVITY.map(row => <Row key={row.lead + row.text} row={row} />)}</ul></PageCard>;
}

export function AssistantMockThread({ frame }: { frame: AssistantFrame }) {
  const { toast } = useToasts();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    for (const item of frame.toasts ?? []) toast({ tone: item.tone, title: item.title, description: item.description, sticky: item.sticky, duration: 600_000, action: item.action ? { label: item.action, onAction: () => undefined } : undefined });
  }, [frame, toast]);
  return <>{frame.chat.map((item, index) => <Item key={index} item={item} />)}</>;
}
