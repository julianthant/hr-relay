import { Fragment, useEffect, useRef } from "react";
import { Check, ChevronRight, Paperclip } from "lucide-react";
import { useToasts } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { ACTIVITY, type AssistantFrame, type ChatItem, type Row } from "../assistant/assistant-mock-frames.js";
import { AssistantReply } from "./assistant-panel.js";

/** Inline markup for mock replies; see assistant-mock-frames.ts. */
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*.+?\*\*|\{\{.+?\}\}|~~.+?~~|!!.+?!!|__.+?__)/u).map((part, index) => {
    const inner = part.slice(2, -2);
    if (part.startsWith("**")) return <strong key={index} className="font-medium">{inner}</strong>;
    if (part.startsWith("{{")) return <button key={index} type="button" className="cursor-pointer font-medium text-ui-info underline-offset-2 hover:underline">{inner}</button>;
    if (part.startsWith("~~")) return <s key={index} className="text-ui-muted">{inner}</s>;
    if (part.startsWith("!!")) return <span key={index} className="font-medium text-ui-danger">{inner}</span>;
    if (part.startsWith("__")) return <span key={index} className="font-medium text-ui-info">{inner}</span>;
    return <Fragment key={index}>{part}</Fragment>;
  })}</>;
}

/** Sentences first; consecutive "- " lines become one bullet list. */
function Text({ text }: { text: string }) {
  const blocks: (string | string[])[] = [];
  for (const line of text.split("\n")) {
    const last = blocks.at(-1);
    if (!line.startsWith("- ")) blocks.push(line);
    else if (Array.isArray(last)) last.push(line.slice(2));
    else blocks.push([line.slice(2)]);
  }
  return <AssistantReply>{blocks.map((block, index) => Array.isArray(block)
    ? <ul key={index} className="my-1 list-disc pl-5">{block.map(line => <li key={line}><Inline text={line} /></li>)}</ul>
    : <p key={index} className="m-0"><Inline text={block} /></p>)}</AssistantReply>;
}

/** History · Activity rows: hairline separators, no box or header; each row opens its log. */
function Rows({ rows }: { rows: readonly Row[] }) {
  return <div className="flex flex-col">{rows.map((row, index) => <div key={row.primary + index} className={cn("flex min-w-0 cursor-pointer items-start gap-3 py-2.5 text-body", index > 0 && "border-t border-ui-stroke")}>
    <span className="flex min-w-0 flex-1 flex-col"><span className="truncate font-medium">{row.primary}</span>
      {row.secondary && <span className="truncate text-caption text-ui-muted" title={row.secondary}>{row.secondary}</span>}</span>
    {row.value && <span className="shrink-0 tabular-nums text-ui-secondary">{row.value}</span>}
    <ChevronRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-muted" />
  </div>)}</div>;
}

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case "you": return <div className="hub-message operator">{item.text}{item.file && <span className="hub-sent-file"><Paperclip aria-hidden />{item.file}</span>}</div>;
    case "text": return <Text text={item.text} />;
    case "session": return <AssistantReply><div className="hub-session" role="status"><span className="hub-spinner" aria-hidden />
      <span className="hub-session-copy"><span>{item.label}</span><small>{item.meta}</small></span><button type="button" className="hub-pill">Stop</button></div></AssistantReply>;
    case "answered": return <p className="hub-answered"><Check aria-hidden />{item.text}</p>;
  }
}

/** Today's assistant actions for the History view's Activity tab. */
export function AssistantMockActivity() {
  return <Rows rows={ACTIVITY} />;
}

export function AssistantMockThread({ frame }: { frame: AssistantFrame }) {
  const { toast } = useToasts();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    for (const item of frame.toasts ?? []) toast({ tone: item.tone, title: item.title, description: item.description, sticky: item.sticky, duration: 600_000 });
  }, [frame, toast]);
  return <>{frame.chat.map((item, index) => <Item key={index} item={item} />)}</>;
}
