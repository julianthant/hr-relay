import { useMemo, useRef } from 'react';
import { useDashboardClient } from '../../state/client-context.js';
import { useSpreadsheetWiringAdapter } from '../../state/spreadsheet-wiring-adapter.js';
import { spreadsheetChatRegistrationPort, type SpreadsheetFileReference } from '../spreadsheets/spreadsheet-chat-registration-model.js';
import { spreadsheetSaveMatches } from '../spreadsheets/spreadsheet-editor-model.js';
import type { ComposerDraft } from './composer-model.js';
import { readAssistantAttachment, type AssistantConversation, type AssistantConversationPort, type AssistantFile, type AssistantPorts } from './assistant-panel-model.js';
import type { AssistantHistory } from '../assistant/assistant-history-model.js';

export function createHubAssistantSession(id: string, adapter: ReturnType<typeof useSpreadsheetWiringAdapter>['adapter'], onTitle?: (title: string) => void, initialTitle?: string, retainedDraft?: { read(): string; retain(text: string): void }) {
  let conversation: AssistantConversation = { id, title: initialTitle ?? 'New chat', files: [] };
  let renamedTitle: string | undefined;
  let draft: ComposerDraft = { text: retainedDraft?.read() ?? '', files: [] };
  const registry = spreadsheetChatRegistrationPort(adapter);
  const references = new Map<string, SpreadsheetFileReference>();
  return {
    draft: { read: () => draft, retain(next: ComposerDraft) { draft = next; retainedDraft?.retain(next.text); } },
    autoTitle(title: string) {
      if (conversation.title !== 'New chat') return;
      renamedTitle = title.trim(); conversation = { ...conversation, title: renamedTitle }; onTitle?.(conversation.title);
    },
    rename(title: string) { renamedTitle = title.trim(); conversation = { ...conversation, title: renamedTitle }; },
    conversationPort: {
      initial: () => conversation,
      retain(next: AssistantConversation) {
        if (renamedTitle !== undefined) next = { ...next, title: renamedTitle };
        const changed = conversation.title !== next.title; conversation = next;
        if (changed) onTitle?.(next.title);
      },
    } satisfies AssistantConversationPort,
    async attach(file: File): Promise<AssistantFile> {
      return readAssistantAttachment(file);
    },
    async register(file: AssistantFile): Promise<void> {
      if (!file.workbook) return;
      const confirmed = references.get(file.id);
      if (file.status === 'Attached' && confirmed) {
        const opened = await registry.open(confirmed);
        if (!spreadsheetSaveMatches(file.workbook, { state: 'confirmed', version: confirmed.version, readback: opened })) throw new Error('The attachment differs from its saved version.');
        return;
      }
      const result = await registry.register({ operationId: file.id, status: file.status, workbook: file.workbook });
      if (result.state !== 'confirmed') throw new Error(result.reason);
      references.set(file.id, result.file);
    }
  };
}

export function useHubAssistant(onTitle: (id: string, title: string) => void, history?: AssistantHistory) {
  const titleChanged = useRef(onTitle); titleChanged.current = onTitle;
  const client = useDashboardClient();
  const { adapter } = useSpreadsheetWiringAdapter(false, null);
  const sessions = useMemo(() => ({ adapter, history, values: new Map<string, ReturnType<typeof createHubAssistantSession>>() }), [adapter, history]);
  const session = (id: string, initialTitle?: string) => { let value = sessions.values.get(id); if (!value) { value = createHubAssistantSession(id, sessions.adapter, title => titleChanged.current(id, title), initialTitle, history?.draft(id)); sessions.values.set(id, value); } return value; };
  return { client, session, forgetSession: (id: string) => { sessions.values.delete(id); },
    ports(id: string): AssistantPorts {
      const current = session(id);
      return {
        onAttachFile: async file => file ? current.attach(file) : null,
        onRegisterSpreadsheet: file => current.register(file),
      };
    },
  };
}
