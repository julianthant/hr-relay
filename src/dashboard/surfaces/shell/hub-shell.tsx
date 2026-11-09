import type { DashboardCommandBinding } from '../../app/dashboard-app-model.js';
import { useAssistantController } from "../assistant/assistant-controller-model.js";
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PreflightAssistantContext } from "../settings/preflight/preflight-assistant-model.js";
import { createPortal } from "react-dom";
import { History, LogOut, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter, EmptyState, SearchInput, Tab, TabList, TabPanel, Tabs } from "../../ds/ui.js";
import { assistantFrame } from "../assistant/assistant-mock-frames.js";
import { AssistantMockActivity } from "./assistant-mock-thread.js";
import { AssistantMark } from "./assistant-mark.js";
import { assistantLogo, assistantLogoState } from "./assistant-mark-model.js";
import { chatAge, createMockHubChatsPort, useHubChats, useHubPanelPosition, type HubChatsPort } from "./hub-shell-model.js";
import { AssistantPanel } from "./assistant-panel.js";
import type { AssistantPorts } from "./assistant-panel-model.js";
import { useHubAssistant } from "./hub-assistant-model.js";
import "./hub-shell.css";
import { useDashboardClient } from '../../state/client-context.js';
import { useAssistantHistory, type AssistantHistory } from '../assistant/assistant-history-model.js';
import type { AssistantModelPreferenceView } from '../../../models/dashboard/assistant.js';

