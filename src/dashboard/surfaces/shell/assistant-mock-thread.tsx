import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronRight, LoaderCircle, Paperclip, Undo2 } from "lucide-react";
import { Button, useToasts } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { DecisionCard } from "../run-detail/logs/decision-card.js";
import { ACTIVITY, type AssistantFrame, type ChatItem, type Row } from "../assistant/assistant-mock-frames.js";
import { AssistantReply } from "./assistant-panel.js";

/** Inline markup for mock replies; see assistant-mock-frames.ts. */
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*.+?\*\*|\{\{.+?\}\}|~~.+?~~|!!.+?!!|__.+?__)/u).map((part, index) => {
    const inner = part.slice(2, -2);
    if (part.startsWith("**")) return <strong key={index} className="font-medium">{inner}</strong>;
    if (part.startsWith("{{")) return <button key={index} type="button" className="font-medium text-ui-info hover:underline">{inner}</button>;
    if (part.startsWith("~~")) return <s key={index} className="text-ui-muted">{inner}</s>;
    if (part.startsWith("!!")) return <span key={index} className="font-medium text-ui-danger">{inner}</span>;
    if (part.startsWith("__")) return <span key={index} className="font-medium text-ui-info">{inner}</span>;
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}

/** Sentences first; consecutive "- " lines become one bullet list. */
function Text({ text, running }: { text: string; running?: boolean }) {
  const blocks: (string | string[])[] = [];
  for (const line of text.split("\n")) {
    const last = blocks.at(-1);
    if (!line.startsWith("- ")) blocks.push(line);
    else if (Array.isArray(last)) last.push(line.slice(2));
    else blocks.push([line.slice(2)]);
  }
  return <AssistantReply>{blocks.map((block, index) => Array.isArray(block)
    ? <ul key={index} className="my-1 list-disc pl-5">{block.map(line => <li key={line}><Inline text={line} /></li>)}</ul>
    : <p key={index} className="m-0">{running && index === 0 && <LoaderCircle aria-label="Running" className="mr-1.5 inline size-3.5 -translate-y-px animate-spin text-ui-info" />}<Inline text={block} /></p>)}</AssistantReply>;
}

/** Borderless rows: hairline separators, no box or header; a value on the right, its old value struck and a differing source below. */
export function Rows({ rows, single, inset = true }: { rows: readonly Row[]; single?: boolean; inset?: boolean }) {
  const [picked, setPicked] = useState(() => rows.map((_, index) => !single || index === 0));
  return <div className={cn("flex flex-col", inset && "pl-[33px]")}>{rows.map((row, index) => <div key={row.primary + index} className={cn("flex min-w-0 items-start gap-3 py-2.5 text-body", index > 0 && "border-t border-ui-stroke", row.open && "cursor-pointer")}>
    {row.pick && <input type={single ? "radio" : "checkbox"} name="assistant-pick" className="mt-0.5 size-3.5 shrink-0 accent-[var(--ui-info)]" checked={picked[index]} aria-label={row.primary}
      onChange={() => setPicked(values => values.map((value, at) => single ? at === index : at === index ? !value : value))} />}
    <span className="flex min-w-0 flex-1 flex-col"><span className="truncate font-medium">{row.primary}</span>
      {row.secondary && <span className="truncate text-caption text-ui-muted" title={row.secondary}>{row.secondary}</span>}</span>
    {row.value && <span className="flex shrink-0 flex-col items-end text-right tabular-nums">
      <span>{row.before && <><s className="text-ui-muted">{row.before}</s><span className="px-1.5 text-ui-muted">→</span></>}<span className={cn(row.before !== undefined || row.fill ? "font-medium text-ui-info" : "text-ui-secondary")}>{row.value}</span></span>
      {row.source && <span className="text-caption text-ui-muted">{row.source}</span>}</span>}
    {row.open && <ChevronRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-muted" />}
  </div>)}</div>;
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "you": return <div className="hub-message operator">{item.text}{item.file && <span className="hub-sent-file"><Paperclip aria-hidden />{item.file}</span>}</div>;
    case "text": return <Text text={item.text} running={item.running} />;
    case "rows": return <Rows rows={item.rows} single={item.single} />;
    case "buttons": return <div className="-mt-2 flex gap-2 pl-[33px]"><Button size="sm" variant="primary">{item.primary}</Button>{item.secondary?.map(label => <Button key={label} size="sm">{label}</Button>)}</div>;
    case "decision": return <div className="pl-[33px]"><DecisionCard title={item.title} confirmLabel={item.confirm} /></div>;
  }
}

/** Today's assistant actions for the History view's Activity tab. */
export function AssistantMockActivity() {
  return <Rows rows={ACTIVITY} inset={false} />;
}

export function AssistantMockThread({ frame }: { frame: AssistantFrame }) {
  const { toast } = useToasts();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    for (const item of frame.toasts ?? []) toast({ tone: item.tone, title: item.title, description: item.description, sticky: item.sticky, duration: 600_000,
      action: item.action ? { label: item.action, onAction: () => undefined, icon: item.action === "Undo" ? <Undo2 aria-hidden className="size-4" /> : undefined } : undefined });
  }, [frame, toast]);
  return <>{frame.chat.map((item, index) => <Item key={index} item={item} />)}</>;
}
