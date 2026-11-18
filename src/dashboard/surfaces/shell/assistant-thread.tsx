import { Fragment, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { EmptyState, FailureNotice, Skeleton } from "../../ds/ui.js";
import type { AssistantActivityWire } from "../../../models/dashboard/assistant.js";
import { cn } from "../../lib/utils.js";
interface Row { readonly primary: string; readonly secondary?: string; readonly value?: string }

export function AssistantReply({ children }: { children: React.ReactNode }) {
  return <div className="hub-assistant-line"><div className="hub-message">{children}</div></div>;
}

/** Bold runs only; any other markup in a reply stays literal. */
function Inline({ text }: { text: string }) {
  return <>{text.split(/(\*\*.+?\*\*)/u).map((part, index) => part.startsWith("**") && part.endsWith("**") && part.length > 4
    ? <strong key={index} className="font-medium">{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>)}</>;
}

/** Sentences first; consecutive "- " lines become one bullet list. */
export function AssistantText({ text }: { text: string }) {
  const blocks: (string | string[])[] = [];
  for (const line of text.split("\n")) {
    const last = blocks.at(-1);
    if (!line.startsWith("- ")) blocks.push(line);
    else if (Array.isArray(last)) last.push(line.slice(2));
    else blocks.push([line.slice(2)]);
  }
  return <AssistantReply>{blocks.map((block, index) => Array.isArray(block)
    ? <ul key={index} className="my-1 list-disc pl-5">{block.map(line => <li key={line}><Inline text={line}/></li>)}</ul>
    : <p key={index} className="m-0"><Inline text={block}/></p>)}</AssistantReply>;
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

/** Same row height, divider and columns as the loaded list, so nothing moves when it arrives. */
function ActivitySkeleton() {
  return <div className="flex flex-col" role="status" aria-label="Loading activity">{[0, 1, 2, 3].map(index =>
    <div key={index} className={cn("flex w-full items-start gap-3 py-2.5", index > 0 && "border-t border-solid border-ui-stroke")}>
      <span className="flex min-w-0 flex-1 flex-col"><Skeleton className="my-1 h-4 w-2/3" /></span><Skeleton className="my-1 h-4 w-10 shrink-0" /></div>)}</div>;
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
  if (rows === undefined) return <ActivitySkeleton />;
  if (rows === "failed") return <FailureNotice sentence="Couldn't load activity." action={{ label: "Retry", onClick: () => setAttempt(count => count + 1) }} />;
  const needle = query.trim().toLowerCase(), shown = rows.filter(row => row.primary.toLowerCase().includes(needle));
  if (rows.length === 0) return <EmptyState title="No activity today" />;
  return shown.length === 0 ? <div className="hub-empty">No matching activity.</div> : <Rows rows={shown} />;
}
