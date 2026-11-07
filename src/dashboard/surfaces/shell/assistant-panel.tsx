import { ASSISTANT_UNKNOWN_NOTICE, assistantConfirmRefusal, type AssistantMockProposal } from "../assistant/assistant-model.js";
import type { useAssistantController } from "../assistant/assistant-controller-model.js";
import { Fragment, useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { ArrowDown, Check, History, Paperclip, Plus, Sparkles, X } from 'lucide-react';
import type { DashboardClient } from '../../client/index.js';
import { Dialog, DialogContent, DialogClose, Button } from '../../ds/ui.js';
import type { ComposerDraftPort } from './composer-model.js';
import { ComposerInput } from './composer-input.js';
import { useAssistantPanel, type AssistantConversationPort, type AssistantConversation, type AssistantFile, type AssistantPorts } from './assistant-panel-model.js';
import './assistant-panel.css';
import { type AssistantModelPreferenceView, type AssistantProposalRow } from '../../../models/dashboard/assistant.js';

export function AssistantReply({ children }: { children: React.ReactNode }) {
  return <div className="hub-assistant-line"><span className="hub-avatar" aria-hidden><Sparkles /></span><div className="hub-message">{children}</div></div>;
}
export function AssistantFileChip({ file }: { file: AssistantFile }) {
  return <div className="hub-file-chip"><Paperclip aria-hidden /><span>{file.name}<small>{file.status} spreadsheet</small></span></div>;
}
export function AssistantActionCard({ conversation, onAction, onView, onSignIn, busy }: { conversation: AssistantConversation; onAction: (action: 'approve' | 'decline' | 'cancel') => void; onView: (trigger: HTMLButtonElement) => void; onSignIn: (trigger: HTMLButtonElement) => void; busy: boolean }) {
  const scene = conversation.scene;
  if (scene === 'resolved' || scene === 'declined') return <div className="hub-resolved" aria-label="Resolved action"><span>{scene === 'declined' ? <X aria-hidden /> : <Check aria-hidden />}</span><span className="hub-resolved-title">Look up employment details and cross-check all current personnel records</span><span className="hub-resolved-status">{scene === 'declined' ? 'Declined' : 'Approved · Record checked'}</span></div>;
  const destructive = scene === 'destructive' || scene === 'delete-working', reading = scene === 'ask-read', handoff = scene === 'handoff';
  const title = destructive ? 'Delete saved draft' : reading ? 'Look up employment details' : handoff ? 'Sign in to UCPath' : 'Save to UCPath';
  const status = { 'ask-read': 'Ready to check', 'ask-write': 'Ready to save', 'permission-changed': 'Review update', working: 'Working…', cancelling: 'Cancelling…', done: 'Saved', failed: 'Not sent. Try again.', handoff: 'Sign-in needed', destructive: 'Cannot be undone.', 'delete-working': 'Working…', new: '', conversation: '', resolved: '', declined: '' }[scene];
  const working = ['working', 'delete-working', 'cancelling'].includes(scene);
  return <article className="hub-card" aria-label={title}><div className="hub-card-body"><h3>{title}</h3><dl className="hub-facts"><dt>Person</dt><dd>Alex Rivera</dd>
    {destructive ? <><dt>Draft</dt><dd>Work email change</dd></> : reading ? <><dt>System</dt><dd>UCPath</dd><dt>Details</dt><dd>Current employment record</dd></> : handoff ? <><dt>System</dt><dd>UCPath</dd></> : <><dt>Work email</dt><dd><strong>alex.rivera@example.edu</strong>{scene === 'permission-changed' ? <small className="hub-change">Updated value</small> : null}</dd></>}
  </dl></div><footer className="hub-card-footer"><span className="hub-footer-status">{working ? <span className="hub-spinner" aria-hidden /> : null}{status}</span><span className="hub-footer-actions">
    {working ? <button type="button" className="hub-btn" disabled={busy || scene === 'cancelling'} onClick={() => onAction('cancel')}>Cancel</button> : scene === 'done' ? <button type="button" className="hub-btn" onClick={event => onView(event.currentTarget)}>View record</button> : <>
      <button type="button" className="hub-btn" disabled={busy} onClick={() => onAction('decline')}>Not now</button>
      <button type="button" data-action={handoff ? 'sign-in' : 'approve'} className={`hub-btn ${destructive ? 'danger' : 'primary'}`} disabled={busy} onClick={event => handoff ? onSignIn(event.currentTarget) : onAction('approve')}>{handoff ? 'Open sign-in' : scene === 'failed' ? 'Try again' : destructive ? 'Delete' : 'Approve'}</button></>}
  </span></footer></article>;
}
const HIDDEN_PROPOSAL_FACTS = new Set(['Input', 'Runs', 'Expires', 'Browser', 'Captures', 'Configuration', 'Options', 'Mode']);
const MODE_LABEL = { 'dry-run': 'Dry run', 'read-only': 'Read only', 'local-change': 'Local change' } as const;
/** The served card's planned rows; the server derives each row's display from the planned input. */
function proposalRows(proposal: AssistantMockProposal): readonly AssistantProposalRow[] {
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
export function ProposalCard({ proposal, disposition, refusal, onCancel, onConfirm }: { proposal: AssistantMockProposal; disposition: 'review' | 'edited' | 'stale' | 'cancelled' | 'confirmed' | 'confirming' | 'unknown'; refusal?: string; onCancel: () => void; onConfirm: () => void }) {
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
export function AssistantPanel({ producer, accountClient, onAttachFile, onRegisterSpreadsheet, onRunWorkflow, onOpenSettings,
  onClose, onChats, onNewChat, onRename, title, headerProps, onSendMessage, draft, served, onAutomaticTitle, historyNotice, modelPreference, initialText = '' }: AssistantPorts & {
  historyNotice?: string; modelPreference?: AssistantModelPreferenceView['preference'];
  onAutomaticTitle?: (title: string) => void; served?: ReturnType<typeof useAssistantController>; producer: AssistantConversationPort; accountClient: Pick<DashboardClient, 'chatGptAccount'>; onClose?: () => void; onChats?: () => void;
  onNewChat?: () => void; onRename?: () => void; title?: string; headerProps?: HTMLAttributes<HTMLElement>; onOpenSettings?: (section?: string) => void; onSendMessage?: () => void; initialText?: string; draft?: ComposerDraftPort;
}) {
  const model = useAssistantPanel({ producer, accountClient, served, ports: { onAttachFile, onRegisterSpreadsheet, onRunWorkflow } });
  const conversation = model.conversation, workflow = conversation.workflow;
  const wasAtLatest = useRef(true);
  const detailTrigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => { const element = model.transcript.current; if (element && wasAtLatest.current) element.scrollTop = element.scrollHeight; }, [conversation, served?.state, model.transcript]);
  const actionScene = conversation.scene !== 'new' && conversation.scene !== 'conversation';
  const ready = workflow?.rows.filter(row => row.issue === null).length ?? 0;
  const accountReady = served ? served.accountAvailable : model.account?.state === 'connected';
  const canCompose = served?.canCompose ?? accountReady;
  const turn = served?.state.turn;
  const proposal = turn?.state === 'proposal' ? turn.proposal : undefined;
  return <section id="hub-panel-assistant" className="hub-assistant-panel" role="region" aria-label="Relay assistant" data-source={served ? "served" : conversation.source}>
    <header {...headerProps} className="hub-panel-header"><div className="hub-panel-title"><button type="button" className="hub-chat-title hub-plain" title="Rename chat" onClick={onRename} disabled={!onRename}><span>{title ?? conversation.title}</span></button></div>
      <div className="hub-header-actions"><button type="button" className="hub-icon" aria-label="Chats" onClick={onChats} disabled={!onChats}><History aria-hidden /></button><button type="button" className="hub-icon" aria-label="New chat" onClick={() => { if (onNewChat) onNewChat(); else model.newChat(); }} disabled={model.busy}><Plus aria-hidden /></button><button type="button" className="hub-icon" aria-label="Close assistant" onClick={onClose} disabled={!onClose}><X aria-hidden /></button></div>
    </header><div className="hub-panel-content">
      <div className="hub-thread-wrap"><><div className="hub-transcript" ref={model.transcript} role="log" aria-label="Assistant conversation" onScroll={() => { model.onScroll(); const element = model.transcript.current; if (element) wasAtLatest.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48; }}>
        {(served ? served.state.messages.length === 0 : conversation.scene === 'new') ? <div className="hub-empty"><strong>How can I help?</strong>Ask about a record or describe what you want to do.</div> : null}
        {!served && actionScene ? <><div className="hub-message operator">Update Alex Rivera’s work email.</div><AssistantReply>I found the record. Review the change before I save it.</AssistantReply><AssistantActionCard conversation={conversation} busy={model.busy} onAction={action => { void model.act(action); }} onView={trigger => { detailTrigger.current = trigger; model.setDetail('record'); }} onSignIn={trigger => { detailTrigger.current = trigger; model.setDetail('sign-in'); }} /></> : null}
        {!served && workflow ? <><p className="hub-caption">Sample workflow · synthetic records</p><AssistantFileChip file={workflow.file} /></> : null}
        {(served?.state.messages ?? conversation.messages).map((message, index) => message.role === 'operator' ? <div className="hub-message operator" key={index}>{message.text}{message.attachments?.map(file => <span className="hub-sent-file" key={file.id}><Paperclip aria-hidden />{file.name}</span>)}</div> : <AssistantReply key={index}>{message.text}</AssistantReply>)}
        {!served && workflow ? <>{workflow.state === 'review' ? <><AssistantReply>I found {ready} ready rows. {workflow.rows.filter(row => row.issue !== null).map(row => `${row.person} is missing a required ${row.issue === 'Needs date' ? 'date' : 'name'} and will stay on hold.`).join(' ')}</AssistantReply><article className="hub-card"><div className="hub-card-body"><h3>Review {workflow.label}</h3>{workflow.rows.map(row => <div className="hub-demo-row" key={`${row.sheet}:${row.row}`}><span>{row.person}</span><span>{row.issue ?? 'Ready'}</span></div>)}</div><footer className="hub-card-footer"><span className="hub-footer-status">{ready} ready · {workflow.rows.length - ready} on hold</span><button type="button" className="hub-btn primary" disabled={!ready || !onRunWorkflow || model.busy} onClick={() => { void model.runWorkflow(); }}>Run {ready} {workflow.label}</button></footer></article></> : workflow.state === 'running' ? <article className="hub-card"><div className="hub-card-body"><h3>Running {workflow.label}</h3><div className="hub-demo-row"><span>Read spreadsheet</span><span><Check aria-hidden /> Done</span></div><div className="hub-demo-row"><span>Validate rows</span><span><Check aria-hidden /> Done</span></div><div className="hub-demo-row"><span>Process records</span><span>Waiting for results</span></div></div><footer className="hub-card-footer"><span className="hub-footer-status">Sample run</span></footer></article> : workflow.state === 'complete' ? <AssistantReply>The sample run is complete. {ready} rows were processed; {workflow.rows.length - ready} stays on hold. Your updated spreadsheet and results are ready.</AssistantReply> : <p className="hub-footer-status" role="status">{workflow.message}</p>}</> : null}
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
        {!served && !model.account ? <p role="status" className="hub-caption">{model.error ? 'ChatGPT account unavailable.' : 'Loading ChatGPT account…'}</p> : !served && !accountReady ? <p role="status" className="hub-caption">ChatGPT is unavailable. Open Settings to review your account.</p> : null}
      </div>{model.showLatest ? <button type="button" className="hub-scroll-bottom" aria-label="Scroll to latest message" onClick={() => { wasAtLatest.current = true; model.latest(); }}><ArrowDown aria-hidden /></button> : null}</></div>
      {served && !accountReady && <div className="hub-assistant-strip" role="status"><span>{served.accountNotice}</span>{onOpenSettings && served.accountAction && <Button size="sm" variant={served.accountAction === 'sign-in' ? 'primary' : 'secondary'} onClick={() => onOpenSettings(served.accountAction === 'preflight' ? 'preflight' : 'general')}>{served.accountAction === 'preflight' ? 'Open Preflight' : served.accountAction === 'sign-in' ? 'Sign in' : 'Open Settings'}</Button>}</div>}
      <ComposerInput key={conversation.id} modelPreference={modelPreference} draft={draft} settlementKey={served?.state.messages.findLast(message => message.role === 'assistant')?.id} autoFocus={conversation.scene === 'new'} initialText={initialText} onEdit={served ? value => served.onAction({ type: 'edit', value }) : undefined} preview={!served} onSend={async value => { if (model.refuseAttachments(value)) return false;  onSendMessage?.(); const sent = await model.send(value); if (served && sent && title === 'New chat') onAutomaticTitle?.(value.text.slice(0, 55)); return served ? false : sent; }} onAttachFile={onAttachFile === undefined ? undefined : model.attachFile} disabled={model.busy || turn?.state === 'waiting' || turn?.state === 'unknown' || turn?.state === 'proposal' && turn.disposition === 'unknown' || !canCompose} />
    </div>
    <Dialog open={model.detail !== null} onOpenChange={open => { if (!open) model.setDetail(null); }}><DialogContent title={model.detail === 'sign-in' ? 'Sign in to UCPath' : 'Work email saved'} className="hub-assistant-detail" hideClose onCloseAutoFocus={event => { event.preventDefault(); if (detailTrigger.current?.isConnected) detailTrigger.current.focus(); }}>{model.detail === 'sign-in' ? <p>Complete sign-in in your browser, then return here.</p> : <p>Alex Rivera<br /><strong>alex.rivera@example.edu</strong></p>}<footer><DialogClose className="hub-btn">Close</DialogClose>{model.detail === 'sign-in' ? <DialogClose className="hub-btn primary" onClick={model.finishMockSignIn}>Simulate signed in</DialogClose> : null}</footer></DialogContent></Dialog>
  </section>;
}
