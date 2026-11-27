import { useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowUp, ChevronDown, Hand, Paperclip, Mic, Plus, ShieldAlert, X } from 'lucide-react';
import { Button, Skeleton, InputGroup, InputGroupTextarea, InputGroupAddon, InputGroupButton, DropdownMenu, DropdownMenuTrigger,
  DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator } from '../../ds/ui.js';
import { ASSISTANT_APPROVALS, ASSISTANT_MODEL, composerEnterAction, useComposer, type ComposerMenu, type ComposerValue, type ComposerDraftPort } from './composer-model.js';
import { readAssistantAttachment, type AssistantFile, type AssistantPorts } from './assistant-panel-model.js';
import { useAssistantModelChoice } from './assistant-approval-model.js';
import './composer-input.css';
import { usePersonPreferences } from '../../lib/person-preferences.js';
import { AssistantApprovalModeSchema, type AssistantModelPreferenceView } from '../../../models/dashboard/assistant.js';
import { ASSISTANT_EFFORT_LABELS, AssistantModelPreferenceSchema, assistantModelLabel, type AssistantModelPreference } from '../../../models/config/assistant-model-preference.js';

export function ComposerInput({ onSend, onAttachFile, disabled = false, initialText = '', autoFocus = false, draft, preview = true, onEdit, settlementKey, modelLoading = false, modelPreference }: AssistantPorts & {
  modelLoading?: boolean; modelPreference?: AssistantModelPreferenceView['preference']; settlementKey?: string; preview?: boolean; onEdit?: (value: string) => void; onSend: (value: ComposerValue) => Promise<boolean>; disabled?: boolean; initialText?: string; autoFocus?: boolean; draft?: ComposerDraftPort;
}) {
  const preferences = usePersonPreferences();
  const { sendShortcut, assistantFullAccess } = preferences.value;
  const fullAccessAllowed = assistantFullAccess && (preferences.state === 'ready' || preferences.state === 'saving');
  const composer = useComposer({ onSend, initialText, draft, settlementKey, fullAccessAllowed });
  const id = useId();
  const choice = useAssistantModelChoice();
  const [picked, setPicked] = useState<AssistantModelPreference>();
  useEffect(() => { setPicked(undefined); }, [modelPreference]);
  const shown = picked ?? modelPreference;
  const displayedModel = preview ? ASSISTANT_MODEL : shown === undefined ? 'Model unavailable' : assistantModelLabel(shown.slug);
  const displayedEffort = preview ? composer.effort : shown === undefined ? undefined : ASSISTANT_EFFORT_LABELS[shown.effort];
  const modelLabel = displayedEffort === undefined ? displayedModel : `${displayedModel} · ${displayedEffort}`;
  const focusMessageOnClose = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const sources = useRef(new Map<string, File>());
  async function attach(load: () => Promise<AssistantFile | null | void>, source?: File, replaces?: string) {
    setAttaching(true); setError(null);
    try {
      const file = await load();
      if (file) { if (source) sources.current.set(file.id, source); composer.setFiles(files => [...files.filter(existing => existing.id !== file.id && existing.id !== replaces), file]); }
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not attach the file. Try again.'); }
    finally { setAttaching(false); composer.textarea.current?.focus(); }
  }
  const approvals = fullAccessAllowed ? AssistantApprovalModeSchema.options : ['ask'] as const;
  const { approvalMode, setApprovalMode } = composer;
  const { label: approval } = ASSISTANT_APPROVALS[approvalMode];
  const full = approvalMode === 'full-access';
  function menu(kind: ComposerMenu, label: string, trigger: React.ReactNode, children: React.ReactNode, size: 'sm' | 'icon-sm' = 'icon-sm', className?: string) {
    return <DropdownMenu open={composer.menu === kind} onOpenChange={open => { if (open) focusMessageOnClose.current = false; composer.setMenu(open ? kind : null); }}>
      <DropdownMenuTrigger asChild><InputGroupButton id={`hub-${kind}-trigger`} size={size} className={className} aria-label={label} title={label} disabled={disabled || attaching || !preview && kind !== 'attach' && kind !== 'model' && !(kind === 'approval' && modelPreference !== undefined)}>{trigger}</InputGroupButton></DropdownMenuTrigger>
      <DropdownMenuContent ref={composer.popup} finalFocus={() => kind === 'voice' && focusMessageOnClose.current ? composer.textarea.current : true} side="top" align="start" sideOffset={8} collisionAvoidance={{ side: 'none', align: 'shift' }} collisionPadding={8} className="hub-assistant-menu hub-menu" data-menu={kind}>
        <DropdownMenuGroup>{children}</DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>;
  }
  function modelMenu() {
    if (preview || shown === undefined || choice === undefined) return <span id="hub-model-text" className="hub-model-text" title={modelLabel}>{modelLabel}</span>;
    const { choose } = choice, saving = picked !== undefined;
    /** Shows the pick at once; the save's own feedback toasts a refusal, and the served value returns. */
    const pick = (next: AssistantModelPreference) => { setPicked(next); void choose(next).finally(() => setPicked(undefined)); };
    return menu('model', `Model: ${displayedModel}, ${displayedEffort} effort`, <><span>{displayedModel}</span><span className="hub-effort">{displayedEffort}</span><ChevronDown aria-hidden /></>, <>
      <DropdownMenuLabel className="hub-menu-title">Select model</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={shown.slug} onValueChange={slug => { if (slug !== shown.slug) pick({ slug, effort: shown.effort }); }}>
        {choice.models.map(model => <DropdownMenuRadioItem closeOnClick disabled={saving} className="hub-menu-option" key={model.slug} value={model.slug}><span className="hub-option-copy">{assistantModelLabel(model.slug)}</span></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
      <DropdownMenuSeparator className="hub-menu-separator" />
      <DropdownMenuLabel className="hub-menu-title">Thinking effort</DropdownMenuLabel>
      <DropdownMenuRadioGroup value={shown.effort} onValueChange={value => { const effort = AssistantModelPreferenceSchema.shape.effort.parse(value); if (effort !== shown.effort) pick({ slug: shown.slug, effort }); }}>
        {Object.entries(ASSISTANT_EFFORT_LABELS).map(([value, label]) => <DropdownMenuRadioItem closeOnClick disabled={saving} className="hub-menu-option" key={value} value={value}><span className="hub-option-copy">{label}</span></DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </>, 'sm');
  }
  return <div className="hub-composer-wrap">
    <InputGroup aria-label="Message composer" onSubmit={event => { event.preventDefault(); void composer.send(); }}>
      {composer.files.map(file => <div key={file.id} className="hub-attachment" data-stage={file.stage?.state}><Paperclip aria-hidden /><span>{file.name}</span>
        {file.stage?.state === 'spreadsheet' && <small className="hub-caption">Added to Spreadsheets only. Not sent to the assistant.</small>}
        {file.stage?.state === 'failed' && <><small className="hub-attachment-failure" role="alert">{file.stage.message}</small>
          {sources.current.has(file.id) && onAttachFile && <Button variant="secondary" type="button" disabled={attaching} onClick={() => { const source = sources.current.get(file.id)!; void attach(() => onAttachFile(source), source, file.id); }}>Retry</Button>}</>}
        <button className="hub-icon" type="button" aria-label={`Remove attachment ${file.name}`} onClick={() => composer.setFiles(files => files.filter(existing => existing.id !== file.id))}><X aria-hidden /></button></div>)}
      <label className="hub-sr-only" htmlFor={id}>Message Relay</label>
      <InputGroupTextarea id={id} name="message" autoFocus={autoFocus} ref={composer.textarea} autoComplete="off" rows={1} placeholder="Ask Relay" value={composer.text} disabled={disabled}
        onChange={event => { composer.setText(event.target.value); onEdit?.(event.target.value); }} onKeyDown={event => {
          const action = composerEnterAction(sendShortcut, event.nativeEvent);
          if (action === 'native') return;
          event.preventDefault();
          if (action === 'send') { void composer.send(); return; }
          const field = event.currentTarget, start = field.selectionStart, next = `${field.value.slice(0, start)}\n${field.value.slice(field.selectionEnd)}`;
          flushSync(() => { composer.setText(next); onEdit?.(next); });
          field.setSelectionRange(start + 1, start + 1);
        }} />
      <InputGroupAddon aria-label="Message controls">
        {menu('attach', 'Add files', <Plus aria-hidden />, <>{preview && <DropdownMenuLabel className="hub-menu-title">Add to this chat</DropdownMenuLabel>}
          <DropdownMenuItem className="hub-menu-option" onSelect={() => composer.fileInput.current?.click()}><Plus aria-hidden /><span className="hub-option-copy"><span>Attach file</span><small>Images, spreadsheets and documents</small></span></DropdownMenuItem></>)}
        {menu('approval', approval, <>{full ? <ShieldAlert aria-hidden /> : <Hand aria-hidden />}<span>{approval}</span></>, <><DropdownMenuLabel className="hub-menu-title">How should Relay actions be approved?</DropdownMenuLabel><DropdownMenuRadioGroup value={approvalMode} onValueChange={value => setApprovalMode(AssistantApprovalModeSchema.parse(value))}>
          {approvals.map(mode => <DropdownMenuRadioItem closeOnClick className="hub-menu-option" key={mode} value={mode}><span className="hub-option-copy"><span>{ASSISTANT_APPROVALS[mode].label}</span><small>{ASSISTANT_APPROVALS[mode].description}</small></span></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></>, 'sm', full ? 'hub-full-access' : undefined)}
        {modelLoading ? <span className="hub-model-text"><Skeleton className="h-3.5 w-28" /></span> : modelMenu()}
        {preview && menu('voice', 'Voice input', <Mic aria-hidden />, <><DropdownMenuLabel className="hub-menu-title">Voice input</DropdownMenuLabel><p className="hub-caption hub-voice-note">Voice recording is simulated in this UI mock.</p><DropdownMenuItem className="hub-menu-option" onSelect={() => { focusMessageOnClose.current = true; composer.setText('Check the current employment details for Alex Rivera.'); }}><Mic aria-hidden /><span className="hub-option-copy"><span>Use sample transcript</span><small>Add a sample request to the composer</small></span></DropdownMenuItem></>)}
        <InputGroupButton type="submit" id="hub-send" aria-label="Send message" disabled={disabled || attaching} aria-disabled={!composer.text.trim() || undefined}><ArrowUp aria-hidden /></InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
    <input type="file" hidden ref={composer.fileInput} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) void attach(() => onAttachFile ? onAttachFile(file) : readAssistantAttachment(file), file);
    }} />
    {error ? <p className="hub-composer-error" role="alert">{error}</p> : null}
  </div>;
}
