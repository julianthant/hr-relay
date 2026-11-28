import { assistantSetupCommand } from '../assistant/assistant-model.js';
import type { useAssistantController } from "../assistant/assistant-controller-model.js";
import { useEffect, useRef, useState } from 'react';
import { importSpreadsheetInWorker } from '../spreadsheets/spreadsheet-import-client.js';
import type { EditableWorkbook } from '../../../rules/spreadsheets/workbook-io.js';
import type { ComposerValue } from './composer-model.js';
import { ASSISTANT_ATTACHMENT_TYPES, ASSISTANT_ATTACHMENTS_PER_SEND, ASSISTANT_FAILURES, type AssistantAttachmentMediaType } from '../../../models/dashboard/assistant.js';

/** Where a served attachment stands: staged for the model, failed with its reason, or kept on the spreadsheet path and never sent. */
export type AssistantFileStage = { readonly state: 'staged' } | { readonly state: 'failed'; readonly message: string } | { readonly state: 'spreadsheet' };
export interface AssistantFile { readonly id: string; readonly name: string; readonly status: 'Attached' | 'Updated' | 'Generated'; readonly workbook?: EditableWorkbook; readonly stage?: AssistantFileStage }
const SPREADSHEET_NAME = /\.(xlsx?|csv|tsv)$/i;
function attachmentType(name: string): { mediaType: AssistantAttachmentMediaType; maxBytes: number } | undefined {
  const extension = /\.([^.]+)$/u.exec(name)?.[1]?.toLowerCase();
  for (const [mediaType, type] of Object.entries(ASSISTANT_ATTACHMENT_TYPES) as [AssistantAttachmentMediaType, typeof ASSISTANT_ATTACHMENT_TYPES[AssistantAttachmentMediaType]][])
    if (extension !== undefined && (type.extensions as readonly string[]).includes(extension)) return { mediaType, maxBytes: type.maxBytes };
  return undefined;
}
/** What the panel keeps of one chat besides its served messages. */
export interface AssistantConversation { readonly id: string; readonly title: string; readonly files: readonly AssistantFile[] }
export interface AssistantConversationPort {
  initial(): AssistantConversation;
  retain?(conversation: AssistantConversation): void;
}
export interface AssistantPorts {
  readonly onAttachFile?: (file?: File) => Promise<AssistantFile | null>;
  readonly onRegisterSpreadsheet?: (file: AssistantFile) => Promise<void>;
}
export async function readAssistantAttachment(file: File): Promise<AssistantFile> {
  const workbook = /\.(xlsx?|csv|tsv)$/i.test(file.name) ? await importSpreadsheetInWorker(file.name, await file.arrayBuffer()) : undefined;
  return { id: crypto.randomUUID(), name: file.name, status: 'Attached', ...(workbook ? { workbook } : {}) };
}
export function useAssistantPanel({ conversationPort, ports, served }: { served: ReturnType<typeof useAssistantController>; conversationPort: AssistantConversationPort; ports: AssistantPorts }) {
  const [conversation, setConversation] = useState(() => conversationPort.initial());
  useEffect(() => { conversationPort.retain?.(conversation); }, [conversationPort, conversation]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const transcript = useRef<HTMLDivElement>(null);
  const [showLatest, setShowLatest] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const currentAuthority = useRef(served.authorityKey); currentAuthority.current = served.authorityKey;
  useEffect(() => () => { generation.current += 1; }, []);
  async function perform(work: () => Promise<AssistantConversation>): Promise<boolean> {
    if (pending.current) return false;
    pending.current = true; setBusy(true); setError(null);
    const identity = generation.current;
    let committed = false;
    try { const next = await work(); if (identity !== generation.current) return false; setConversation(next); committed = true; }
    catch (cause) { if (identity === generation.current) setError(cause instanceof Error ? cause.message : 'The assistant action failed. Try again.'); }
    finally { pending.current = false; if (identity === generation.current) setBusy(false); }
    return committed;
  }
  function refuseAttachments(value: Pick<ComposerValue, 'text' | 'files'>) {
    if (assistantSetupCommand(value.text) !== undefined && value.files.length > 0) {
      setError('Assistant setup commands accept text only. Remove attachments before sending.'); return true;
    }
    if (value.files.some(file => file.stage?.state === 'failed')) { setError('An attachment did not upload. Retry or remove it before sending.'); return true; }
    if (value.files.filter(file => file.stage?.state === 'staged').length > ASSISTANT_ATTACHMENTS_PER_SEND) {
      setError(`Attach at most ${ASSISTANT_ATTACHMENTS_PER_SEND} files to one message.`); return true;
    }
    return false;
  }
  function refuseAttachmentInput() {
    if (assistantSetupCommand(served.state.draft) !== undefined) {
      setError('Assistant setup commands accept text only. Remove attachments before sending.'); return true;
    }
    return false;
  }
  async function attachFile(file?: File): Promise<AssistantFile | null> {
    if (refuseAttachmentInput()) return null;
    if (file !== undefined && !SPREADSHEET_NAME.test(file.name)) {
      const type = attachmentType(file.name);
      if (type === undefined) throw new Error(ASSISTANT_FAILURES.ASSISTANT_ATTACHMENT_UNSUPPORTED);
      if (file.size > type.maxBytes) throw new Error(ASSISTANT_FAILURES.ASSISTANT_ATTACHMENT_TOO_LARGE);
    }
    const attached = await ports.onAttachFile?.(file) ?? null;
    if (attached === null || file === undefined) return attached;
    if (SPREADSHEET_NAME.test(file.name)) return { ...attached, stage: { state: 'spreadsheet' } };
    try {
      const result = await served.stageAttachment({ name: file.name, mediaType: attachmentType(file.name)!.mediaType, bytes: new Uint8Array(await file.arrayBuffer()) });
      return result.state === 'staged' ? { ...attached, id: result.attachment.id, stage: { state: 'staged' } }
        : { ...attached, stage: { state: 'failed', message: ASSISTANT_FAILURES[result.code] } };
    } catch { return { ...attached, stage: { state: 'failed', message: 'Could not attach the file. Try again.' } }; }
  }
  async function send(value: ComposerValue) {
    if (refuseAttachments(value)) return false;
    const identity = generation.current, authority = currentAuthority.current;
    let dispatched = false;
    await perform(async () => {
      const attachments = value.files.map(file => ({ id: file.id, name: file.name }));
      for (const file of value.files) if (file.workbook) await ports.onRegisterSpreadsheet?.(file);
      if (identity === generation.current && authority === currentAuthority.current) {
        served.onAction({ type: 'edit', value: value.text });
        served.onAction({ type: 'send', approvalMode: value.approvalMode, attachments, staged: value.files.filter(file => file.stage?.state === 'staged').map(file => file.id) }); dispatched = true;
      }
      return { ...conversation, files: [...conversation.files, ...value.files] };
    });
    return dispatched;
  }
  function latest() { const element = transcript.current; if (element) element.scrollTop = element.scrollHeight; setShowLatest(false); }
  return { conversation, error, busy, refuseAttachments, attachFile, transcript, showLatest, latest, send,
    onScroll: () => { const el = transcript.current; if (el) setShowLatest(el.scrollHeight - el.clientHeight - el.scrollTop >= 48); },
    newChat: () => { generation.current += 1; setConversation({ id: crypto.randomUUID(), title: 'New chat', files: [] }); },
  };
}
