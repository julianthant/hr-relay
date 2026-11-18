import { ASSISTANT_UNKNOWN_NOTICE, assistantConfirmRefusal, type AssistantProposal } from "../assistant/assistant-model.js";
import type { useAssistantController } from "../assistant/assistant-controller-model.js";
import { Fragment, useEffect, useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { ArrowDown, Check, History, Paperclip, Plus, X } from "lucide-react";
import { AssistantReply, AssistantText } from "./assistant-thread.js";
import { Button, FailureNotice, Skeleton } from '../../ds/ui.js';
import type { ComposerDraftPort } from './composer-model.js';
import { ComposerInput } from './composer-input.js';
import { useAssistantPanel, type AssistantConversationPort, type AssistantFile, type AssistantPorts } from './assistant-panel-model.js';
import { assistantActivity, type AssistantTurnPhase } from './assistant-launcher-model.js';
import './assistant-panel.css';
import { ASSISTANT_FAILURES, type AssistantFailureCode, type AssistantModelPreferenceView, type AssistantProposalRow } from '../../../models/dashboard/assistant.js';

export function AssistantFileChip({ file }: { file: AssistantFile }) {
  return <div className="hub-file-chip"><Paperclip aria-hidden /><span>{file.name}<small>{file.status} spreadsheet</small></span></div>;
}
/** A refusal about the ChatGPT account is fixed in Settings; every other refusal is answered by sending the message again. */
const accountRefusal = (code: AssistantFailureCode) => code === 'ASSISTANT_PLAN_DISABLED' || code === 'ASSISTANT_ACCOUNT_EXPIRED' || code.startsWith('CHATGPT_AUTH');
const HIDDEN_PROPOSAL_FACTS = new Set(['Input', 'Runs', 'Expires', 'Browser', 'Captures', 'Configuration', 'Options', 'Mode']);
const MODE_LABEL = { 'dry-run': 'Dry run', 'read-only': 'Read only', 'local-change': 'Local change' } as const;
/** The served card's planned rows; the server derives each row's display from the planned input. */
function proposalRows(proposal: AssistantProposal): readonly AssistantProposalRow[] {
  const issued = proposal.issued;
  return issued?.effect === 'workflow-start' ? issued.startPlan.planned : issued?.effect === 'run-action' ? [issued.row] : [];
}
function ProposalRows({ rows }: { rows: readonly AssistantProposalRow[] }) {
  return <>
    {rows.map((row, index) => <Fragment key={index}>{row.display.kind === 'person'
      ? row.display.name === undefined ? <><dt>EID</dt><dd>{row.display.employeeId}</dd></>
        : row.display.employeeId === undefined ? <><dt>Name</dt><dd>{row.display.name}</dd></>
        : <><dt>Person</dt><dd className="hub-person"><span>{row.display.name}</span> <span>EID {row.display.employeeId}</span></dd></>
      : row.display.kind === 'document' ? <><dt>Document</dt><dd>{row.display.documentNumber}</dd></>
      : row.display.kind === 'file' ? <><dt>File</dt><dd>{row.display.fileName}</dd></>
      : <><dt>Request</dt><dd>{row.title}</dd></>}</Fragment>)}
    {rows.length > 1 && <><dt>Total</dt><dd>{rows.length}</dd></>}
  </>;
}
export function ProposalCard({ proposal, disposition, refusal, onCancel, onConfirm }: { proposal: AssistantProposal; disposition: 'review' | 'edited' | 'stale' | 'cancelled' | 'confirmed' | 'confirming' | 'unknown'; refusal?: string; onCancel: () => void; onConfirm: () => void }) {
  const rows = proposalRows(proposal), only = rows.length === 1 ? rows[0] : undefined;
  const target = only === undefined ? proposal.issued?.targetLabel : only.display.kind === 'person' ? only.display.name ?? only.display.employeeId ?? only.title : only.display.kind === 'document' ? only.display.documentNumber : only.display.kind === 'file' ? only.display.fileName : only.title;
  // An unknown outcome is one plain line, carried by the transcript message.
  if (disposition === 'unknown') return null;
  if (disposition === 'confirmed' || disposition === 'cancelled') {
    const done = disposition === 'confirmed', start = proposal.issued?.effect === 'workflow-start', named = rows.length > 0 || proposal.issued?.effect === 'spreadsheet';
    return <div className="hub-resolved" aria-label="Resolved proposal"><span>{done ? <Check aria-hidden /> : <X aria-hidden />}</span><span className="hub-resolved-title">{proposal.workflow.label}{named ? <> · {target}</> : null}</span><span className="hub-resolved-status" role="status">{done ? (start ? 'Started' : 'Done') : start ? 'Not started' : 'Not done'}</span></div>;
  }
  const options = [MODE_LABEL[proposal.mode], ...proposal.values.filter(value => !HIDDEN_PROPOSAL_FACTS.has(value.label)).map(value => value.value)];
  const busy = disposition === 'confirming';
  return <article className="hub-card hub-proposal" aria-label={`Proposed ${proposal.workflow.label}`}>
    <div className="hub-card-body"><h3>{proposal.workflow.label}</h3><dl className="hub-facts">
      {proposal.issued?.effect === 'spreadsheet' ? proposal.issued.facts.map(fact => <Fragment key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></Fragment>) : <>
        <ProposalRows rows={rows} />
        <dt>Options</dt><dd>{options.join(' · ')}</dd></>}
    </dl></div>
    <footer className="hub-card-footer"><span className="hub-footer-status" role="status">{busy ? <span className="hub-spinner" aria-hidden /> : null}{refusal ?? ''}</span><span className="hub-footer-actions">
      <Button size="sm" variant="ghost" disabled={disposition !== 'review'} onClick={onCancel}>Cancel</Button>
      <Button size="sm" variant="primary" disabled={proposal.action === undefined || busy || Boolean(refusal)} onClick={onConfirm}>Confirm</Button></span></footer>
  </article>;
}
/** Bubble-shaped placeholders for a chat that is still loading; sizes match the loaded messages. */
function TranscriptSkeleton() {
  return <div role="status" aria-label="Loading chat" className="hub-transcript-skeleton">
    <div className="hub-message operator"><Skeleton className="h-4 w-36" /></div>
    <div className="hub-assistant-line"><div className="hub-message"><Skeleton className="mb-2 h-4 w-full" /><Skeleton className="mb-2 h-4 w-11/12" /><Skeleton className="h-4 w-2/3" /></div></div>
  </div>;
}
/** The prompt a refused reply answered: the operator message before it. */
const keptPrompt = (messages: readonly { role: string; text: string }[], index: number) => messages.slice(0, index).findLast(message => message.role === 'operator')?.text;
export function AssistantPanel({ conversationPort, onAttachFile, onRegisterSpreadsheet, onOpenSettings,
  onClose, onChats, onNewChat, onRename, title, headerProps, onSendMessage, draft, served, onAutomaticTitle, historyNotice, loading = false, modelPreference, initialText = '' }: AssistantPorts & {
  historyNotice?: string; loading?: boolean; modelPreference?: AssistantModelPreferenceView['preference'];
  onAutomaticTitle?: (title: string) => void; served: ReturnType<typeof useAssistantController>; conversationPort: AssistantConversationPort; onClose?: () => void; onChats?: () => void;
  onNewChat?: () => void; onRename?: () => void; title?: string; headerProps?: HTMLAttributes<HTMLElement>; onOpenSettings?: (section?: string, target?: string) => void; onSendMessage?: () => void; initialText?: string; draft?: ComposerDraftPort;
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
  const historyFailed = historyNotice === ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNAVAILABLE;
  const lastMessage = served.state.messages.at(-1);
  // Only the newest failed reply is shown, as one notice; it is never a chat bubble and an older failure is not repeated.
  const lastRefusal = lastMessage?.role === 'assistant' && lastMessage.code !== undefined ? { text: lastMessage.text, code: lastMessage.code } : undefined;
  const proposal = turn.state === 'proposal' ? turn.proposal : undefined;
  const phase: AssistantTurnPhase = turn.state === 'waiting' ? 'waiting' : turn.state === 'proposal' && turn.disposition === 'confirming' ? 'confirming' : turn.state === 'failed' || turn.state === 'unknown' ? 'failed' : 'settled';
  useEffect(() => { assistantActivity.report(phase); }, [phase]);
  return <section id="hub-panel-assistant" className="hub-assistant-panel" role="region" aria-label="Relay assistant" data-source="served">
    <header {...headerProps} className="hub-panel-header"><div className="hub-panel-title"><button type="button" className="hub-chat-title hub-plain" title="Rename chat" onClick={onRename} disabled={!onRename || loading}>{loading ? <Skeleton className="h-4 w-28" /> : <span>{title ?? conversation.title}</span>}</button></div>
      <div className="hub-header-actions"><button type="button" className="hub-icon" aria-label="History" onClick={onChats} disabled={!onChats}><History aria-hidden /></button><button type="button" className="hub-icon" aria-label="New chat" onClick={() => { if (onNewChat) onNewChat(); else model.newChat(); }} disabled={model.busy}><Plus aria-hidden /></button><button type="button" className="hub-icon" aria-label="Close assistant" onClick={onClose} disabled={!onClose}><X aria-hidden /></button></div>
    </header><div className="hub-panel-content">
      <div className="hub-thread-wrap"><><div className="hub-transcript" ref={model.transcript} role="log" aria-label="Assistant conversation" onScroll={() => { model.onScroll(); const element = model.transcript.current; if (element) wasAtLatest.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48; }}>
        {loading ? <TranscriptSkeleton /> : <>
        {historyFailed && <FailureNotice sentence="Chat history did not load." stillWorks="You can still use Relay without it." action={{ label: 'Reload', onClick: () => window.location.reload() }} />}
        {!loading && !historyFailed && served.state.messages.length === 0 ? <div className="hub-empty"><strong>How can I help?</strong>Ask about a record or describe what you want to do.</div> : null}
        {served.state.messages.map((message, index) => message.role === 'assistant' && 'code' in message && message.code !== undefined ? null
          : message.role === 'assistant' && turn.state === 'proposal' && turn.disposition === 'unknown' && message.text === ASSISTANT_UNKNOWN_NOTICE ? null : message.role === 'operator' ? <div className="hub-message operator" key={index}>{message.text}{message.attachments?.map(file => <span className="hub-sent-file" key={file.id}><Paperclip aria-hidden />{file.name}</span>)}</div> : <AssistantReply key={index}><AssistantText text={message.text} served /></AssistantReply>)}
        {conversation.files.filter(file => file.status !== 'Attached').map(file => <AssistantFileChip key={file.id} file={file} />)}
        {proposal && turn.state === 'proposal' && <ProposalCard proposal={proposal} disposition={turn.disposition} refusal={assistantConfirmRefusal(served.state, served.revision, served.accountAvailable) ?? served.confirmRefusal}
          onCancel={() => { served.onAction({ type: 'cancel' }); model.transcript.current?.closest('section')?.querySelector<HTMLTextAreaElement>('textarea')?.focus(); }}
          onConfirm={() => { served.onAction({ type: 'confirm' }); model.transcript.current?.closest('section')?.querySelector<HTMLTextAreaElement>('textarea')?.focus(); }} />}
        {turn.state === 'waiting' && <AssistantReply><div className="hub-typing" role="status"><span className="hub-typing-dots" aria-hidden><i /><i /><i /></span><span>Preparing a reply…</span><button className="hub-btn" type="button" onClick={() => served.onAction({ type: 'cancel' })}>Cancel</button></div></AssistantReply>}
        {lastRefusal !== undefined && <FailureNotice sentence={lastRefusal.text} stillWorks="Your message is kept."
          action={turn.state !== 'idle' ? undefined : accountRefusal(lastRefusal.code) ? onOpenSettings && { label: 'Open Settings', onClick: () => onOpenSettings('general', 'chatgpt.account') }
            : keptPrompt(served.state.messages, served.state.messages.length - 1) === undefined ? undefined : { label: 'Retry', onClick: () => { onSendMessage?.(); served.onAction({ type: 'edit', value: keptPrompt(served.state.messages, served.state.messages.length - 1)! }); served.onAction({ type: 'send' }); } }} />}
        {turn.state === 'failed' && <FailureNotice sentence="Reply unavailable. Your request is kept." stillWorks="Nothing was started."
          action={accountReady && served.state.draft === turn.prompt ? { label: 'Retry', onClick: () => served.onAction({ type: 'retry' }) } : undefined} />}
        {turn.state === 'proposal' && turn.disposition === 'unknown' && <FailureNotice sentence={ASSISTANT_UNKNOWN_NOTICE} stillWorks={`${turn.proposal.workflow.label} may already have started. Relay will not try it again.`}
          action={onClose ? { label: 'Check Queue', onClick: onClose } : undefined} />}
        {turn.state === 'unknown' && <p className="hub-footer-status" role="alert">{ASSISTANT_UNKNOWN_NOTICE}</p>}
        {turn.state === 'cancelled' && <p className="hub-caption" role="status">Reply cancelled. Your request is kept; send it again when ready.</p>}
        {historyNotice && !historyFailed && <p role="status" className="hub-caption">{historyNotice}</p>}
        {model.error ? <p role="alert" className="hub-footer-status">{model.error}</p> : null}
        </>}
      </div>{model.showLatest ? <button type="button" className="hub-scroll-bottom" aria-label="Scroll to latest message" onClick={() => { wasAtLatest.current = true; model.latest(); }}><ArrowDown aria-hidden /></button> : null}</></div>
      {!accountReady && !accountLoading && !loading && <div className="hub-assistant-strip" role="status"><span>{served.accountNotice}</span>{onOpenSettings && served.accountAction && served.accountAction !== 'retry' && <Button size="sm" variant={served.accountAction === 'sign-in' ? 'primary' : 'secondary'} onClick={() => onOpenSettings('general', 'chatgpt.account')}>{served.accountAction === 'sign-in' ? 'Sign in' : 'Open Settings'}</Button>}
        {served.accountAction === 'retry' && <Button size="sm" variant="secondary" onClick={served.accountRetry}>Retry</Button>}</div>}
      <ComposerInput key={conversation.id} modelLoading={loading} modelPreference={modelPreference} models={served.models} onModelChoice={served.chooseModel} draft={draft} settlementKey={served.state.messages.findLast(message => message.role === 'assistant')?.id} autoFocus initialText={initialText} onEdit={value => served.onAction({ type: 'edit', value })} preview={false} onSend={async value => { if (model.refuseAttachments(value)) return false; onSendMessage?.(); await model.send(value); return false; }} onAttachFile={onAttachFile === undefined ? undefined : model.attachFile} disabled={(model.busy || turn.state === 'waiting' || turn.state === 'unknown' || turn.state === 'proposal' && turn.disposition === 'unknown' || !canCompose)} />
    </div>
  </section>;
}
