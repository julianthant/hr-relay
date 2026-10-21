import { useLayoutEffect, useRef, useState } from 'react';
import type { AssistantFile } from './assistant-panel-model.js';

export const ASSISTANT_MODELS = ['Default', 'GPT-6.1 Sol', 'GPT-6 Astra', 'GPT-6 Sol', 'GPT-6 Luna', 'GPT-5.6 Sol', 'GPT-5.6 Terra', 'GPT-5.6 Luna'] as const;
export const ASSISTANT_EFFORTS = ['Light', 'Low', 'Medium', 'High', 'xHigh'] as const;
export const ASSISTANT_APPROVALS = [
  { label: 'Ask before every action', description: 'Review every read and change.' },
  { label: 'Ask only before submits', description: 'Review changes sent to other systems.' },
  { label: 'Act without asking', description: 'Let Relay act within your permissions.' },
] as const;
export type ComposerMenu = 'attach' | 'approval' | 'model' | 'effort' | 'voice';
export interface ComposerValue { readonly text: string; readonly files: readonly AssistantFile[]; readonly model: string; readonly effort: string; readonly approval: string }
export interface ComposerDraft { readonly text: string; readonly files: readonly AssistantFile[] }
export interface ComposerDraftPort { read(): ComposerDraft; retain(draft: ComposerDraft): void }
export function useComposer({ onSend, draft, initialText = '', settlementKey }: { settlementKey?: string; onSend: (value: ComposerValue) => Promise<boolean>; initialText?: string; draft?: ComposerDraftPort }) {
  const [text, setText] = useState(() => draft?.read().text ?? initialText);
  const [files, setFiles] = useState<readonly AssistantFile[]>(() => draft?.read().files ?? []);
  useLayoutEffect(() => { draft?.retain({ text, files }); }, [draft, text, files]);
  const [model, setModel] = useState<string>(ASSISTANT_MODELS[1]);
  const [effort, setEffort] = useState<string>('Medium');
  const [approval, setApproval] = useState<string>(ASSISTANT_APPROVALS[1].label);
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
    field.style.height = `${Math.min(120, Math.max(50, field.scrollHeight))}px`;
  }, [text]);
  async function send() {
    if (!text.trim() || sending.current) return;
    sending.current = true;
    submitted.current = { version: draftVersion.current, text, files };
    try {
      if (await onSend({ text, files, model, effort, approval })) { setText(''); setFiles([]); setMenu(null); }
    } finally { sending.current = false; }
  }
  return { text, setText, files, setFiles, model, setModel, effort, setEffort, approval, setApproval, menu, setMenu, textarea, fileInput, popup, send };
}
