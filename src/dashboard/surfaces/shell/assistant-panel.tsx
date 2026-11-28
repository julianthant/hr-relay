import { ASSISTANT_UNKNOWN_NOTICE, assistantHistoryState } from "../assistant/assistant-model.js";
import { AssistantReplyParts } from "../assistant/assistant-reply-parts.js";
import type { useAssistantController } from "../assistant/assistant-controller-model.js";
import { useEffect, useLayoutEffect, useMemo, useRef, type HTMLAttributes } from 'react';
import { ArrowDown, History, Paperclip, Plus, X } from "lucide-react";
import { AssistantReply, AssistantText } from "./assistant-thread.js";
import { FailureNotice, Skeleton } from '../../ds/ui.js';
import type { ComposerDraftPort } from './composer-model.js';
import { ComposerInput } from './composer-input.js';
import { useAssistantPanel, type AssistantConversationPort, type AssistantFile, type AssistantPorts } from './assistant-panel-model.js';
import { assistantActivity, type AssistantTurnPhase } from './assistant-launcher-model.js';
import './assistant-panel.css';
import type { AssistantDataTarget, AssistantModelPreferenceView } from '../../../models/dashboard/assistant.js';

export function AssistantFileChip({ file }: { file: AssistantFile }) {
  return <div className="hub-file-chip"><Paperclip aria-hidden /><span>{file.name}<small>{file.status} spreadsheet</small></span></div>;
}
/** Bubble-shaped placeholders for a chat that is still loading; sizes match the loaded messages. */
function TranscriptSkeleton() {
  return <div role="status" aria-label="Loading chat" className="hub-transcript-skeleton">
    <div className="hub-message operator"><Skeleton className="h-4 w-36" /></div>
    <div className="hub-assistant-line"><div className="hub-message"><Skeleton className="mb-2 h-4 w-full" /><Skeleton className="mb-2 h-4 w-11/12" /><Skeleton className="h-4 w-2/3" /></div></div>
  </div>;
}
/** The prompt a refused reply answered: the operator message before it. */
export function AssistantPanel({ conversationPort, onAttachFile, onRegisterSpreadsheet, onOpenSettings,
  onClose, onChats, onNewChat, onRename, title, headerProps, onSendMessage, draft, served, onAutomaticTitle, historyNotice, loading = false, modelPreference, initialText = '', onOpenTarget }: AssistantPorts & {
  historyNotice?: string; loading?: boolean; modelPreference?: AssistantModelPreferenceView['preference'];
  onAutomaticTitle?: (title: string) => void; served: ReturnType<typeof useAssistantController>; conversationPort: AssistantConversationPort; onClose?: () => void; onChats?: () => void;
  onNewChat?: () => void; onRename?: () => void; title?: string; headerProps?: HTMLAttributes<HTMLElement>; onOpenSettings?: (section?: string, target?: string) => void; onSendMessage?: () => void; initialText?: string; draft?: ComposerDraftPort;
  /** Opens a reply link's data; without it a link does nothing. */
  onOpenTarget?: (target: AssistantDataTarget) => void;
}) {
  const model = useAssistantPanel({ conversationPort, served, ports: { onAttachFile, onRegisterSpreadsheet } });
  const conversation = model.conversation;
  const wasAtLatest = useRef(true);
  useLayoutEffect(() => { const element = model.transcript.current; if (element && wasAtLatest.current) element.scrollTop = element.scrollHeight; }, [conversation, served.state, model.transcript]);
  // The automatic title waits for the first settled reply: its receipt has advanced the cached chat revision, so the rename is not refused as stale.
  const firstPrompt = served.state.messages.find(message => message.role === 'operator')?.text;
  const settled = served.state.messages.some(message => message.role === 'assistant') === true;
  useEffect(() => { if (title === 'New chat' && settled && firstPrompt !== undefined) onAutomaticTitle?.(firstPrompt.slice(0, 55)); }, [title, settled, firstPrompt, onAutomaticTitle]);
  const accountReady = served.accountAvailable;
  const canCompose = served.canCompose;
  // The account read has no action while it is still loading; the composer stays disabled without a strip.
  const accountLoading = !served.accountAvailable && served.accountAction === undefined;
  const turn = served.state.turn;
  const historyFailed = assistantHistoryState(loading, historyNotice) === 'failed';
  const lastMessage = served.state.messages.at(-1);
  // Only the newest failed reply is shown, as one notice; it is never a chat bubble and an older failure is not repeated.
  const lastRefusal = lastMessage?.role === 'assistant' && lastMessage.code !== undefined ? { text: lastMessage.text } : undefined;
  const sessions = useMemo(() => new Map(served.state.sessions?.map(view => [view.runId, view])), [served.state.sessions]);
  const phase: AssistantTurnPhase = turn.state === 'waiting' ? 'waiting' : turn.state === 'failed' || turn.state === 'unknown' ? 'failed' : 'settled';
  useEffect(() => { assistantActivity.report(phase); }, [phase]);
  return <section id="hub-panel-assistant" className="hub-assistant-panel" role="region" aria-label="Relay assistant" data-source="served">
    <header {...headerProps} className="hub-panel-header"><div className="hub-panel-title"><button type="button" className="hub-chat-title hub-plain" title="Rename chat" onClick={onRename} disabled={!onRename || loading}>{loading ? <Skeleton className="h-4 w-28" /> : <span>{title ?? conversation.title}</span>}</button></div>
      <div className="hub-header-actions"><button type="button" className="hub-icon" aria-label="History" onClick={onChats} disabled={!onChats}><History aria-hidden /></button><button type="button" className="hub-icon" aria-label="New chat" onClick={() => { if (onNewChat) onNewChat(); else model.newChat(); }} disabled={model.busy}><Plus aria-hidden /></button><button type="button" className="hub-icon" aria-label="Close assistant" onClick={onClose} disabled={!onClose}><X aria-hidden /></button></div>
    </header><div className="hub-panel-content">
      <div className="hub-thread-wrap"><><div className="hub-transcript" ref={model.transcript} role="log" aria-label="Assistant conversation" onScroll={() => { model.onScroll(); const element = model.transcript.current; if (element) wasAtLatest.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48; }}>
        {loading ? <TranscriptSkeleton /> : <>
        {historyFailed && <FailureNotice sentence="Couldn't load chat history." action={{ label: 'Reload', onClick: () => window.location.reload() }} />}
        {!loading && !historyFailed && served.state.messages.length === 0 ? <div className="hub-empty"><strong>How can I help?</strong>Ask about a record or describe what you want to do.</div> : null}
        {served.state.messages.map((message, index) => message.role === 'assistant' && 'code' in message && message.code !== undefined ? null
          : message.role === 'assistant' && message.parts !== undefined ? <AssistantReplyParts key={index} parts={message.parts} sessions={sessions} onOpen={target => onOpenTarget?.(target)} onStop={stop => { void served.stop(stop); }} />
          : message.role === 'operator' ? <div className="hub-message operator" key={index}>{message.text}{message.attachments?.map(file => <span className="hub-sent-file" key={file.id}><Paperclip aria-hidden />{file.name}</span>)}</div> : <AssistantReply key={index}><AssistantText text={message.text} /></AssistantReply>)}
        {conversation.files.filter(file => file.status !== 'Attached').map(file => <AssistantFileChip key={file.id} file={file} />)}
        {turn.state === 'waiting' && <AssistantReply><div className="hub-typing" role="status"><span className="hub-typing-dots" aria-hidden><i /><i /><i /></span><span>Preparing a reply…</span></div></AssistantReply>}
        {lastRefusal !== undefined && <FailureNotice sentence={lastRefusal.text} />}
        {turn.state === 'failed' && <FailureNotice sentence="Reply unavailable."
          action={accountReady && served.state.draft === turn.prompt ? { label: 'Retry', onClick: () => served.onAction({ type: 'retry' }) } : undefined} />}
        {turn.state === 'unknown' && <p className="hub-footer-status" role="alert">{ASSISTANT_UNKNOWN_NOTICE}</p>}
        {turn.state === 'cancelled' && <p className="hub-caption" role="status">Reply cancelled. Your request is kept; send it again when ready.</p>}
        {historyNotice && !historyFailed && <p role="status" className="hub-caption">{historyNotice}</p>}
        {model.error ? <p role="alert" className="hub-footer-status">{model.error}</p> : null}
        </>}
      </div>{model.showLatest ? <button type="button" className="hub-scroll-bottom" aria-label="Scroll to latest message" onClick={() => { wasAtLatest.current = true; model.latest(); }}><ArrowDown aria-hidden /></button> : null}</></div>
      {!accountReady && !accountLoading && !loading && <FailureNotice className="mx-3 mb-2" sentence={served.accountNotice}
        action={served.accountAction === 'retry' ? { label: 'Retry', onClick: served.accountRetry }
          : onOpenSettings && served.accountAction ? { label: served.accountAction === 'sign-in' ? 'Sign in' : 'Open Settings', onClick: () => onOpenSettings('general', 'chatgpt.account') } : undefined} />}
      <ComposerInput key={conversation.id} modelLoading={loading} modelPreference={modelPreference} draft={draft} settlementKey={served.state.messages.findLast(message => message.role === 'assistant')?.id} autoFocus initialText={initialText} onEdit={value => served.onAction({ type: 'edit', value })} preview={false} onSend={async value => { if (model.refuseAttachments(value)) return false; onSendMessage?.(); await model.send(value); return false; }} onAttachFile={onAttachFile === undefined ? undefined : model.attachFile} disabled={(model.busy || turn.state === 'waiting' || turn.state === 'unknown' || !canCompose)} />
    </div>
  </section>;
}
