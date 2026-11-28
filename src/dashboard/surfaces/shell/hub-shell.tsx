import type { DashboardCommandBinding } from '../../app/dashboard-app-model.js';
import { useAssistantController } from "../assistant/assistant-controller-model.js";
import { Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { History, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, EmptyState, Input, SearchInput, SegmentedChoice, useToasts } from "../../ds/ui.js";
import { AssistantServedActivity } from "./assistant-thread.js";
import { publishAssistantModelChoice } from "./assistant-approval-model.js";
import { assistantOpen, focusAssistantLauncher, useAssistantOpen } from "./assistant-launcher-model.js";
import { chatAge, chatListView, createLocalHubChatsPort, useHubChats, useHubPanelPosition, useLogsTop, type HubChatsPort } from "./hub-shell-model.js";
import { useHubAssistant } from "./hub-assistant-model.js";
import "./hub-shell.css";
import { useDashboardClient } from '../../state/client-context.js';
import { FirstScreenRevealedContext, STARTUP_READ_DEADLINE_MS } from '../../app/startup/first-screen.js';
import { CodeLoading, preloadable } from '../../lib/preloadable.js';
import { mockParam } from '../../app/mock-surfaces.js';
import { PanelBoundary } from '../shared/panel-boundary.js';
import { useAssistantHistory, type AssistantHistory } from '../assistant/assistant-history-model.js';
import type { AssistantModelPreferenceView } from '../../../models/dashboard/assistant.js';

const EMPTY_CHAT = { id: 'empty-chat', title: 'New chat', minutes: 0, group: 'Today' } as const;
const HISTORY_TABS = [{ value: "chats", label: "Chats" }, { value: "activity", label: "Activity" }] as const;
type HubShellProps = { authority?: unknown; subjectRef?: string; onOpenSettings?: (section?: string, target?: string) => void; settingsOpen: boolean; onLogout: () => void; logoutOpen: boolean; onLogoutOpenChange: (open: boolean) => void; chatsPort?: HubChatsPort; commands?: DashboardCommandBinding };
export function HubShell(props: HubShellProps) {
  const client = useDashboardClient();
  useState(() => { assistantOpen.init(false); });
  const revealed = useContext(FirstScreenRevealedContext);
  useLayoutEffect(() => { if (!revealed && mockParam("assistantOpen") !== "1") assistantOpen.set(false); }, [revealed]);
  useEffect(() => { assistantPanel.preload().catch((error: unknown) => { window.reportError(error); }); }, []);
  const opened = useAssistantOpen();
  const canRead = opened && (revealed || mockParam("assistantOpen") === "1");
  const [everOpened, setEverOpened] = useState(canRead);
  if (canRead && !everOpened) setEverOpened(true);
  // History loads with the dashboard because its notices show on the closed panel; only the model catalog waits for the first open.
  const history = useAssistantHistory(client, true, props.authority);
  return <HubShellBody key={history.store?.profileId ?? (history.pending ? 'loading' : 'session')} {...props} history={history.store}
    preferenceChanged={history.preferenceChanged} assistantOpened={everOpened} modelPreference={history.preference} historyPending={history.pending || history.blocked || history.store === undefined} historyLoading={history.pending} historyNotice={history.notice} />;
}
// The panel's code loads with the dashboard, under the startup loader; a failed load reaches PanelBoundary.
const assistantPanel = preloadable(() => import("./assistant-panel.js").then(module => module.AssistantPanel));
const AssistantPanel = assistantPanel.Component;
function HubShellBody({ onOpenSettings, settingsOpen, onLogout, logoutOpen, onLogoutOpenChange, chatsPort, authority, commands, subjectRef, history, historyPending, historyLoading, historyNotice, modelPreference, preferenceChanged, assistantOpened }: HubShellProps & { assistantOpened: boolean; history?: AssistantHistory; historyPending: boolean; historyLoading: boolean; historyNotice: string; modelPreference?: AssistantModelPreferenceView['preference']; preferenceChanged?: (view: AssistantModelPreferenceView) => void }) {
  const client = useDashboardClient();
  const panelPosition = useHubPanelPosition(4);
  const revealed = useContext(FirstScreenRevealedContext);
  const opened = useAssistantOpen();
  useLogsTop(opened && !settingsOpen);
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (!revealed || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "j" || event.altKey || event.shiftKey || settingsOpen) return;
      event.preventDefault(); panelPosition.reset(); assistantOpen.toggle();
    };
    document.addEventListener("keydown", toggle);
    return () => document.removeEventListener("keydown", toggle);
  }, [settingsOpen, panelPosition, revealed]);
  const [list, setList] = useState(false);
  // Opening History hides the pressed button; the heading takes the focus, so the next Tab reaches the list header.
  const listHeading = useRef<HTMLDivElement>(null);
  const leavingToTrigger = useRef(false);
  useLayoutEffect(() => {
    if (list) listHeading.current?.focus();
    else if (leavingToTrigger.current) document.querySelector<HTMLElement>('#hub-shell-assistant .hub-panel-header [aria-label="History"]')?.focus();
    leavingToTrigger.current = false;
  }, [list]);
  const [tab, setTab] = useState<"chats" | "activity">("chats");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ kind: "rename" | "delete"; id: string }>();
  const [title, setTitle] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [saving, setSaving] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const localChats = useMemo(() => history?.chats ?? createLocalHubChatsPort(), [history]);
  const model = useHubChats(chatsPort ?? localChats);
  const chatList = chatListView(model.chats, query);
  const assistant = useHubAssistant((id, title) => { if (model.chats.some(chat => chat.id === id)) void model.rename(id, title); }, history);
  const { toast } = useToasts();
  const servedController = useAssistantController(assistant.client, authority, subjectRef, false, model.currentId, commands, { history, preferenceChanged, readModels: assistantOpened, toast });
  const { models: catalog, chooseModel } = servedController;
  const choose = useRef(chooseModel);
  choose.current = chooseModel;
  useEffect(() => {
    publishAssistantModelChoice(modelPreference === undefined || catalog === undefined ? undefined : { preference: modelPreference, models: catalog, choose: preference => choose.current(preference) });
    return () => publishAssistantModelChoice(undefined);
  }, [modelPreference, catalog]);
  const served = historyPending ? { ...servedController, canCompose: false } : servedController;
  // With no stored chat the panel still opens, on an empty chat ready to compose.
  const current = model.chats.find(chat => chat.id === model.currentId) ?? (model.chats.length === 0 ? EMPTY_CHAT : undefined);
  const currentSession = current ? assistant.session(current.id, current.title) : undefined;
  const edit = (kind: "rename" | "delete", id: string) => {
    const chat = model.chats.find(chat => chat.id === id);
    if (!chat) throw new Error("HUB_CHAT_UNAVAILABLE");
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTitle(chat.title); setEditing({ kind, id });
  };
  const closePanel = () => { setList(false); assistantOpen.set(false); panelPosition.reset(); focusAssistantLauncher(); };
  const icon = (label: string, glyph: ReactNode, onClick: () => void) => <button tabIndex={0} className="hub-icon" type="button" aria-label={label} title={label} onClick={onClick}>{glyph}</button>;
  return <>
      <section ref={panelPosition.element} id="hub-shell-assistant" className="hub-slot" aria-label={list ? "Relay assistant" : "Assistant panel"} data-source={model.source} hidden={settingsOpen || !opened} inert={settingsOpen || !opened} aria-hidden={settingsOpen || !opened} onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented && !editing) { event.preventDefault(); if (list) { leavingToTrigger.current = true; setList(false); } else { assistantOpen.set(false); panelPosition.reset(); focusAssistantLauncher(); } }
      }}>
        {list && <header className="hub-slot-header"><div className="hub-slot-title" ref={listHeading} tabIndex={-1}><span>History</span></div><div className="hub-header-actions">
          {icon("History", <History aria-hidden />, () => { leavingToTrigger.current = list; setList(value => !value); })}{icon("New chat", <Plus aria-hidden />, () => { void model.create(); setList(false); })}{icon("Close assistant", <X aria-hidden />, closePanel)}
        </div></header>}
        {list ? <div className="hub-history"><div className="hub-history-bar"><SearchInput aria-label={tab === "chats" ? "Search chats" : "Search activity"} placeholder={tab === "chats" ? "Search chats" : "Search activity"} value={query} onChange={event => setQuery(event.target.value)} />
          <SegmentedChoice hideLabel label="History" value={tab} options={HISTORY_TABS} onChange={setTab} /></div>
          {tab === "chats" ? <div className="hub-transcript hub-chat-list" onKeyDown={event => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || event.target instanceof HTMLInputElement) return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }}>
          {model.error && <p role="alert" className="hub-caption">{model.error}</p>}
          {chatList === "empty" ? <div className="hub-empty"><strong>No chats yet</strong>Start a new chat to ask Relay for help.</div> : chatList === "no-match" ? <div className="hub-empty">No matching chats.</div> : (["Today", "Yesterday", "Earlier"] as const).map(group => {
            const rows = model.chats.filter(chat => chat.group === group && chat.title.toLowerCase().includes(query.toLowerCase()));
            return rows.length > 0 && <section className="hub-chat-group" key={group}><h3>{group}</h3>{rows.map(chat => <div className="hub-chat-row" key={chat.id} data-current={chat.id === model.currentId} onKeyDown={event => {
              if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); edit("delete", chat.id); }
            }}><button tabIndex={0} className="hub-chat-open" type="button" aria-current={chat.id === model.currentId ? "true" : undefined} onClick={() => { void model.select(chat.id); setList(false); }}><strong>{chat.title}</strong><small>{chatAge(chat.minutes)}{chat.id === model.currentId && " · Current"}</small></button>{icon(`Rename chat ${chat.title}`, <Pencil aria-hidden />, () => edit("rename", chat.id))}{icon(`Delete chat ${chat.title}`, <Trash2 aria-hidden />, () => edit("delete", chat.id))}</div>)}</section>;
          })}
        </div> : <div className="hub-transcript">{client.assistantActivity ? <AssistantServedActivity query={query} read={signal => client.assistantActivity!(signal)} /> : <EmptyState title="No activity today" />}</div>}
        </div> : null}
        <div className="hub-assistant-slot" data-hub-assistant-slot="" hidden={list} inert={list}>
          {current && currentSession && <PanelBoundary resetKey={current.id} sentence="Couldn't open the assistant."><Suspense fallback={<CodeLoading deadlineMs={STARTUP_READ_DEADLINE_MS} />}><AssistantPanel key={current.id} loading={historyLoading} historyNotice={historyNotice || model.error} modelPreference={modelPreference} served={served} onAutomaticTitle={title => currentSession.autoTitle(title)} conversationPort={currentSession.conversationPort} draft={currentSession.draft} {...assistant.ports(current.id)} title={current.title} onOpenSettings={onOpenSettings}
            onClose={closePanel} onChats={() => { setList(true); }} onNewChat={() => { void model.create(); setList(false); }} onRename={historyPending ? undefined : () => edit("rename", current.id)} ></AssistantPanel></Suspense></PanelBoundary>}
        </div>
      </section>
    <span role="status" className="sr-only">{announcement}</span>
    <Dialog open={logoutOpen} onOpenChange={onLogoutOpenChange}><DialogContent size="sm" title="Log out?" description="End your current Relay session?" onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>(".hub-logout")?.focus(); }}><DialogFooter><Button variant="secondary" onClick={() => onLogoutOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={() => { onLogoutOpenChange(false); onLogout(); }}>Log out</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={editing !== undefined} onOpenChange={open => { if (!open) setEditing(undefined); }}><DialogContent size="sm" title={editing?.kind === "rename" ? "Rename chat" : "Delete chat?"} description={editing?.kind === "rename" ? "Keep it short and recognizable" : `Delete “${title}”? This cannot be undone.`}
      onCloseAutoFocus={event => { event.preventDefault(); const target = returnFocus.current; (target?.isConnected ? target : document.querySelector<HTMLElement>(".hub-chat-open") ?? document.querySelector<HTMLElement>("[data-assistant-launcher]"))?.focus({ preventScroll: true }); }}>
      <form className="flex min-h-0 flex-col" onSubmit={event => {
        event.preventDefault(); if (!editing || saving) return;
        const { id, kind } = editing;
        setSaving(true);
        void (kind === "rename" ? model.rename(id, title) : model.remove(id)).then(saved => {
          setSaving(false); setEditing(undefined);
          if (!saved) return;
          if (kind === "rename") { assistant.session(id).rename(title); setAnnouncement("Chat renamed."); }
          else { served.forgetSession(id); assistant.forgetSession(id); setAnnouncement("Chat deleted."); }
        });
      }}>
        {editing?.kind === "rename" && <DialogBody><Input aria-label="Chat title" autoComplete="off" maxLength={200} value={title} onFocus={event => event.target.select()} onChange={event => setTitle(event.target.value)} /></DialogBody>}
        <DialogFooter><Button variant="secondary" type="button" onClick={() => setEditing(undefined)}>Cancel</Button><Button variant={editing?.kind === "delete" ? "danger" : "primary"} type="submit" aria-busy={saving || undefined} disabled={saving || editing?.kind === "rename" && !title.trim()}>{editing?.kind === "rename" ? "Save" : "Delete"}</Button></DialogFooter>
      </form></DialogContent></Dialog>
  </>;
}
