import { useCallback, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { ArrowUp, MessageSquare, X } from 'lucide-react';
import { Button, Disclosure, Field, FloatingSurface, IconButton, Popover, PopoverClose, PopoverTrigger, Spinner, Textarea } from '../../ds/ui.js';
import { OverlayLayerPresence } from '../../ds/primitives/primitives-overlay.js';
import { dsFocus, dsIcon, dsLayer, dsText } from '../../ds/theme/tokens.js';
import { assistantConfirmRefusal, type AssistantAction, type AssistantMockProposal, type AssistantState } from './assistant-model.js';
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
  const composer = useRef<HTMLTextAreaElement>(null);
  const confirmed = useRef(new Set<string>());
  const turn = state.turn;
  const refusal = assistantConfirmRefusal(state, revision, accountAvailable);
  const waiting = turn.state === 'waiting';
  const transcriptRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || !state.messages.length) return;
    const observer = new ResizeObserver(() => { node.scrollTop = node.scrollHeight; });
    observer.observe(node);
    node.scrollTop = node.scrollHeight;
    return () => observer.disconnect();
  }, [state.messages]);
  const preserveActionFocus = useCallback((button: HTMLButtonElement | null) => {
    if (!button) return;
    return () => { if (document.activeElement === button) composer.current?.focus(); };
  }, []);
  function dispatchAndFocus(type: 'cancel' | 'retry' | 'confirm' | 'send') {
    composer.current?.focus();
    onAction({ type });
  }
  function confirm() {
    if (turn.state !== 'proposal' || refusal || confirmed.current.has(turn.proposal.id)) return;
    confirmed.current.add(turn.proposal.id);
    dispatchAndFocus('confirm');
    onMockConfirm(turn.proposal);
  }
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button className={`assistant-launcher ${dsLayer.menu}`} icon={<MessageSquare aria-hidden className={dsIcon.md} />}>Assistant</Button></PopoverTrigger>
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content asChild side="top" align="end" sideOffset={8} collisionPadding={16} aria-label="Relay assistant" onOpenAutoFocus={event => {
        event.preventDefault();
        composer.current?.focus();
      }}>
        <FloatingSurface className={`assistant-panel ${dsLayer.menu}`}>
          <OverlayLayerPresence />
          <header className="assistant-header">
            <div><h2 className={dsText.title}>Relay assistant</h2><p className={dsText.meta}>Mock preview · Nothing runs from this panel</p></div>
            <PopoverClose asChild><IconButton label="Close assistant" icon={<X aria-hidden className={dsIcon.md} />} /></PopoverClose>
          </header>
          <div ref={transcriptRef} className="assistant-transcript" role="region" aria-label="Conversation" tabIndex={0}>
            {state.messages.length === 0 && <div className="assistant-empty"><h3 className={dsText.title}>What would you like to do?</h3><p>Ask about a workflow or prepare a run to review.</p></div>}
            <ol className="assistant-messages">{state.messages.map(message => <li key={message.id} className={`assistant-message assistant-message-${message.role}`}>
              <p className={`assistant-speaker ${dsText.meta}`}>{message.role === 'operator' ? 'You' : 'Assistant'}</p>
              <p className="assistant-message-text">{message.text}</p>
              {message.sources?.map(source => <Disclosure key={source.id} summary={`Source: ${source.title}`}>
                <p>{source.excerpt}</p><p className={dsText.meta}>{source.version}</p>
                <a className={dsFocus} href={source.url} target="_blank" rel="noopener noreferrer">{source.url} (opens a new tab)</a>
              </Disclosure>)}
            </li>)}</ol>
          </div>
          <div className="assistant-decision" aria-label="Current proposal">
            {turn.state === 'proposal' && <>
              <div className="assistant-proposal-heading"><h3 className={dsText.ui}>Proposed run</h3><span className={dsText.meta}>{turn.proposal.mode === 'dry-run' ? 'Dry run' : 'Read only'}</span></div>
              <div className="assistant-proposal-details" role="region" aria-label="Proposed run details" tabIndex={0}>
                <dl className="assistant-facts"><dt>Workflow</dt><dd>{turn.proposal.workflow.label} · {turn.proposal.workflow.version}<br /><span className={dsText.meta}>{turn.proposal.workflow.id}</span></dd>
                  <dt>Subjects</dt><dd>{turn.proposal.subjects.map(subject => <div key={subject.id}>{subject.name} <span className={dsText.nums}>{subject.id}</span></div>)}</dd>
                  {turn.proposal.values.map(value => <div className="assistant-fact" key={value.label}><dt>{value.label}</dt><dd>{value.value}</dd></div>)}
                  <dt>Effects</dt><dd><ul>{turn.proposal.effects.map(effect => <li key={effect}>{effect}</li>)}</ul></dd>
                  <dt>Stop before</dt><dd><ul>{turn.proposal.stopBefore.map(stop => <li key={stop}>{stop}</li>)}</ul></dd>
                </dl>
              </div>
              <p className={`assistant-notice ${dsText.meta}`} role="status">{refusal ?? 'Confirm records this proposal once in the mock. It starts no run.'}</p>
              <div className="assistant-actions"><Button size="sm" disabled={turn.disposition === 'cancelled' || turn.disposition === 'confirmed'} onClick={() => dispatchAndFocus('cancel')}>Cancel</Button><Button size="sm" variant="primary" disabled={Boolean(refusal)} onClick={confirm}>Confirm</Button></div>
            </>}
            {waiting && <div className="assistant-status"><span role="status"><Spinner label="Preparing a proposal" />Preparing a proposal…</span><Button ref={preserveActionFocus} size="sm" onClick={() => dispatchAndFocus('cancel')}>Cancel reply</Button></div>}
            {turn.state === 'failed' && <div className="assistant-status"><p role="alert">Reply unavailable. Your request is kept.</p><Button ref={preserveActionFocus} size="sm" disabled={!accountAvailable || state.draft !== turn.prompt} onClick={() => dispatchAndFocus('retry')}>Retry reply</Button></div>}
            {turn.state === 'cancelled' && <p role="status">Reply cancelled. Your request is kept; send it again when ready.</p>}
          </div>
          <form className="assistant-composer" onSubmit={event => { event.preventDefault(); if (accountAvailable && !waiting) dispatchAndFocus('send'); }}>
            {!accountAvailable && <p role="alert">ChatGPT account unavailable. Review the connection in Settings. This mock cannot sign in.</p>}
            <Field label="Message" description="Scripted demo: replies use fixed synthetic subjects."><Textarea ref={composer} rows={2} value={state.draft} onChange={event => onAction({ type: 'edit', value: event.target.value })} /></Field>
            <div className="assistant-send"><span className={dsText.meta}>Synthetic data only</span><Button type="submit" size="sm" icon={<ArrowUp aria-hidden className={dsIcon.md} />} disabled={!accountAvailable || waiting || !state.draft.trim()}>Send</Button></div>
          </form>
        </FloatingSurface>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  </Popover>;
}
