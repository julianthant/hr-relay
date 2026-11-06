import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";

export interface HubChat { readonly id: string; readonly title: string; readonly minutes: number; readonly group: "Today" | "Yesterday" | "Earlier" }
export interface HubChatsPort {
  readonly source: "mock" | "local";
  read(this: void): readonly HubChat[];
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  create(): Promise<HubChat>;
  selectedId?(): string | undefined;
  select?(id: string): Promise<void>;
}
export function createMockHubChatsPort(preview = true): HubChatsPort {
  let sequence = 0;
  let chats: readonly HubChat[] = preview ? [
    { id: "a", title: "Update Alex Rivera work email", minutes: 0, group: "Today" },
    { id: "b", title: "Check employment details", minutes: 1, group: "Today" },
    { id: "c", title: "Review onboarding records", minutes: 1440, group: "Yesterday" },
    { id: "d", title: "Compare this very long work study record with the earlier employment and payroll information", minutes: 4320, group: "Earlier" },
  ] : [{ id: "initial", title: "New chat", minutes: 0, group: "Today" }];
  return {
    source: preview ? "mock" : "local", read: () => chats,
    async rename(id, title) {
      if (!chats.some(chat => chat.id === id)) throw new Error("HUB_CHAT_UNAVAILABLE");
      if (!title.trim() || title.trim().length > 200) throw new Error("HUB_CHAT_TITLE_INVALID");
      chats = chats.map(chat => chat.id === id ? { ...chat, title: title.trim() } : chat);
    },
    async remove(id) { if (!chats.some(chat => chat.id === id)) throw new Error("HUB_CHAT_UNAVAILABLE"); chats = chats.filter(chat => chat.id !== id); },
    async create() { const chat: HubChat = { id: `new-${++sequence}`, title: "New chat", minutes: 0, group: "Today" }; chats = [chat, ...chats]; return chat; },
  };
}
export function chatAge(minutes: number): string {
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / 1440);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}
export function useHubChats(supplied?: HubChatsPort) {
  const port = useMemo(() => supplied ?? createMockHubChatsPort(), [supplied]);
  const [chats, setChats] = useState(port.read);
  const [currentId, setCurrentId] = useState<string | undefined>(() => port.selectedId?.() ?? chats[0]?.id);
  const [error, setError] = useState('');
  /** True once the port acknowledged the change; a failure stays visible in `error`. */
  const settle = async (work: () => Promise<void>, fallback: string) => {
    let saved = false;
    try { await work(); setError(''); saved = true; } catch (cause) { setError(cause instanceof Error ? cause.message : fallback); }
    setChats(port.read());
    return saved;
  };
  return { chats, currentId, error, source: port.source,
    select: (id: string) => settle(async () => { await port.select?.(id); setCurrentId(id); }, 'Chat could not be opened.'),
    rename: (id: string, title: string) => settle(() => port.rename(id, title), 'Chat could not be renamed.'),
    remove: (id: string) => settle(async () => { await port.remove(id); const next = port.read(); if (currentId === id) setCurrentId(next[0]?.id); }, 'Chat could not be deleted.'),
    create: () => settle(async () => { const chat = await port.create(); setCurrentId(chat.id); }, 'Chat could not be created.'),
  };
}

export function useHubPanelPosition(inset: number, altKeyOnly = false) {
  const element = useRef<HTMLElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const moved = useRef(false);
  const place = useCallback((x: number, y: number) => {
    const panel = element.current;
    if (!panel) return;
    const box = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(inset, Math.min(x, window.innerWidth - box.width - inset))}px`;
    panel.style.top = `${Math.max(inset, Math.min(y, window.innerHeight - box.height - inset))}px`;
    panel.style.right = "auto"; panel.style.bottom = "auto";
  }, [inset]);
  useEffect(() => {
    const resize = () => {
      const panel = element.current;
      if (panel?.style.left) { const box = panel.getBoundingClientRect(); place(box.left, box.top); }
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [place]);
  return { element, moved,
    reset(this: void) { const panel = element.current; if (panel) for (const name of ["left", "top", "right", "bottom"]) panel.style.removeProperty(name); },
    onPointerDown(this: void, event: ReactPointerEvent<HTMLElement>) {
      if (event.button !== 0 || !altKeyOnly && event.target instanceof Element && event.target.closest("button")) return;
      const panel = element.current;
      if (!panel) return;
      const box = panel.getBoundingClientRect(); moved.current = false;
      drag.current = { x: event.clientX, y: event.clientY, left: box.left, top: box.top, moved: false };
      event.currentTarget.setPointerCapture(event.pointerId);
      if (!altKeyOnly) event.preventDefault();
    },
    onPointerMove(this: void, event: ReactPointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current) return;
      const dx = event.clientX - current.x, dy = event.clientY - current.y;
      if (!altKeyOnly || Math.hypot(dx, dy) > 5) current.moved = true;
      if (current.moved) { moved.current = true; place(current.left + dx, current.top + dy); }
    },
    onPointerUp(this: void) { drag.current = null; },
    onPointerCancel(this: void) { drag.current = null; moved.current = false; },
    onKeyDown(this: void, event: ReactKeyboardEvent<HTMLElement>) {
      if (event.target !== event.currentTarget || altKeyOnly && !event.altKey) return;
      const delta = event.key === "ArrowLeft" ? [-16, 0] : event.key === "ArrowRight" ? [16, 0] : event.key === "ArrowUp" ? [0, -16] : event.key === "ArrowDown" ? [0, 16] : undefined;
      const panel = element.current;
      if (!delta || !panel) return;
      event.preventDefault(); const box = panel.getBoundingClientRect(); place(box.left + delta[0], box.top + delta[1]);
    },
  };
}
