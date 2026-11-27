import { useId } from "react";
import { Check } from "lucide-react";
import type { AssistantDataTarget, AssistantInline, AssistantReplyPart, AssistantSessionView } from "../../../models/dashboard/assistant.js";
import { formatTime } from "../../lib/date-format.js";
import { AssistantReply } from "../shell/assistant-thread.js";
import { replyBlocks, SESSION_CHIP_STATE, type SessionStop } from "./assistant-reply-parts-model.js";
import "./assistant-reply-parts.css";

interface ReplyActions {
  /** Opens data only; a link never acts. */
  readonly onOpen: (target: AssistantDataTarget) => void;
  readonly onStop: (stop: SessionStop) => void;
}

function Run({ run, onOpen }: { run: AssistantInline; onOpen: ReplyActions["onOpen"] }) {
  switch (run.kind) {
    case "plain": return <>{run.text}</>;
    case "bold": return <strong className="reply-bold">{run.text}</strong>;
    case "value": return <>{run.previous === undefined ? null : <><del className="reply-previous">{run.previous}</del>{" "}</>}<span className="reply-value">{run.value}</span></>;
    case "failure": return <span className="reply-failure">{run.text}</span>;
    case "link": return <a className="reply-link" href="#" onClick={event => { event.preventDefault(); onOpen(run.target); }}>{run.label}</a>;
    default: return run satisfies never;
  }
}

function Runs({ runs, onOpen }: { runs: readonly AssistantInline[]; onOpen: ReplyActions["onOpen"] }) {
  return <>{runs.map((run, index) => <Run key={index} run={run} onOpen={onOpen} />)}</>;
}

/** Status, copy and Stop come from the served view; without one the chip claims no progress. */
function SessionChip({ part, view, onStop }: { part: Extract<AssistantReplyPart, { kind: "session" }>; view: AssistantSessionView | undefined; onStop: ReplyActions["onStop"] }) {
  const id = useId();
  const state = view === undefined ? undefined : SESSION_CHIP_STATE[view.state];
  const { label, meta } = view ?? part;
  const stop = view?.stop;
  return <div className="reply-session" data-state={state}>
    {state === "running" || state === "stopping" ? <span className="reply-spinner" aria-hidden /> : null}
    <span className="reply-session-copy" role="status"><span id={`${id}-label`}>{label}</span><small id={`${id}-meta`}>{meta}</small></span>
    {stop ? <button type="button" className="reply-stop" aria-describedby={`${id}-label ${id}-meta`} onClick={() => onStop(stop)}>Stop</button> : null}
  </div>;
}

export function AssistantReplyParts({ parts, sessions, onOpen, onStop }: ReplyActions & {
  parts: readonly AssistantReplyPart[]; sessions?: ReadonlyMap<string, AssistantSessionView>;
}) {
  return <>{replyBlocks(parts).map((block, index) => {
    if (Array.isArray(block)) return <AssistantReply key={index}>{block.map((part, at) => part.kind === "text"
      ? <p key={at} className="reply-text"><Runs runs={part.runs} onOpen={onOpen} /></p>
      : <ul key={at} className="reply-bullets">{part.items.map((runs, item) => <li key={item}><Runs runs={runs} onOpen={onOpen} /></li>)}</ul>)}</AssistantReply>;
    switch (block.kind) {
      case "session": return <AssistantReply key={index}><SessionChip part={block} view={sessions?.get(block.runId)} onStop={onStop} /></AssistantReply>;
      case "answered": return block.attribution.kind === "assistant"
        ? <p key={index} className="reply-answered"><Check aria-hidden />You replied yes · {formatTime(block.at)}</p> : null;
      default: return block satisfies never;
    }
  })}</>;
}
