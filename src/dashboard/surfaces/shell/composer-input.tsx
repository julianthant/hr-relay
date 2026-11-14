import { useId, useRef, useState } from 'react';
import { ArrowUp, ChevronDown, Hand, Paperclip, Mic, Plus, X } from 'lucide-react';
import { InputGroup, InputGroupTextarea, InputGroupAddon, InputGroupButton, DropdownMenu, DropdownMenuTrigger,
  DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator } from '../../ds/ui.js';
import { ASSISTANT_APPROVALS, ASSISTANT_EFFORTS, ASSISTANT_MODEL, useComposer, type ComposerMenu, type ComposerValue, type ComposerDraftPort } from './composer-model.js';
import { readAssistantAttachment, type AssistantFile, type AssistantPorts } from './assistant-panel-model.js';
import './composer-input.css';
import { usePersonPreferences } from '../../lib/person-preferences.js';
import { isMacPlatform, sendsMessage } from '../../state/person-preferences-model.js';
import type { AssistantModelCatalog, AssistantModelPreferenceView } from '../../../models/dashboard/assistant.js';
import { ASSISTANT_EFFORT_LABELS, AssistantModelPreferenceSchema, assistantModelLabel, type AssistantModelPreference } from '../../../models/config/assistant-model-preference.js';

