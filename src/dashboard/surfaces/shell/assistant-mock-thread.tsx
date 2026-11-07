import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ArrowUpRight, Ban, Check, CircleCheck, Eye, Lock, Minus, Monitor, Paperclip, PencilLine, Square } from "lucide-react";
import { Button, useToasts } from "../../ds/ui.js";
import { ACTIVITY, OPERATOR, type AssistantFrame, type ChatItem, type ChatValue, type ListRow, type PlanStep } from "../assistant/assistant-mock-frames.js";
import { AssistantReply } from "./assistant-panel.js";

/** `**bold**` spans in mock replies. */
function Rich({ text }: { text: string }) {
  return <>{text.split("**").map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>)}</>;
}

function Value({ value }: { value: ChatValue }) {
  return <div className="hub-value"><dt>{value.label}</dt><dd>
    <span className="hub-value-change">{value.before !== undefined && <><s>{value.before}</s><ArrowRight aria-label="changes to" /></>}<span>{value.after}</span></span>
    {value.source && <small>{value.source}</small>}
  </dd></div>;
}

const STEP_ICON: Readonly<Record<Exclude<PlanStep["state"], "ready">, ReactNode>> = {
  running: <span className="hub-spinner" aria-hidden />, done: <Check aria-hidden />, stopped: <Square aria-hidden />, "not-run": <Minus aria-hidden />, blocked: <Lock aria-hidden />,
};
const STEP_WORD: Readonly<Record<PlanStep["state"], string>> = { ready: "", running: "Running", done: "Done", stopped: "Stopped", "not-run": "Not run", blocked: "Blocked" };

function Plan({ item }: { item: Extract<ChatItem, { kind: "plan" }> }) {
  const [checked, setChecked] = useState(() => item.steps.map(step => step.checked ?? false));
  if (item.state === "started") return <div className="hub-resolved" aria-label="Resolved proposal"><span><Check aria-hidden /></span><span className="hub-resolved-title">{item.title} · {item.steps[0].values[0]?.after}</span><span className="hub-resolved-status">Started · review the records in Queue</span></div>;
  const count = checked.filter(Boolean).length, review = item.state === "review", single = item.steps.length === 1;
  const unit = item.steps.every(step => step.subject === undefined && step.mode.startsWith("EID")) ? "people" : "steps";
  const primary = item.primary && count === item.steps.length ? item.primary : count === item.steps.length && !single ? `Approve all ${count}` : count === 1 ? `Approve ${unit === "people" ? item.steps[checked.indexOf(true)].title : single ? "" : `step ${checked.indexOf(true) + 1}`}`.trim() : `Approve ${count} ${unit}`;
  return <article className="hub-card hub-plan" aria-label={`Plan: ${item.title}`} data-state={item.state}>
    <div className="hub-card-body"><h3><span>{item.title}</span><small>{single ? "1 step" : `${item.steps.length} ${unit}`}</small></h3>
      <ol className="hub-plan-steps">{item.steps.map((step, index) => <li key={step.title} data-state={step.state}>
        <span className="hub-plan-mark">{review && !single
          ? <input type="checkbox" checked={checked[index]} aria-label={`Include ${step.title}`} onChange={event => setChecked(values => values.map((value, at) => at === index ? event.target.checked : value))} />
          : step.state === "ready" ? <span className="hub-plan-number">{index + 1}</span> : STEP_ICON[step.state]}</span>
        <div className="hub-plan-step">
          <div className="hub-plan-head"><strong>{step.title}</strong><span>{step.mode}</span>{STEP_WORD[step.state] && <em>{STEP_WORD[step.state]}</em>}</div>
          {step.subject && <div className="hub-plan-subject">{step.subject}</div>}
          {step.values.length > 0 && <dl className="hub-values">{step.values.map(value => <Value key={value.label} value={value} />)}</dl>}
          {step.note && <p className="hub-plan-note">{step.note}</p>}
        </div>
      </li>)}</ol>
      {item.evidence && <div className="hub-evidence"><h4>Evidence</h4><dl className="hub-values">{item.evidence.map(value => <Value key={value.label} value={value} />)}</dl></div>}
    </div>
    <footer className="hub-card-footer"><span className="hub-footer-status" data-tone={item.state === "stopped" ? "warning" : item.state === "blocked" ? "danger" : undefined} role="status">{item.state === "running" && <span className="hub-spinner" aria-hidden />}{item.status}</span>
      <span className="hub-footer-actions">
        {review && <><Button size="sm" variant="ghost">Cancel</Button><Button size="sm" variant="primary" disabled={count === 0}>{primary}</Button></>}
        {item.state === "running" && <Button size="sm">Stop</Button>}
        {item.state === "blocked" && <Button size="sm">Open log</Button>}
      </span></footer>
  </article>;
}

