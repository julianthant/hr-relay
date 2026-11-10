import { ASSISTANT_UNKNOWN_NOTICE, assistantConfirmRefusal, type AssistantMockProposal } from "../assistant/assistant-model.js";
import type { useAssistantController } from "../assistant/assistant-controller-model.js";
import { useEffect, useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { ArrowDown, Check, History, Paperclip, Plus, X } from "lucide-react";
import { assistantFrame, ASSISTANT_FRAMES } from "../assistant/assistant-mock-frames.js";
import { AssistantMockThread } from "./assistant-mock-thread.js";
import type { DashboardClient } from '../../client/index.js';
import { Button } from '../../ds/ui.js';
import type { ComposerDraftPort } from './composer-model.js';
import { ComposerInput } from './composer-input.js';
import { useAssistantPanel, type AssistantConversationPort, type AssistantFile, type AssistantPorts } from './assistant-panel-model.js';
import { assistantActivity, type AssistantTurnPhase } from './assistant-launcher-model.js';
import './assistant-panel.css';
import { type AssistantModelPreferenceView } from '../../../models/dashboard/assistant.js';

export function AssistantReply({ children }: { children: React.ReactNode }) {
  return <div className="hub-assistant-line"><div className="hub-message">{children}</div></div>;
}
export function AssistantFileChip({ file }: { file: AssistantFile }) {
  return <div className="hub-file-chip"><Paperclip aria-hidden /><span>{file.name}<small>{file.status} spreadsheet</small></span></div>;
}
const HIDDEN_PROPOSAL_FACTS = new Set(['Input', 'Runs', 'Expires', 'Browser', 'Captures', 'Configuration', 'Options', 'Mode']);
const MODE_LABEL = { 'dry-run': 'Dry run', 'read-only': 'Read only', 'local-change': 'Local change' } as const;
function proposalPeople(proposal: AssistantMockProposal): readonly { name: string; id?: string }[] {
  if (proposal.startPlan) return [{ name: proposal.person?.name ?? proposal.startPlan.planned[0]?.title ?? '', ...(proposal.person?.employeeId ? { id: proposal.person.employeeId } : {}) }];
  return proposal.subjects.map(subject => ({ name: subject.name, id: subject.id }));
}
export function ProposalCard({ proposal, disposition, refusal, onCancel, onConfirm }: { proposal: AssistantMockProposal; disposition: 'review' | 'edited' | 'stale' | 'cancelled' | 'confirmed' | 'confirming' | 'unknown'; refusal?: string; onCancel: () => void; onConfirm: () => void }) {
  const people = proposalPeople(proposal);
  const peopleLabel = people.length === 1 ? (people[0]?.name ?? '') : `${String(people.length)} people`;
  if (disposition === 'confirmed' || disposition === 'cancelled') {
    const done = disposition === 'confirmed';
    return <div className="hub-resolved" aria-label="Resolved proposal"><span>{done ? <Check aria-hidden /> : <X aria-hidden />}</span><span className="hub-resolved-title">{proposal.workflow.label}{people.length ? ` · ${peopleLabel}` : ''}</span><span className="hub-resolved-status" role="status">{done ? (proposal.startPlan ? 'Started' : 'Done') : 'Not started'}</span></div>;
  }
  const options = [MODE_LABEL[proposal.mode], ...proposal.values.filter(value => !HIDDEN_PROPOSAL_FACTS.has(value.label)).map(value => value.value)];
  const busy = disposition === 'confirming', unknown = disposition === 'unknown';
  return <article className="hub-card hub-proposal" aria-label={`Proposed ${proposal.workflow.label}`}>
    <div className="hub-card-body"><h3>{proposal.workflow.label}</h3><dl className="hub-facts">
      {proposal.person ? <><dt>Name</dt><dd>{proposal.person.name ?? 'Not provided'}</dd><dt>EID</dt><dd>{proposal.person.employeeId ?? 'Not provided'}</dd></>
        : proposal.startPlan ? <><dt>Request</dt><dd>{proposal.startPlan.planned[0]?.title}</dd></>
        : people.length > 0 && <><dt>Name</dt><dd>{people.map(person => <div key={`${person.name}:${person.id ?? ''}`}>{person.name}</div>)}</dd><dt>EID</dt><dd>{people.map(person => <div key={`${person.name}:${person.id ?? ''}`}>{person.id}</div>)}</dd></>}
      <dt>Options</dt><dd>{options.join(' · ')}</dd>
    </dl></div>
    <footer className="hub-card-footer"><span className="hub-footer-status" role={unknown ? 'alert' : 'status'}>{busy ? <span className="hub-spinner" aria-hidden /> : null}{refusal ?? ''}</span><span className="hub-footer-actions">
      <Button size="sm" variant="ghost" disabled={disposition !== 'review'} onClick={onCancel}>Cancel</Button>
      <Button size="sm" variant="primary" disabled={proposal.action === undefined || Boolean(refusal)} onClick={onConfirm}>Confirm</Button></span></footer>
  </article>;
}
export function AssistantPanel({ producer, accountClient, onAttachFile, onRegisterSpreadsheet, onRunWorkflow, onOpenSettings,
  onClose, onChats, onNewChat, onRename, title, headerProps, fresh = false, onSendMessage, draft, served, onAutomaticTitle, historyNotice, modelPreference, initialText = '' }: AssistantPorts & {
  fresh?: boolean; historyNotice?: string; modelPreference?: AssistantModelPreferenceView['preference'];
  onAutomaticTitle?: (title: string) => void; served?: ReturnType<typeof useAssistantController>; producer: AssistantConversationPort; accountClient: Pick<DashboardClient, 'chatGptAccount'>; onClose?: () => void; onChats?: () => void;
  onNewChat?: () => void; onRename?: () => void; title?: string; headerProps?: HTMLAttributes<HTMLElement>; onOpenSettings?: (section?: string) => void; onSendMessage?: () => void; initialText?: string; draft?: ComposerDraftPort;
}) {
  const model = useAssistantPanel({ producer, accountClient, served, ports: { onAttachFile, onRegisterSpreadsheet, onRunWorkflow } });
  // The mock chat opens on the first approved frame; a served chat starts empty.
  const frame = fresh ? undefined : assistantFrame() ?? (served ? undefined : ASSISTANT_FRAMES[0]);
  if (frame) { title = frame.title; initialText = frame.draft ?? ""; }
  const conversation = model.conversation;
  const wasAtLatest = useRef(true);
  useLayoutEffect(() => { const element = model.transcript.current; if (element && wasAtLatest.current) element.scrollTop = element.scrollHeight; }, [conversation, served?.state, model.transcript]);
  // A new mock chat is always ready to compose; the served account decides for served chats.
  const accountReady = served ? served.accountAvailable : fresh || model.account?.state === 'connected';
  const canCompose = served?.canCompose ?? accountReady;
  const turn = served?.state.turn;
  const proposal = turn?.state === 'proposal' ? turn.proposal : undefined;
  const phase: AssistantTurnPhase = turn?.state === 'waiting' || !served && model.busy ? 'waiting' : turn?.state === 'proposal' && turn.disposition === 'confirming' ? 'confirming' : turn?.state === 'failed' || turn?.state === 'unknown' ? 'failed' : 'settled';
  useEffect(() => { assistantActivity.report(phase); }, [phase]);
  return <section id="hub-panel-assistant" className="hub-assistant-panel" role="region" aria-label="Relay assistant" data-source={served ? "served" : conversation.source}>
    <header {...headerProps} className="hub-panel-header"><div className="hub-panel-title"><button type="button" className="hub-chat-title hub-plain" title="Rename chat" onClick={onRename} disabled={!onRename}><span>{title ?? conversation.title}</span></button></div>
      <div className="hub-header-actions"><button type="button" className="hub-icon" aria-label="History" onClick={onChats} disabled={!onChats}><History aria-hidden /></button><button type="button" className="hub-icon" aria-label="New chat" onClick={() => { if (onNewChat) onNewChat(); else model.newChat(); }} disabled={model.busy}><Plus aria-hidden /></button><button type="button" className="hub-icon" aria-label="Close assistant" onClick={onClose} disabled={!onClose}><X aria-hidden /></button></div>
    </header><div className="hub-panel-content">
      <div className="hub-thread-wrap"><><div className="hub-transcript" ref={model.transcript} role="log" aria-label="Assistant conversation" onScroll={() => { model.onScroll(); const element = model.transcript.current; if (element) wasAtLatest.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48; }}>
        {frame && <AssistantMockThread frame={frame} />}<>
        {!frame && (served ? served.state.messages.length === 0 : conversation.scene === 'new') ? <div className="hub-empty"><strong>How can I help?</strong>Ask about a record or describe what you want to do.</div> : null}
        {(served?.state.messages ?? conversation.messages).map((message, index) => message.role === 'operator' ? <div className="hub-message operator" key={index}>{message.text}{message.attachments?.map(file => <span className="hub-sent-file" key={file.id}><Paperclip aria-hidden />{file.name}</span>)}</div> : <AssistantReply key={index}>{message.text}</AssistantReply>)}
        {conversation.files.filter(file => file.status !== 'Attached').map(file => <AssistantFileChip key={file.id} file={file} />)}
        {served && proposal && turn?.state === 'proposal' && <ProposalCard proposal={proposal} disposition={turn.disposition} refusal={assistantConfirmRefusal(served.state, served.revision, served.accountAvailable) ?? served.confirmRefusal}
          onCancel={() => { served.onAction({ type: 'cancel' }); model.transcript.current?.closest('section')?.querySelector<HTMLTextAreaElement>('textarea')?.focus(); }}
          onConfirm={() => { served.onAction({ type: 'confirm' }); model.transcript.current?.closest('section')?.querySelector<HTMLTextAreaElement>('textarea')?.focus(); }} />}
        {served && turn?.state === 'waiting' && <p className="hub-footer-status" role="status">Preparing a reply…<button className="hub-btn" type="button" onClick={() => served.onAction({ type: 'cancel' })}>Cancel</button></p>}
        {served && turn?.state === 'failed' && <p className="hub-footer-status" role="alert">Reply unavailable. Your request is kept.<button className="hub-btn" type="button" disabled={!accountReady || served.state.draft !== turn.prompt} onClick={() => served.onAction({ type: 'retry' })}>Retry reply</button></p>}
        {served && turn?.state === 'unknown' && <p className="hub-footer-status" role="alert">{ASSISTANT_UNKNOWN_NOTICE}</p>}
        {served && turn?.state === 'cancelled' && <p className="hub-caption" role="status">Reply cancelled. Your request is kept; send it again when ready.</p>}
        {served?.state.restored && <p className="hub-caption">Restored chat. Previous proposals cannot be confirmed.</p>}
        {historyNotice && <p role="status" className="hub-caption">{historyNotice}</p>}
        {model.error ? <p role="alert" className="hub-footer-status">{model.error}</p> : null}
        {frame || fresh ? null : !served && !model.account ? <p role="status" className="hub-caption">{model.error ? 'ChatGPT account unavailable.' : 'Loading ChatGPT account…'}</p> : !served && !accountReady ? <p role="status" className="hub-caption">ChatGPT is unavailable. Open Settings to review your account.</p> : null}
        </>
      </div>{model.showLatest ? <button type="button" className="hub-scroll-bottom" aria-label="Scroll to latest message" onClick={() => { wasAtLatest.current = true; model.latest(); }}><ArrowDown aria-hidden /></button> : null}</></div>
      {served && !accountReady && <div className="hub-assistant-strip" role="status"><span>{served.accountNotice}</span>{onOpenSettings && served.accountAction && <Button size="sm" variant={served.accountAction === 'sign-in' ? 'primary' : 'secondary'} onClick={() => onOpenSettings(served.accountAction === 'preflight' ? 'preflight' : 'general')}>{served.accountAction === 'preflight' ? 'Open Preflight' : served.accountAction === 'sign-in' ? 'Sign in' : 'Open Settings'}</Button>}</div>}
      <ComposerInput key={conversation.id} modelPreference={modelPreference} draft={frame ? undefined : draft} settlementKey={served?.state.messages.findLast(message => message.role === 'assistant')?.id} autoFocus={conversation.scene === 'new'} initialText={initialText} onEdit={served ? value => served.onAction({ type: 'edit', value }) : undefined} preview={!served} onSend={async value => { if (model.refuseAttachments(value)) return false;  onSendMessage?.(); const sent = await model.send(value); if (served && sent && title === 'New chat') onAutomaticTitle?.(value.text.slice(0, 55)); return served ? false : sent; }} onAttachFile={onAttachFile === undefined ? undefined : model.attachFile} disabled={!frame && (model.busy || turn?.state === 'waiting' || turn?.state === 'unknown' || turn?.state === 'proposal' && turn.disposition === 'unknown' || !canCompose)} />
    </div>
  </section>;
}