type HubShellProps = { source?: "mock" | "served"; authority?: unknown; subjectRef?: string; onOpenSettings?: (section?: string) => void; settingsOpen: boolean; onLogout: () => void; chatsPort?: HubChatsPort; onRunWorkflow: NonNullable<AssistantPorts["onRunWorkflow"]>; commands?: DashboardCommandBinding };
export function HubShell(props: HubShellProps) {
  const client = useDashboardClient();
  const history = useAssistantHistory(client, props.source === 'served', props.authority);
  return <HubShellBody key={history.store?.profileId ?? (history.pending ? 'loading' : 'session')} {...props} history={history.store}
    preferenceChanged={history.preferenceChanged} modelPreference={history.preference} historyPending={history.pending || history.blocked || props.source === 'served' && history.store === undefined} historyNotice={history.notice || (history.pending ? 'Loading chat history…' : '')} />;
}
function HubShellBody({ onOpenSettings, settingsOpen, onLogout, chatsPort, onRunWorkflow, source = "mock", authority, commands, subjectRef, history, historyPending, historyNotice, modelPreference, preferenceChanged }: HubShellProps & { history?: AssistantHistory; historyPending: boolean; historyNotice: string; modelPreference?: AssistantModelPreferenceView['preference']; preferenceChanged?: (view: AssistantModelPreferenceView) => void }) {
  const panelPosition = useHubPanelPosition(4);
  const [logout, setLogout] = useState(false);
  const [opened, setOpened] = useState(source === "mock");
  const frame = assistantFrame(), logo = assistantLogo();
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "j" || event.altKey || event.shiftKey || settingsOpen) return;
      event.preventDefault(); panelPosition.reset(); setOpened(value => !value);
    };
    document.addEventListener("keydown", toggle);
    return () => document.removeEventListener("keydown", toggle);
  }, [settingsOpen, panelPosition]);
  const [list, setList] = useState(frame?.view === "activity");
  const [tab, setTab] = useState(frame?.view === "activity" ? "activity" : "chats");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ kind: "rename" | "delete"; id: string }>();
  const [title, setTitle] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [saving, setSaving] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setFooter(anchor.current?.closest(".dashboard-shell")?.querySelector<HTMLElement>('[aria-label="Session actions"] > span:last-child') ?? null); }, []);
  const localChats = useMemo(() => history?.chats ?? createMockHubChatsPort(source === "mock"), [source, history]);
  const model = useHubChats(chatsPort ?? localChats);
  const assistant = useHubAssistant(onRunWorkflow, (id, title) => { if (model.chats.some(chat => chat.id === id)) void model.rename(id, title); }, history);
  const assistantTest = useContext(PreflightAssistantContext);
  const seenRevision = useRef<string | undefined>(undefined);
  const modelChanged = useCallback((view: AssistantModelPreferenceView, saved: boolean) => {
    const revision = `${view.profileId}:${String(view.epoch)}:${String(view.revision)}`, prior = seenRevision.current; seenRevision.current = revision;
    // Every accepted save bumps the revision, even for the same choice; a read only reveals a change when it differs from the last seen revision.
    if (saved || prior !== undefined && prior !== revision) assistantTest.invalidate?.();
    preferenceChanged?.(view);
  }, [assistantTest, preferenceChanged]);
  const servedController = useAssistantController(assistant.client, authority, subjectRef, false, model.currentId, commands, { history, preferenceChanged: modelChanged });
  const served = historyPending ? { ...servedController, canCompose: false } : servedController;
  const current = model.chats.find(chat => chat.id === model.currentId);
  const currentSession = current ? assistant.session(current.id, current.title) : undefined;
  const edit = (kind: "rename" | "delete", id: string) => {
    const chat = model.chats.find(chat => chat.id === id);
    if (!chat) throw new Error("HUB_CHAT_UNAVAILABLE");
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTitle(chat.title); setEditing({ kind, id });
  };
  const icon = (label: string, glyph: ReactNode, onClick: () => void) => <button tabIndex={0} className="hub-icon" type="button" aria-label={label} title={label} onClick={onClick}>{glyph}</button>;
  return <>
    {footer && createPortal(<Button ref={launcher} tabIndex={0} size="sm" variant="ghost" className="sessions-bar-icon sessions-bar-mark" style={{ order: -1 }} aria-label="Ask Relay" aria-expanded={opened} aria-controls="hub-shell-assistant" title="Ask Relay (⌘J)" onClick={() => { panelPosition.reset(); setOpened(value => !value); }} icon={<AssistantMark direction={logo ?? "orbit"} state={assistantLogoState()} size={16} />} />, footer)}
    {footer && createPortal(<Button tabIndex={0} size="sm" variant="ghost" className="hub-logout sessions-bar-icon" aria-label="Log out" title="Log out" onClick={() => setLogout(true)} icon={<LogOut aria-hidden className="size-4" />} />, footer)}
      <section ref={panelPosition.element} id="hub-shell-assistant" className="hub-slot" aria-label={list ? "Relay assistant" : "Assistant panel"} data-source={model.source} hidden={settingsOpen || !opened} inert={settingsOpen || !opened} aria-hidden={settingsOpen || !opened} onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented && !editing) { event.preventDefault(); if (list) setList(false); else { setOpened(false); panelPosition.reset(); launcher.current?.focus(); } }
      }}>
        {list && <header className="hub-slot-header"><div className="hub-slot-title"><span>History</span></div><div className="hub-header-actions">
          {icon("Chats", <History aria-hidden />, () => { setList(value => !value); })}{icon("New chat", <Plus aria-hidden />, () => { void model.create(); setList(false); })}{icon("Close assistant", <X aria-hidden />, () => { setOpened(false); panelPosition.reset(); launcher.current?.focus(); })}
        </div></header>}
        {list ? <Tabs value={tab} onValueChange={setTab} className="hub-history"><TabList label="History" className="px-3"><Tab value="chats">Chats</Tab><Tab value="activity">Activity</Tab></TabList>
          <TabPanel value="chats" className="flex min-h-0 flex-1 flex-col"><div className="hub-transcript hub-chat-list" onKeyDown={event => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || event.target instanceof HTMLInputElement) return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }}>
          {model.error && <p role="alert" className="hub-caption">{model.error}</p>}
          <div className="hub-chat-search"><SearchInput aria-label="Search chats" placeholder="Search chats" value={query} onChange={event => setQuery(event.target.value)} /></div>
          {model.chats.length === 0 ? <div className="hub-empty"><strong>No chats yet</strong>Start a new chat to ask Relay for help.</div> : !model.chats.some(chat => chat.title.toLowerCase().includes(query.toLowerCase())) ? <div className="hub-empty">No matching chats.</div> : (["Today", "Yesterday", "Earlier"] as const).map(group => {
            const rows = model.chats.filter(chat => chat.group === group && chat.title.toLowerCase().includes(query.toLowerCase()));
            return rows.length > 0 && <section className="hub-chat-group" key={group}><h3>{group}</h3>{rows.map(chat => <div className="hub-chat-row" key={chat.id} data-current={chat.id === model.currentId} onKeyDown={event => {
              if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); edit("delete", chat.id); }
            }}><button tabIndex={0} className="hub-chat-open" type="button" aria-current={chat.id === model.currentId ? "true" : undefined} onClick={() => { void model.select(chat.id); setList(false); }}><strong>{chat.title}</strong><small>{chatAge(chat.minutes)}{chat.id === model.currentId && " · Current"}</small></button>{icon(`Rename chat ${chat.title}`, <Pencil aria-hidden />, () => edit("rename", chat.id))}{icon(`Delete chat ${chat.title}`, <Trash2 aria-hidden />, () => edit("delete", chat.id))}</div>)}</section>;
          })}
        </div></TabPanel>
          <TabPanel value="activity" className="hub-transcript">{frame ? <AssistantMockActivity /> : <EmptyState title="No activity today" />}</TabPanel>
        </Tabs> : null}
        <div className="hub-assistant-slot" data-hub-assistant-slot="" hidden={list} inert={list}>
          {current && currentSession && <AssistantPanel key={current.id} historyNotice={historyNotice || model.error} modelPreference={modelPreference} served={source === "served" ? served : undefined} onAutomaticTitle={title => currentSession.autoTitle(title)} producer={currentSession.producer} draft={currentSession.draft} accountClient={assistant.client} {...assistant.ports(current.id)} title={current.title} onOpenSettings={onOpenSettings}
            onClose={() => { setOpened(false); panelPosition.reset(); launcher.current?.focus(); }} onChats={() => { setList(true); }} onNewChat={() => { void model.create(); setList(false); }} onRename={() => edit("rename", current.id)} ></AssistantPanel>}
        </div>
      </section>
    <span ref={anchor} role="status" className="sr-only">{announcement}</span>
    <Dialog open={logout} onOpenChange={setLogout}><DialogContent hideClose className="hub-modal" title="Log out?" description="End your current Relay session?" onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>(".hub-logout")?.focus(); }}><DialogFooter><button tabIndex={0} className="hub-btn" onClick={() => setLogout(false)}>Cancel</button><button tabIndex={0} className="hub-btn primary" onClick={() => { setLogout(false); onLogout(); }}>Log out</button></DialogFooter></DialogContent></Dialog>
    <Dialog open={editing !== undefined} onOpenChange={open => { if (!open) setEditing(undefined); }}><DialogContent hideClose className="hub-modal" title={editing?.kind === "rename" ? "Rename chat" : "Delete chat?"} description={editing?.kind === "rename" ? "Keep it short and recognizable" : `Delete “${title}”? This cannot be undone.`}
      onCloseAutoFocus={event => { event.preventDefault(); const target = returnFocus.current; (target?.isConnected ? target : document.querySelector<HTMLElement>(".hub-chat-open") ?? launcher.current)?.focus({ preventScroll: true }); }}>
      <form onSubmit={event => {
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
        {editing?.kind === "rename" && <input className="hub-field" aria-label="Chat title" autoComplete="off" maxLength={200} value={title} onFocus={event => event.target.select()} onChange={event => setTitle(event.target.value)} />}
        <DialogFooter><button tabIndex={0} className="hub-btn" type="button" onClick={() => setEditing(undefined)}>Cancel</button><button tabIndex={0} className={`hub-btn ${editing?.kind === "delete" ? "danger" : "primary"}`} type="submit" aria-busy={saving || undefined} disabled={saving || editing?.kind === "rename" && !title.trim()}>{editing?.kind === "rename" ? "Save" : "Delete"}</button></DialogFooter>
      </form></DialogContent></Dialog>
  </>;
}