function Row({ row }: { row: ListRow }) {
  const icon = { read: <Eye aria-hidden />, session: <Monitor aria-hidden />, edit: <PencilLine aria-hidden />, confirm: <CircleCheck aria-hidden />, refused: <Ban aria-hidden /> }[row.icon ?? "read"];
  return <li className="hub-list-row" data-tone={row.tone}>
    {row.icon ? <span className="hub-list-icon" data-icon={row.icon}>{icon}</span> : <span className="hub-list-dot" aria-hidden />}
    <span className="hub-list-lead">{row.lead}</span><span className="hub-list-text">{row.text}</span>
    {row.meta && <span className="hub-list-meta">{row.meta}</span>}
    {row.link && <button type="button" className="hub-link">{row.link}<ArrowUpRight aria-hidden /></button>}
  </li>;
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "you": return <div className="hub-message operator">{item.text}{item.file && <span className="hub-sent-file"><Paperclip aria-hidden />{item.file}</span>}</div>;
    case "reply": return <AssistantReply><Rich text={item.text} /></AssistantReply>;
    case "nav": return <p className="hub-nav-line"><ArrowUpRight aria-hidden /><span>{item.text}</span></p>;
    case "line": return <p className="hub-caption">{item.text}</p>;
    case "session": return <div className="hub-session" data-state={item.state} role="status">
      <span className="hub-session-icon">{item.state === "running" ? <span className="hub-spinner" aria-hidden /> : <Monitor aria-hidden />}</span>
      <span className="hub-session-copy"><span>{item.label}</span>{item.meta && <small>{item.meta}</small>}</span>
      {item.state === "running" ? <Button size="sm">Stop</Button> : <button type="button" className="hub-link">Log<ArrowUpRight aria-hidden /></button>}
    </div>;
    case "applied": return <div className="hub-applied" aria-label={item.title}>
      <div className="hub-applied-head"><Check aria-hidden /><span>{item.title}</span><button type="button" className="hub-link">Undo</button></div>
      <dl className="hub-values">{item.values.map(value => <Value key={value.label} value={value} />)}</dl>
    </div>;
    case "plan": return <Plan item={item} />;
    case "list": return <article className="hub-card hub-list-card" aria-label={item.title}><div className="hub-card-body"><h3><span>{item.title}</span>{item.meta && <small>{item.meta}</small>}</h3>
      <ul className="hub-list">{item.rows.map(row => <Row key={row.lead + row.text} row={row} />)}</ul></div>
      {item.footer && <footer className="hub-card-footer"><span className="hub-footer-status">{item.footer}</span></footer>}</article>;
    case "table": return <article className="hub-card hub-table-card" aria-label={item.title}><div className="hub-card-body"><h3><span>{item.title}</span>{item.meta && <small>{item.meta}</small>}</h3>
      <table><thead><tr>{item.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{item.rows.map(row => <tr key={row[0]}>{row.map((cell, index) => <td key={index} data-tone={index === item.danger ? "danger" : undefined}>{cell}</td>)}</tr>)}</tbody></table></div>
      {item.footer && <footer className="hub-card-footer"><span className="hub-footer-status">{item.footer}</span></footer>}</article>;
    case "ask": return <><AssistantReply>{item.text}</AssistantReply><div className="hub-choices">{item.choices.map(choice => <button type="button" key={choice} className="hub-btn">{choice}</button>)}</div></>;
  }
}

export function AssistantMockThread({ frame }: { frame: AssistantFrame }) {
  const { toast } = useToasts();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    for (const item of frame.toasts ?? []) toast({ tone: item.tone, title: item.title, description: item.description, sticky: item.sticky, duration: 600_000, action: item.action ? { label: item.action, onAction: () => undefined } : undefined });
  }, [frame, toast]);
  if (frame.view === "activity") return <section className="hub-activity" aria-label="Assistant activity"><h3>Today</h3><ul className="hub-list">{ACTIVITY.map(row => <Row key={row.lead + row.text} row={row} />)}</ul>
    <p className="hub-caption">Logs record each entry as “assistant on behalf of {OPERATOR}”.</p></section>;
  return <>{frame.chat.map((item, index) => <Item key={index} item={item} />)}</>;
}
