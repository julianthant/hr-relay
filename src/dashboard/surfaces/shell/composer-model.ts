import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AssistantFile } from './assistant-panel-model.js';
import type { PersonPreferences } from '../../../models/config/person-preferences.js';
import type { AssistantApprovalMode } from '../../../models/dashboard/assistant.js';

export const ASSISTANT_MODEL = 'GPT-6.1 Sol';
export const ASSISTANT_APPROVALS = {
  ask: { label: 'Ask before every action', description: 'Confirm each proposed change.' },
  'full-access': { label: 'Full access', description: 'Start supported dry runs without asking.' },
} satisfies Record<AssistantApprovalMode, { label: string; description: string }>;
export type ComposerMenu = 'attach' | 'approval' | 'model' | 'voice';
export interface ComposerValue { readonly text: string; readonly files: readonly AssistantFile[]; readonly model: string; readonly effort: string; readonly approvalMode: AssistantApprovalMode }
export interface ComposerDraft { readonly text: string; readonly files: readonly AssistantFile[] }
export interface ComposerDraftPort { read(): ComposerDraft; retain(draft: ComposerDraft): void }

/**
 * What an Enter press does under the person's send shortcut: send, add a new line the textarea would not add itself
 * (Command- or Ctrl-Enter), or leave the textarea its own new line. Shift-Enter and IME composition never send.
 */
export function composerEnterAction(shortcut: PersonPreferences['sendShortcut'], key: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'isComposing'>): 'send' | 'new-line' | 'native' {
  if (key.key !== 'Enter' || key.shiftKey || key.isComposing) return 'native';
  const modified = key.metaKey || key.ctrlKey;
  if (shortcut === 'enter') return modified ? 'new-line' : 'send';
  return modified ? 'send' : 'native';
}
export function useComposer({ onSend, draft, initialText = '', settlementKey, fullAccessAllowed = false }: { settlementKey?: string; onSend: (value: ComposerValue) => Promise<boolean>; initialText?: string; draft?: ComposerDraftPort; fullAccessAllowed?: boolean }) {
  const [text, setText] = useState(() => draft?.read().text ?? initialText);
  const [files, setFiles] = useState<readonly AssistantFile[]>(() => draft?.read().files ?? []);
  useLayoutEffect(() => { draft?.retain({ text, files }); }, [draft, text, files]);
  const effort = 'Medium';
  const [pickedApproval, setApprovalMode] = useState<AssistantApprovalMode>('ask');
  const approvalMode = fullAccessAllowed ? pickedApproval : 'ask';
  useEffect(() => { if (!fullAccessAllowed) setApprovalMode('ask'); }, [fullAccessAllowed]);
  const [menu, setMenu] = useState<ComposerMenu | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!menu) return;
    function alignPopup() {
      const element = popup.current, anchor = document.getElementById(`hub-${menu}-trigger`);
      if (!element || !anchor) return;
      const left = Math.max(8, Math.min(innerWidth - element.offsetWidth - 8, anchor.getBoundingClientRect().left));
      // Base UI rounds its positioner to device pixels; retain the mock's fractional anchor.
      if (element.parentElement) element.parentElement.style.left = `${left - Math.round(left * devicePixelRatio) / devicePixelRatio}px`;
    }
    const frame = requestAnimationFrame(alignPopup);
    window.addEventListener('resize', alignPopup);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', alignPopup); };
  }, [menu]);
  const sending = useRef(false);
  const draftVersion = useRef(0);
  const submitted = useRef<{ version: number; text: string; files: readonly AssistantFile[] } | undefined>(undefined);
  const settled = useRef(settlementKey);
  useLayoutEffect(() => { draftVersion.current++; }, [text, files]);
  useLayoutEffect(() => {
    if (settled.current === settlementKey) return;
    settled.current = settlementKey;
    const sent = submitted.current; submitted.current = undefined;
    if (sent && sent.version === draftVersion.current && sent.text === text && sent.files === files) {
      setText(''); setFiles([]); setMenu(null);
    }
  }, [settlementKey, text, files]);
  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(120, Math.max(54, field.scrollHeight))}px`;
  }, [text]);
  async function send() {
    if (!text.trim() || sending.current) return;
    sending.current = true;
    submitted.current = { version: draftVersion.current, text, files };
    try {
      if (await onSend({ text, files, model: ASSISTANT_MODEL, effort, approvalMode })) { setText(''); setFiles([]); setMenu(null); }
    } finally { sending.current = false; }
  }
  return { text, setText, files, setFiles, effort, approvalMode, setApprovalMode, menu, setMenu, textarea, fileInput, popup, send };
}
