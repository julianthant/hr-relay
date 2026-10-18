import { useCallback, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ArrowDown, ArrowUp, Check, ChevronDown, CircleAlert, Copy, FileCheck2, Link2, Plus, RotateCcw, Sparkles, Square, X } from 'lucide-react';
import { Button, Disclosure, FloatingSurface, IconButton, Popover, PopoverClose, PopoverTrigger, Textarea, Tooltip } from '../../ds/ui.js';
import { OverlayLayerPresence } from '../../ds/primitives/primitives-overlay.js';
import { dsFocus, dsIcon, dsLayer } from '../../ds/theme/tokens.js';
import { ASSISTANT_STARTERS, assistantConfirmRefusal, type AssistantAction, type AssistantMockProposal, type AssistantState } from './assistant-model.js';
import './assistant.css';

export function AssistantPanel({ state, revision, accountAvailable, onAction, onMockConfirm, defaultOpen = false }: {
  state: AssistantState;
  revision: string;
  accountAvailable: boolean;
  onAction: (action: AssistantAction) => void;
  onMockConfirm: (proposal: AssistantMockProposal) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{ id: string; copied: boolean } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement | null>(null);
  const followLatest = useRef(true);
  const confirmed = useRef(new Set<string>());
  const turn = state.turn;
  const refusal = assistantConfirmRefusal(state, revision, accountAvailable);
  const waiting = turn.state === 'waiting';
  const transcriptRef = useCallback((node: HTMLDivElement | null) => {
    transcript.current = node;
    if (!node || !state.messages.length) return;
    const settle = () => { if (followLatest.current) node.scrollTop = node.scrollHeight; };
    const observer = new ResizeObserver(settle);
    observer.observe(node);
    settle();
    return () => observer.disconnect();
  }, [state.messages]);
  const preserveActionFocus = useCallback((button: HTMLButtonElement | null) => {
    if (!button) return;
    return () => { if (document.activeElement === button) composer.current?.focus({ preventScroll: true }); };
  }, []);
  function dispatchAndFocus(type: 'cancel' | 'retry' | 'confirm' | 'send' | 'new-chat') {
    composer.current?.focus({ preventScroll: true });
    if (type === 'send' || type === 'retry' || type === 'new-chat') followLatest.current = true;
    if (type === 'new-chat') { setCopyFeedback(null); setAwayFromLatest(false); }
    onAction({ type });
  }
  function confirm() {
    if (turn.state !== 'proposal' || refusal || confirmed.current.has(turn.proposal.id)) return;
    confirmed.current.add(turn.proposal.id);
    dispatchAndFocus('confirm');
    onMockConfirm(turn.proposal);
  }
  async function copyReply(id: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopyFeedback({ id, copied: true }); }
    catch { setCopyFeedback({ id, copied: false }); }
  }
  const proposal = turn.state === 'proposal' && <section key={turn.proposal.id} className="assistant-proposal" role="region" aria-label="Proposed run details" tabIndex={0}>
    <div className="assistant-proposal-heading">
      <FileCheck2 aria-hidden size={18} />
      <div><p>Proposed run</p><h3>{turn.proposal.workflow.label}</h3></div>
      <span className="assistant-mode">{turn.proposal.mode === 'dry-run' ? 'Dry run' : 'Read only'}</span>
    </div>
    <dl className="assistant-facts">
      <dt>Subjects</dt><dd>{turn.proposal.subjects.map(subject => <div key={subject.id}>{subject.name} <span className="assistant-id">{subject.id}</span></div>)}</dd>
      {turn.proposal.values.map(value => <div className="assistant-fact" key={value.label}><dt>{value.label}</dt><dd>{value.value}</dd></div>)}
    </dl>
    <Disclosure className="assistant-run-disclosure" summary="Effects and stop points" contentClassName="assistant-run-content">
      <dl className="assistant-facts"><dt>Workflow</dt><dd>{turn.proposal.workflow.version}<br />{turn.proposal.workflow.id}</dd>
        <dt>Effects</dt><dd><ul>{turn.proposal.effects.map(effect => <li key={effect}>{effect}</li>)}</ul></dd>
        <dt>Stop before</dt><dd><ul>{turn.proposal.stopBefore.map(stop => <li key={stop}>{stop}</li>)}</ul></dd>
      </dl>
    </Disclosure>
    <div className="assistant-proposal-footer">
      <p role="status" className="assistant-proposal-notice">{turn.disposition === 'confirmed' && <Check aria-hidden size={14} />}{refusal ?? 'Review the details before confirming. No run will start.'}</p>
      <div className="assistant-actions"><Button size="sm" disabled={turn.disposition === 'cancelled' || turn.disposition === 'confirmed'} onClick={() => dispatchAndFocus('cancel')}>Cancel</Button><Button size="sm" variant="primary" disabled={Boolean(refusal)} onClick={confirm}>Confirm</Button></div>
    </div>
  </section>;
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><IconButton label="Assistant" className={`assistant-launcher ${dsLayer.menu}`} icon={open ? <ChevronDown aria-hidden size={22} /> : <Sparkles aria-hidden size={22} />} /></PopoverTrigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content asChild side="top" align="end" sideOffset={16} collisionPadding={16} aria-label="Relay assistant" onInteractOutside={event => event.preventDefault()} onOpenAutoFocus={event => {
        event.preventDefault(); composer.current?.focus({ preventScroll: true });
      }}>
        <FloatingSurface className={`assistant-panel ${dsLayer.menu}`}>
          <OverlayLayerPresence />
          <header className="assistant-header">
            <div><h2>Relay assistant</h2><p><span className="assistant-status-dot" />Mock preview</p></div>
            <div className="assistant-header-actions"><Tooltip content="New chat"><IconButton label="New chat" icon={<Plus aria-hidden size={16} />} onClick={() => dispatchAndFocus('new-chat')} /></Tooltip><PopoverClose asChild><IconButton label="Close assistant" icon={<X aria-hidden size={16} />} /></PopoverClose></div>
          </header>
          <div className="assistant-thread">
            <div ref={transcriptRef} className="assistant-transcript" role="region" aria-label="Conversation" tabIndex={0} onScroll={event => {
              const node = event.currentTarget;
              const nearLatest = node.scrollHeight - node.scrollTop - node.clientHeight < 48;
              followLatest.current = nearLatest; setAwayFromLatest(!nearLatest);
            }}>
              {state.messages.length === 0 && <div className="assistant-empty"><Sparkles aria-hidden size={24} /><h3>How can I help you?</h3><p>Ask a question or prepare a run to review.</p><div className="assistant-suggestions">{ASSISTANT_STARTERS.map(prompt => <button key={prompt} type="button" className={dsFocus} onClick={() => { onAction({ type: 'edit', value: prompt }); composer.current?.focus({ preventScroll: true }); }}>{prompt}</button>)}</div></div>}
              <ol className="assistant-messages">{state.messages.map((message, index) => <li key={message.id} className={`assistant-message assistant-message-${message.role}`}>
                {message.role === 'assistant' && <p className="assistant-speaker"><Sparkles aria-hidden size={13} />Relay</p>}
                <p className="assistant-message-text">{message.text}</p>
                {message.sources?.map(source => <Disclosure key={source.id} className="assistant-source" summary={<span className="assistant-source-label"><Link2 aria-hidden size={12} /><span>Source: {source.title}</span></span>} contentClassName="assistant-source-content">
                  <p>{source.excerpt}</p><p className="assistant-source-version">{source.version}</p><a className={dsFocus} href={source.url} target="_blank" rel="noopener noreferrer">{source.url} (opens a new tab)</a>
                </Disclosure>)}
                {index === state.messages.length - 1 && proposal}
                {message.role === 'assistant' && <div className="assistant-message-actions"><Tooltip content="Copy reply"><IconButton label="Copy reply" size="xs" icon={copyFeedback?.id === message.id && copyFeedback.copied ? <Check aria-hidden className={dsIcon.md} /> : <Copy aria-hidden className={dsIcon.md} />} onClick={() => { void copyReply(message.id, message.text); }} /></Tooltip>{copyFeedback?.id === message.id && <span role="status">{copyFeedback.copied ? 'Copied' : 'Could not copy. Select the reply text.'}</span>}</div>}
              </li>)}</ol>
              {waiting && <div className="assistant-thinking" role="status"><span className="assistant-thinking-dots" aria-hidden><i /><i /><i /></span>Preparing a proposal…</div>}
              {turn.state === 'failed' && <div className="assistant-error"><CircleAlert aria-hidden size={16} /><div role="alert"><strong>Reply unavailable</strong><p>Your request is kept. Try again.</p></div><Button ref={preserveActionFocus} size="sm" variant="ghost" icon={<RotateCcw aria-hidden size={13} />} disabled={!accountAvailable || state.draft !== turn.prompt} onClick={() => dispatchAndFocus('retry')}>Retry reply</Button></div>}
              {turn.state === 'cancelled' && <p className="assistant-cancelled" role="status">Reply cancelled. Your request is kept; send it again when ready.</p>}
            </div>
            {awayFromLatest && <button type="button" className={`assistant-latest ${dsFocus}`} onClick={() => { followLatest.current = true; transcript.current?.scrollTo({ top: transcript.current.scrollHeight }); composer.current?.focus({ preventScroll: true }); }}><ArrowDown aria-hidden size={14} />Jump to latest</button>}
          </div>
          <form className="assistant-composer" onSubmit={event => { event.preventDefault(); if (accountAvailable && !waiting && state.draft.trim()) dispatchAndFocus('send'); }}>
            {!accountAvailable && <div className="assistant-account" role="alert"><CircleAlert aria-hidden size={15} /><div><strong>ChatGPT not connected</strong><p>Review the connection in Settings. This mock cannot sign in.</p></div></div>}
            <div className="assistant-input-card">
              <Textarea ref={composer} className="assistant-compose-input" aria-label="Message" placeholder="Send a message…" rows={2} value={state.draft} onChange={event => onAction({ type: 'edit', value: event.target.value })} onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
              }} />
              <div className="assistant-send"><span>Enter to send · Shift+Enter for a new line</span>{waiting ? <IconButton key="stop" ref={preserveActionFocus} label="Stop reply" className="assistant-send-button" icon={<Square aria-hidden size={13} fill="currentColor" />} onClick={() => dispatchAndFocus('cancel')} /> : <IconButton key="send" type="submit" label="Send" className="assistant-send-button" icon={<ArrowUp aria-hidden size={17} />} disabled={!accountAvailable || !state.draft.trim()} />}</div>
            </div>
            <p className="assistant-footnote">Scripted preview · Synthetic data · No runs start</p>
          </form>
        </FloatingSurface>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </Popover>;
}