export function ComposerInput({ onSend, onAttachFile, disabled = false, initialText = '', autoFocus = false, draft, preview = true, onEdit, settlementKey, modelPreference, models, onModelChoice }: AssistantPorts & {
  modelPreference?: AssistantModelPreferenceView['preference']; models?: AssistantModelCatalog['models']; onModelChoice?: (preference: AssistantModelPreference) => void; settlementKey?: string; preview?: boolean; onEdit?: (value: string) => void; onSend: (value: ComposerValue) => Promise<boolean>; disabled?: boolean; initialText?: string; autoFocus?: boolean; draft?: ComposerDraftPort;
}) {
  const composer = useComposer({ onSend, initialText, draft, settlementKey });
  const { sendShortcut } = usePersonPreferences().value;
  const id = useId();
  const displayedModel = preview ? ASSISTANT_MODEL : modelPreference === undefined ? 'Model unavailable' : assistantModelLabel(modelPreference.slug);
  const displayedEffort = preview ? composer.effort : modelPreference === undefined ? undefined : ASSISTANT_EFFORT_LABELS[modelPreference.effort];
  // Without a served model there is no effort to show; only "Model unavailable" fits the panel toolbar.
  const focusMessageOnClose = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  async function attach(load: () => Promise<AssistantFile | null | void>) {
    setAttaching(true); setError(null);
    try { const file = await load(); if (file) composer.setFiles(files => [...files.filter(existing => existing.id !== file.id), file]); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not attach the file. Try again.'); }
    finally { setAttaching(false); composer.textarea.current?.focus(); }
  }
  const { approval, setApproval } = composer;
  const servedChoice = !preview && modelPreference !== undefined && onModelChoice !== undefined;
  function menu(kind: ComposerMenu, label: string, trigger: React.ReactNode, children: React.ReactNode, size: 'sm' | 'icon-sm' = 'icon-sm', className?: string) {
    return <DropdownMenu open={composer.menu === kind} onOpenChange={open => { if (open) focusMessageOnClose.current = false; composer.setMenu(open ? kind : null); }}>
      <DropdownMenuTrigger asChild><InputGroupButton id={`hub-${kind}-trigger`} size={size} className={className} aria-label={label} title={label} disabled={disabled || attaching || !preview && kind === 'voice' || !preview && kind === 'model' && !servedChoice}>{trigger}</InputGroupButton></DropdownMenuTrigger>
      <DropdownMenuContent ref={composer.popup} finalFocus={() => kind === 'voice' && focusMessageOnClose.current ? composer.textarea.current : true} side="top" align="start" sideOffset={8} collisionAvoidance={{ side: 'none', align: 'shift' }} collisionPadding={8} className="hub-assistant-menu hub-menu" data-menu={kind}>
        <DropdownMenuGroup>{children}</DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>;
  }
  return <div className="hub-composer-wrap">
    <InputGroup aria-label="Message composer" onSubmit={event => { event.preventDefault(); void composer.send(); }}>
      {composer.files.map(file => <div key={file.id} className="hub-attachment"><Paperclip aria-hidden /><span>{file.name}</span><button className="hub-icon" type="button" aria-label={`Remove attachment ${file.name}`} onClick={() => composer.setFiles(files => files.filter(existing => existing.id !== file.id))}><X aria-hidden /></button></div>)}
      <label className="hub-sr-only" htmlFor={id}>Message Relay</label>
      <InputGroupTextarea id={id} name="message" autoFocus={autoFocus} ref={composer.textarea} autoComplete="off" rows={1} placeholder="Ask Relay…" value={composer.text} disabled={disabled}
        onChange={event => { composer.setText(event.target.value); onEdit?.(event.target.value); }} onKeyDown={event => {
          if (sendsMessage(sendShortcut, event.nativeEvent, isMacPlatform())) { event.preventDefault(); void composer.send(); }
        }} />
      <InputGroupAddon aria-label="Message controls">
        {menu('attach', 'Add files', <Plus aria-hidden />, <><DropdownMenuLabel className="hub-menu-title">Add to this chat</DropdownMenuLabel>
          <DropdownMenuItem className="hub-menu-option" onSelect={() => composer.fileInput.current?.click()}><Plus aria-hidden /><span className="hub-option-copy"><span>Attach file</span><small>Images, spreadsheets and documents</small></span></DropdownMenuItem></>)}
        {menu('approval', approval, <Hand aria-hidden />, <><DropdownMenuLabel className="hub-menu-title">How should Relay actions be approved?</DropdownMenuLabel><DropdownMenuRadioGroup value={approval} onValueChange={setApproval}>
          {ASSISTANT_APPROVALS.map(item => <DropdownMenuRadioItem closeOnClick className="hub-menu-option" key={item.label} value={item.label}><span className="hub-option-copy"><span>{item.label}</span><small>{item.description}</small></span></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></>)}
        {menu('model', `Model: ${displayedModel}${displayedEffort === undefined ? '' : `, ${displayedEffort} effort`}`, <><span>{displayedModel}</span>{displayedEffort !== undefined && <span className="hub-effort">{displayedEffort}</span>}<ChevronDown aria-hidden /></>, servedChoice ? <>
          {models !== undefined && <><DropdownMenuLabel className="hub-menu-title">Select model</DropdownMenuLabel><DropdownMenuRadioGroup value={modelPreference.slug} onValueChange={slug => { if (slug !== modelPreference.slug) onModelChoice({ slug, effort: modelPreference.effort }); }}>
            {models.map(model => <DropdownMenuRadioItem closeOnClick className="hub-menu-option" key={model.slug} value={model.slug}><span className="hub-option-copy">{assistantModelLabel(model.slug)}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup><DropdownMenuSeparator className="hub-menu-separator" /></>}
          <DropdownMenuLabel className="hub-menu-title">Thinking effort</DropdownMenuLabel><DropdownMenuRadioGroup value={modelPreference.effort} onValueChange={effort => { const parsed = AssistantModelPreferenceSchema.shape.effort.safeParse(effort); if (parsed.success && parsed.data !== modelPreference.effort) onModelChoice({ slug: modelPreference.slug, effort: parsed.data }); }}>
            {Object.entries(ASSISTANT_EFFORT_LABELS).map(([value, label]) => <DropdownMenuRadioItem closeOnClick className="hub-menu-option" key={value} value={value}><span className="hub-option-copy">{label}</span></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup></> : <><DropdownMenuLabel className="hub-menu-title">Thinking effort</DropdownMenuLabel><DropdownMenuRadioGroup value={composer.effort} onValueChange={composer.setEffort}>
          {ASSISTANT_EFFORTS.map(value => <DropdownMenuRadioItem closeOnClick className="hub-menu-option" key={value} value={value}><span className="hub-option-copy">{value}</span></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></>, 'sm')}
        {menu('voice', 'Voice input', <Mic aria-hidden />, <><DropdownMenuLabel className="hub-menu-title">Voice input</DropdownMenuLabel><p className="hub-caption hub-voice-note">Voice recording is simulated in this UI mock.</p><DropdownMenuItem className="hub-menu-option" onSelect={() => { focusMessageOnClose.current = true; composer.setText('Check the current employment details for Alex Rivera.'); }}><Mic aria-hidden /><span className="hub-option-copy"><span>Use sample transcript</span><small>Add a sample request to the composer</small></span></DropdownMenuItem></>)}
        <InputGroupButton type="submit" id="hub-send" aria-label="Send message" disabled={disabled || attaching} aria-disabled={!composer.text.trim() || undefined}><ArrowUp aria-hidden /></InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
    <input type="file" hidden ref={composer.fileInput} onChange={event => {
      const file = event.target.files?.[0]; event.target.value = '';
      if (file) void attach(() => onAttachFile ? onAttachFile(file) : readAssistantAttachment(file));
    }} />
    {error ? <p className="hub-composer-error" role="alert">{error}</p> : null}
  </div>;
}
