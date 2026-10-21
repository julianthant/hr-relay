import { useEffect, useState } from 'react';
import type { EditableWorkbook } from '../spreadsheets/spreadsheet-editor-model.js';
import type { SpreadsheetChatRegistrationPort, SpreadsheetFileReference, SpreadsheetRegistrationRequest } from '../spreadsheets/spreadsheet-chat-registration-model.js';

export type ChatFile = Readonly<{ id: string; name: string }> & (
  | Readonly<{ kind: 'workbook'; reference: SpreadsheetFileReference }>
  | Readonly<{ kind: 'mock'; blob: Blob }>
);
export type ChatFilePreview = { kind: 'workbook'; document: EditableWorkbook } | { kind: 'mock'; blob: Blob };
export interface ChatFilesPort {
  subscribe(this: void, listener: () => void): () => void;
  snapshot(this: void): readonly ChatFile[];
  open(this: void, file: ChatFile): Promise<ChatFilePreview>;
  download(this: void, file: ChatFile): Promise<{ name: string; blob: Blob }>;
}

export function createChatFilesPort(workbooks: SpreadsheetChatRegistrationPort) {
  let files: readonly ChatFile[] = [];
  const listeners = new Set<() => void>();
  const add = (file: ChatFile) => {
    files = files.some(entry => entry.id === file.id) ? files.map(entry => entry.id === file.id ? file : entry) : [...files, file];
    listeners.forEach(listener => listener());
  };
  return {
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    snapshot: () => files,
    async registerSpreadsheet(request: SpreadsheetRegistrationRequest) {
      const result = await workbooks.register(request);
      if (result.state === 'confirmed') add({ id: `${result.file.libraryId}:${result.file.version}`, name: result.file.name, kind: 'workbook', reference: result.file });
      return result;
    },
    attachMockFile(file: File) {
      if (/\.(xlsx?|csv|tsv)$/iu.test(file.name)) throw new Error('CHAT_SPREADSHEET_REQUIRES_LIBRARY_REGISTRATION');
      const entry: ChatFile = { id: crypto.randomUUID(), name: file.name, kind: 'mock', blob: file };
      add(entry); return entry;
    },
    async open(file: ChatFile): Promise<ChatFilePreview> {
      return file.kind === 'workbook' ? { kind: 'workbook', document: await workbooks.open(file.reference) } : { kind: 'mock', blob: file.blob };
    },
    async download(file: ChatFile) { return file.kind === 'workbook' ? workbooks.download(file.reference) : { name: file.name, blob: file.blob }; },
  } satisfies ChatFilesPort & { registerSpreadsheet: unknown; attachMockFile: unknown };
}

export function useChatFilePreview(port: ChatFilesPort, selection: { file: ChatFile } | null) {
  const [settled, setSettled] = useState<{ selection: typeof selection; state: 'loaded'; preview: ChatFilePreview } | { selection: typeof selection; state: 'failed'; message: string }>();
  useEffect(() => {
    if (!selection) return;
    let active = true;
    void port.open(selection.file).then(preview => { if (active) setSettled({ selection, state: 'loaded', preview }); }, error => { if (active) setSettled({ selection, state: 'failed', message: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; };
  }, [port, selection]);
  return settled?.selection === selection ? settled : { state: 'loading' as const };
}

export function useChatFileObjectUrl(blob: Blob | undefined) {
  const [held, setHeld] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob); setHeld({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return held?.blob === blob ? held?.url : undefined;
}
