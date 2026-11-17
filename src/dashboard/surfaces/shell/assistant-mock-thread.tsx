import { Fragment, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, Paperclip } from "lucide-react";
import { EmptyState, FailureNotice, useToasts } from "../../ds/ui.js";
import type { AssistantActivityWire } from "../../../models/dashboard/assistant.js";
import { cn } from "../../lib/utils.js";
import { ACTIVITY, type AssistantFrame, type ChatItem, type Row } from "../assistant/assistant-mock-frames.js";

export function AssistantReply({ children }: { children: React.ReactNode }) {
  return <div className="hub-assistant-line"><div className="hub-message">{children}</div></div>;
}

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

/** History · Activity rows: hairline separators, no box or header; a row opens its log behind the panel. */
function Rows({ rows, onOpen }: { rows: readonly Row[]; onOpen?: () => void }) {
  return <div className="flex flex-col">{rows.map((row, index) => {
    const Tag = onOpen ? "button" : "div";
    return <Tag key={row.primary + index} {...(onOpen ? { type: "button" as const, onClick: onOpen } : {})} className={cn("flex w-full min-w-0 items-start gap-3 border-0 bg-transparent py-2.5 text-left text-body text-inherit", onOpen && "cursor-pointer", index > 0 && "border-t border-solid border-ui-stroke")}>
    <span className="flex min-w-0 flex-1 flex-col"><span className="truncate font-medium">{row.primary}</span>
      {row.secondary && <span className="truncate text-caption text-ui-muted" title={row.secondary}>{row.secondary}</span>}</span>
    {row.value && <span className="shrink-0 tabular-nums text-ui-secondary">{row.value}</span>}
    {onOpen && <ChevronRight aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-muted" />}
  </Tag>;
  })}</div>;
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
export function AssistantMockActivity({ query, onOpen }: { query: string; onOpen: () => void }) {
  const needle = query.trim().toLowerCase(), rows = ACTIVITY.filter(row => `${row.primary} ${row.secondary ?? ""}`.toLowerCase().includes(needle));
  return rows.length === 0 ? <div className="hub-empty">No matching activity.</div> : <Rows rows={rows} onOpen={onOpen} />;
}

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The served Activity list: read once when it opens, filtered in place by the search; a failed read shows one notice with Retry. */
export function AssistantServedActivity({ query, read }: { query: string; read: (signal: AbortSignal) => Promise<AssistantActivityWire> }) {
  const [rows, setRows] = useState<readonly Row[] | "failed">();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setRows(undefined);
    read(abort.signal).then(view => setRows(view.rows.map(row => ({ primary: row.label, value: clock.format(new Date(row.at)) }))), () => {
      if (!abort.signal.aborted) setRows("failed");
    });
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the read happens once per opening and once per Retry
  }, [attempt]);
  if (rows === undefined) return null;
  if (rows === "failed") return <FailureNotice sentence="Activity did not load." stillWorks="Your chats are not affected." action={{ label: "Retry", onClick: () => setAttempt(count => count + 1) }} />;
  const needle = query.trim().toLowerCase(), shown = rows.filter(row => row.primary.toLowerCase().includes(needle));
  if (rows.length === 0) return <EmptyState title="No activity today" />;
  return shown.length === 0 ? <div className="hub-empty">No matching activity.</div> : <Rows rows={shown} />;
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
