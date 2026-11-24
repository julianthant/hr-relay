/** What every assistant story mounts: the real panel on the real controller, a client that answers by script, and the ChatGPT account. */
import { useMemo, type ReactNode } from "react";
import { useAssistantController } from "../../../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js";
import { AssistantPanel } from "../../../../../../src/dashboard/surfaces/shell/assistant-panel.js";
import type { AssistantConversationPort } from "../../../../../../src/dashboard/surfaces/shell/assistant-panel-model.js";
import { ChatGptAccountContext, type ChatGptAccountSnapshot } from "../../../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js";
import type { AssistantModelPreferenceView } from "../../../../../../src/models/dashboard/assistant.js";
import { assistantAccountPort, assistantStoryClient, type AssistantStoryClientOptions } from "../../../../fixtures/dashboard/assistant-story-fixtures.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;
const CONVERSATION: AssistantConversationPort = { initial: () => ({ id: "story-chat", title: "New chat", files: [] }) };
export const CONNECTED: Extract<ChatGptAccountSnapshot, { state: "connected" }> = { state: "connected", name: "Jordan Lee", email: "jordan.lee@example.com", planUsage: "enabled" };

export interface AssistantHostProps {
  readonly client?: AssistantStoryClientOptions;
  readonly account?: ChatGptAccountSnapshot;
  readonly retryable?: boolean;
  readonly loading?: boolean;
  readonly historyNotice?: string;
  readonly modelPreference?: AssistantModelPreferenceView["preference"];
}

function Panel({ props }: { props: AssistantHostProps }) {
  const client = useMemo(() => assistantStoryClient(props.client), [props.client]);
  const served = useAssistantController(client, client, undefined, false, "story-chat");
  return <AssistantPanel served={served} conversationPort={CONVERSATION} loading={props.loading ?? false} {...(props.historyNotice === undefined ? {} : { historyNotice: props.historyNotice })}
    {...(props.modelPreference === undefined ? {} : { modelPreference: props.modelPreference })} title="New chat" onOpenSettings={noop} onClose={noop} />;
}

function Dock({ children }: { children: ReactNode }) {
  return <div className="ml-auto flex min-h-0 w-[26rem] max-w-full flex-1 flex-col border-l border-ui-stroke">{children}</div>;
}

export function AssistantHost({ props }: { props: AssistantHostProps }) {
  const port = useMemo(() => assistantAccountPort(props.account ?? CONNECTED, props.retryable), [props.account, props.retryable]);
  return <StoryFrame><ChatGptAccountContext.Provider value={port}><Dock><Panel props={props} /></Dock></ChatGptAccountContext.Provider></StoryFrame>;
}
