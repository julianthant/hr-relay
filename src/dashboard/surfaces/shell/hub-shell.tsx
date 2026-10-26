import type { DashboardCommandBinding } from '../../app/dashboard-app-model.js';
import { useAssistantController } from "../assistant/assistant-controller-model.js";
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, History, LogOut, Pencil, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { Button, Dialog, DialogContent, DialogFooter } from "../../ds/ui.js";
import { chatAge, createMockHubChatsPort, useHubChats, useHubPanelPosition, type HubChatsPort } from "./hub-shell-model.js";
import { AssistantPanel } from "./assistant-panel.js";
import type { AssistantPorts } from "./assistant-panel-model.js";
import { ChatFiles } from "./chat-files.js";
import { useHubAssistant } from "./hub-assistant-model.js";
import "./hub-shell.css";

export function HubShell({ settingsOpen, onLogout, chatsPort, onRunWorkflow, source = "mock", authority , commands}: { source?: "mock" | "served"; authority?: unknown; settingsOpen: boolean; onLogout: () => void; chatsPort?: HubChatsPort; onRunWorkflow: NonNullable<AssistantPorts["onRunWorkflow"]> ; commands?: DashboardCommandBinding; }) {
  const panelPosition = useHubPanelPosition(4);
  const launcherPosition = useHubPanelPosition(8, true);
  const [logout, setLogout] = useState(false);
  const [opened, setOpened] = useState(true);
  const [list, setList] = useState(false);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ kind: "rename" | "delete"; id: string }>();
  const [title, setTitle] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const launcher = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const [footer, setFooter] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => { setFooter(anchor.current?.closest(".dashboard-shell")?.querySelector<HTMLElement>('[aria-label="Session actions"] > span:last-child') ?? null); }, []);
  const localChats = useMemo(() => createMockHubChatsPort(source === "mock"), [source]);
  const model = useHubChats(chatsPort ?? localChats);
  const assistant = useHubAssistant(onRunWorkflow, (id, title) => { if (model.chats.some(chat => chat.id === id)) model.rename(id, title); });
  const served = useAssistantController(assistant.client, authority, undefined, false, model.currentId, commands);
  const filesView = assistant.view?.id === model.currentId ? assistant.view : undefined;
  const backToChat = () => { assistant.closeFiles(); panelPosition.element.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus(); };
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
    {footer && createPortal(<Button tabIndex={0} size="sm" variant="ghost" className="hub-logout size-8 p-0" aria-label="Log out" title="Log out" onClick={() => setLogout(true)} icon={<LogOut aria-hidden className="size-4" />} />, footer)}
      <section ref={panelPosition.element} id="hub-shell-assistant" className="hub-slot" aria-label={list ? "Relay assistant" : "Assistant panel"} data-source={model.source} hidden={settingsOpen || !opened} inert={settingsOpen || !opened} aria-hidden={settingsOpen || !opened} onKeyDown={event => {
        if (event.key === "Escape" && !event.defaultPrevented && !editing) { event.preventDefault(); if (filesView) backToChat(); else if (list) setList(false); else { setOpened(false); panelPosition.reset(); launcher.current?.focus(); } }
      }}>
        {list && <header className="hub-slot-header" tabIndex={0} aria-label="Move panel with arrow keys" onPointerDown={panelPosition.onPointerDown} onPointerMove={panelPosition.onPointerMove} onPointerUp={panelPosition.onPointerUp} onPointerCancel={panelPosition.onPointerCancel} onLostPointerCapture={panelPosition.onPointerCancel} onKeyDown={panelPosition.onKeyDown}><div className="hub-slot-title"><span>Chats</span></div><div className="hub-header-actions">
          {icon("Chats", <History aria-hidden />, () => { assistant.closeFiles(); setList(value => !value); })}{icon("New chat", <Plus aria-hidden />, () => { assistant.closeFiles(); model.create(); setList(false); })}{icon("Close assistant", <X aria-hidden />, () => { setOpened(false); panelPosition.reset(); launcher.current?.focus(); })}
        </div></header>}
        {list ? <div className="hub-transcript hub-chat-list" onKeyDown={event => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || event.target instanceof HTMLInputElement) return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (index < 0) return;
          event.preventDefault(); buttons[event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
        }}>
          <div className="hub-chat-search"><Search aria-hidden /><input className="hub-field" aria-label="Search chats" placeholder="Search chats" value={query} onChange={event => setQuery(event.target.value)} /></div>
          {model.chats.length === 0 ? <div className="hub-empty"><strong>No chats yet</strong>Start a new chat to ask Relay for help.</div> : !model.chats.some(chat => chat.title.toLowerCase().includes(query.toLowerCase())) ? <div className="hub-empty">No matching chats.</div> : (["Today", "Yesterday", "Earlier"] as const).map(group => {
            const rows = model.chats.filter(chat => chat.group === group && chat.title.toLowerCase().includes(query.toLowerCase()));
            return rows.length > 0 && <section className="hub-chat-group" key={group}><h3>{group}</h3>{rows.map(chat => <div className="hub-chat-row" key={chat.id} data-current={chat.id === model.currentId} onKeyDown={event => {
              if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); edit("delete", chat.id); }
            }}><button tabIndex={0} className="hub-chat-open" type="button" aria-current={chat.id === model.currentId ? "true" : undefined} onClick={() => { model.select(chat.id); setList(false); }}><strong>{chat.title}</strong><small>{chatAge(chat.minutes)}{chat.id === model.currentId && " · Current"}</small></button>{icon(`Rename chat ${chat.title}`, <Pencil aria-hidden />, () => edit("rename", chat.id))}{icon(`Delete chat ${chat.title}`, <Trash2 aria-hidden />, () => edit("delete", chat.id))}</div>)}</section>;
          })}
        </div> : null}
        <div className="hub-assistant-slot" data-hub-assistant-slot="" hidden={list} inert={list}>
          {current && currentSession && <AssistantPanel key={current.id} served={source === "served" ? served : undefined} onAutomaticTitle={title => currentSession.autoTitle(title)} producer={currentSession.producer} draft={currentSession.draft} accountClient={assistant.client} {...assistant.ports(current.id)} title={current.title} filesOpen={!!filesView} onSendMessage={filesView ? assistant.closeFiles : undefined}
            onClose={() => { setOpened(false); panelPosition.reset(); launcher.current?.focus(); }} onChats={() => { assistant.closeFiles(); setList(true); }} onNewChat={() => { assistant.closeFiles(); model.create(); setList(false); }} onRename={() => edit("rename", current.id)}
            headerProps={{ tabIndex: 0, "aria-label": "Move panel with arrow keys", onPointerDown: panelPosition.onPointerDown, onPointerMove: panelPosition.onPointerMove, onPointerUp: panelPosition.onPointerUp, onPointerCancel: panelPosition.onPointerCancel, onLostPointerCapture: panelPosition.onPointerCancel, onKeyDown: panelPosition.onKeyDown }} >{filesView ? <div className="hub-files-slot">{assistant.error && <p role="alert">{assistant.error}</p>}<ChatFiles key={`${filesView.id}:${filesView.initialFile?.id ?? filesView.mode}`} port={assistant.session(filesView.id).files} mode={filesView.mode} initialFile={filesView.initialFile} onBackToChat={backToChat} onAttachFile={filesView.mode === "attach" ? file => { void assistant.select(file); } : undefined} /></div> : undefined}</AssistantPanel>}
        </div>
      </section>
      <button tabIndex={0} ref={element => { launcher.current = element; launcherPosition.element.current = element; }} className="hub-assistant-launcher" hidden={settingsOpen} type="button" aria-label="Assistant" aria-description="Drag to move. Alt and arrow keys also move the launcher." aria-controls="hub-shell-assistant" aria-expanded={opened} onPointerDown={launcherPosition.onPointerDown} onPointerMove={launcherPosition.onPointerMove} onPointerUp={launcherPosition.onPointerUp} onPointerCancel={launcherPosition.onPointerCancel} onLostPointerCapture={launcherPosition.onPointerUp} onKeyDown={launcherPosition.onKeyDown} onClick={() => { if (launcherPosition.moved.current) { launcherPosition.moved.current = false; return; } panelPosition.reset(); setOpened(value => !value); }}>{opened ? <ChevronDown aria-hidden /> : <Sparkles aria-hidden />}</button>
    <span ref={anchor} role="status" className="sr-only">{announcement}</span>
    <Dialog open={logout} onOpenChange={setLogout}><DialogContent hideClose className="hub-modal" title="Log out?" description="End your current Relay session?" onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLButtonElement>(".hub-logout")?.focus(); }}><DialogFooter><button tabIndex={0} className="hub-btn" onClick={() => setLogout(false)}>Cancel</button><button tabIndex={0} className="hub-btn primary" onClick={() => { setLogout(false); onLogout(); }}>Log out</button></DialogFooter></DialogContent></Dialog>
    <Dialog open={editing !== undefined} onOpenChange={open => { if (!open) setEditing(undefined); }}><DialogContent hideClose className="hub-modal" title={editing?.kind === "rename" ? "Rename chat" : "Delete chat?"} description={editing?.kind === "rename" ? "Keep it short and recognizable" : `Delete “${title}”? This cannot be undone.`}
      onCloseAutoFocus={event => { event.preventDefault(); const target = returnFocus.current; (target?.isConnected ? target : document.querySelector<HTMLElement>(".hub-chat-open") ?? launcher.current)?.focus({ preventScroll: true }); }}>
      <form onSubmit={event => {
        event.preventDefault(); if (!editing) return;
        if (editing.kind === "rename") { model.rename(editing.id, title); assistant.session(editing.id).rename(title); setAnnouncement("Chat renamed."); }
        else { served.forgetSession(editing.id); assistant.forgetSession(editing.id); model.remove(editing.id); setAnnouncement("Chat deleted."); }
        setEditing(undefined);
      }}>
        {editing?.kind === "rename" && <input className="hub-field" aria-label="Chat title" autoComplete="off" maxLength={200} value={title} onFocus={event => event.target.select()} onChange={event => setTitle(event.target.value)} />}
        <DialogFooter><button tabIndex={0} className="hub-btn" type="button" onClick={() => setEditing(undefined)}>Cancel</button><button tabIndex={0} className={`hub-btn ${editing?.kind === "delete" ? "danger" : "primary"}`} type="submit" disabled={editing?.kind === "rename" && !title.trim()}>{editing?.kind === "rename" ? "Save" : "Delete"}</button></DialogFooter>
      </form></DialogContent></Dialog>
  </>;
}
