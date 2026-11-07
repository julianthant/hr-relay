import { Fragment, useState, type ReactNode } from "react";
import { Ban, Check, ChevronRight, LoaderCircle, Undo2, X } from "lucide-react";
import { Button, IconButton } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import type { DirectionId, Scenario, SheetItem, SheetRow } from "../assistant/assistant-mock-directions.js";
import { AssistantReply } from "./assistant-panel.js";

const STATE_ICON = {
  spin: <LoaderCircle aria-label="Running" className="size-3.5 animate-spin text-ui-info" />, ok: <Check aria-label="Done" className="size-3.5 text-ui-positive" />,
  fail: <X aria-label="Failed" className="size-3.5 text-ui-danger" />, blocked: <Ban aria-label="Not started" className="size-3.5 text-ui-muted" />,
} as const;

function Token({ value }: { value: string }) {
  const [, prefix, rest] = /^(spin|ok|x):(.*)$/u.exec(value) ?? [undefined, undefined, value];
  return <button type="button" className="mx-0.5 inline-flex items-center gap-1 rounded-full border border-ui-stroke bg-ui-table px-2 py-px align-baseline text-caption font-medium text-ui-primary hover:bg-ui-hover">
    {prefix && STATE_ICON[prefix === "x" ? "fail" : prefix as "spin" | "ok"]}{rest}</button>;
}

/** Inline markup for the sheet texts; see assistant-mock-directions.ts. */
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*.+?\*\*|\[\[.+?\]\]|\{\{.+?\}\}|~~.+?~~|!!.+?!!|__.+?__)/u).map((part, index) => {
    const inner = part.slice(2, -2);
    if (part.startsWith("**")) return <strong key={index} className="font-medium">{inner}</strong>;
    if (part.startsWith("[[")) return <Token key={index} value={inner} />;
    if (part.startsWith("{{")) return <button key={index} type="button" className="font-medium text-ui-info hover:underline">{inner}</button>;
    if (part.startsWith("~~")) return <s key={index} className="text-ui-muted">{inner}</s>;
    if (part.startsWith("!!")) return <span key={index} className="font-medium text-ui-danger">{inner}</span>;
    if (part.startsWith("__")) return <span key={index} className="font-medium text-ui-info">{inner}</span>;
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}

function Text({ text }: { text: string }) {
  const lines = text.split("\n"), bullets = lines.filter(line => line.startsWith("- "));
  const rest = lines.filter(line => !line.startsWith("- "));
  const first = lines.findIndex(line => line.startsWith("- "));
  return <AssistantReply>{first === -1 ? rest.map((line, index) => <p key={index} className="m-0"><Inline text={line} /></p>) : <>
    {lines.slice(0, first).map((line, index) => <p key={index} className="m-0"><Inline text={line} /></p>)}
    <ul className="my-1 list-disc pl-5">{bullets.map(line => <li key={line}><Inline text={line.slice(2)} /></li>)}</ul>
    {lines.slice(first + bullets.length).map((line, index) => <p key={index} className="m-0"><Inline text={line} /></p>)}</>}</AssistantReply>;
}

function Rows({ title, single, rows }: { title?: string; single?: boolean; rows: readonly SheetRow[] }) {
  const [picked, setPicked] = useState(() => rows.map((_, index) => !single || index === 0));
  return <div className="flex flex-col">
    {title && <p className="m-0 pb-1 text-caption text-ui-muted">{title}</p>}
    {rows.map((row, index) => <div key={row.primary + index} className={cn("flex min-w-0 items-start gap-3 py-2.5 text-body", index > 0 && "border-t border-ui-stroke", row.trailing === "open" && "cursor-pointer")}>
      {row.pick && <input type={single ? "radio" : "checkbox"} name="sheet-pick" className="mt-0.5 size-3.5 shrink-0 accent-[var(--ui-info)]" checked={picked[index]} aria-label={row.primary}
        onChange={() => setPicked(values => values.map((value, at) => single ? at === index : at === index ? !value : value))} />}
      {row.state && <span className="mt-0.5 shrink-0">{STATE_ICON[row.state]}</span>}
      <span className="flex min-w-0 flex-1 flex-col"><span className={cn("truncate font-medium", row.state === "fail" && "text-ui-danger")}>{row.primary}</span>
        {row.secondary && <span className="truncate text-caption text-ui-muted" title={row.secondary}>{row.secondary}</span>}</span>
      {row.value && <span className="flex shrink-0 flex-col items-end text-right tabular-nums">
        <span>{row.before && <><s className="text-ui-muted">{row.before}</s><span className="px-1.5 text-ui-muted">→</span></>}<span className={cn(row.before !== undefined || row.pick ? "font-medium text-ui-info" : "text-ui-secondary")}>{row.value}</span></span>
        {row.source && <span className="text-caption text-ui-muted">{row.source}</span>}</span>}
      {row.trailing === "open" && <ChevronRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-muted" />}
      {row.trailing === "undo" && <IconButton label="Undo" icon={<Undo2 aria-hidden className="size-3.5" />} />}
      {row.trailing === "stop" && <button type="button" className="hub-pill">Stop</button>}
    </div>)}
  </div>;
}

function Item({ item }: { item: SheetItem }): ReactNode {
  switch (item.kind) {
    case "label": return <p className="m-0 -mb-2 border-t border-ui-stroke pt-4 text-caption font-medium uppercase tracking-wide text-ui-muted">{item.text}</p>;
    case "you": return <div className="hub-message operator">{item.text}</div>;
    case "text": return <Text text={item.text} />;
    case "rows": return <Rows title={item.title} single={item.single} rows={item.rows} />;
    case "buttons": return <div className="-mt-2 flex gap-2">{item.primary && <Button size="sm" variant="primary">{item.primary}</Button>}{item.secondary?.map(label => <Button key={label} size="sm">{label}</Button>)}</div>;
  }
}

export function AssistantMockSheet({ scenario, direction }: { scenario: Scenario; direction: DirectionId }) {
  return <>{scenario.directions[direction].map((item, index) => <Item key={index} item={item} />)}</>;
}
