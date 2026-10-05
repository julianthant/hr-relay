import { ToggleButton } from "@heroui/react/toggle-button";
import { Bell } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { NAVBAR_SAMPLE } from "./navbar/navbar-fixture.js";
import { RailSearch } from "./navbar/navbar-view.js";
import { NotificationPing, NotificationsView } from "./notifications/notifications-view.js";
import { applyNotificationReads, notificationView, type NotificationCategory, type NotificationDestination, type NotificationFilter, type NotificationsState } from "./notifications/notifications-view-model.js";
import type { WorkflowCountWire } from "./shell-model.js";
import type { WorkflowCatalogEntry } from "./workflow-catalog-model.js";
import { WorkflowRail } from "./workflow-rail.js";

function previewRun(): void {}

export const WorkspaceRail = memo(function WorkspaceRail({ workflows, counts, previewCounts, active, preview, onSelect, onPreview, settingsOpen, notifications, onOpenNotification }: {
  workflows: readonly WorkflowCatalogEntry[]; counts?: readonly WorkflowCountWire[]; previewCounts?: readonly WorkflowCountWire[]; active: string; preview: string | null;
  onSelect: (id: string) => void; onPreview: (id: string) => void;
  settingsOpen: boolean;
  notifications: NotificationsState;
  onOpenNotification: (destination: NotificationDestination, opened: () => void, refused: (message: string) => void) => void;
}) {
  const scenario = typeof window === "undefined" ? "normal" : new URLSearchParams(window.location.search).get("notificationsPreview") ?? "normal";
  const [reads, setReads] = useState<Readonly<Record<string, boolean>>>({});
  const state = useMemo(() => applyNotificationReads(notifications, reads), [notifications, reads]);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [category, setCategory] = useState<NotificationCategory>("all");
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [ping, setPing] = useState(scenario === "ping");
  const bell = useRef<HTMLButtonElement>(null);
  const view = notificationView(state, filter);
  const pingItem = state.state === "ready" ? state.items.find(item => item.destination.kind === "run" && item.title === "Run completed") : undefined;
  const changeOpen = (next: boolean) => { setOpen(next); if (next) setPing(false); };
  useEffect(() => {
    if (!open || settingsOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault(); setOpen(false); bell.current?.focus();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, settingsOpen]);
  return <aside aria-label="Workspace" className="workspace-rail ui-theme-scope" data-settings-open={settingsOpen} data-notifications-open={open} onKeyDown={event => {
      if (open && event.key === "Escape" && !(event.target instanceof HTMLElement && event.target.closest('[role="dialog"], [role="menu"]'))) { event.preventDefault(); event.stopPropagation(); setOpen(false); bell.current?.focus(); }
    }}>
    <header className="workspace-rail-header">
      <h2>HR GPT</h2>
      <div className="flex shrink-0 items-center gap-0.5">
        <ToggleButton ref={bell} isIconOnly size="sm" variant="ghost" isSelected={open} onChange={changeOpen} aria-controls={open ? "workspace-notifications" : undefined}
          aria-label={state.state === "loading" ? "Notifications loading" : state.state === "unavailable" ? "Notifications unavailable" : `Notifications, ${view.unread} unread`} className="rail-notification-toggle">
          <Bell aria-hidden className="size-4" />{view.unread !== undefined && view.unread > 0 && <span aria-label={`${view.unread} unread notifications`} className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-ui-info" />}
        </ToggleButton>
        <RailSearch data={NAVBAR_SAMPLE} onResult={previewRun} />
      </div>
    </header>
    <div className="workspace-rail-body" id={open ? "workspace-notifications" : undefined}>
      {open ? <NotificationsView state={state} filter={filter} onFilter={setFilter} category={category} onCategory={setCategory}
          onControl={(id, control) => setReads(current => ({ ...current, [id]: control === "read" }))}
          onReadAll={() => { if (state.state === "ready") setReads(current => ({ ...current, ...Object.fromEntries(state.items.map(item => [item.id, true])) })); }}
          onOpen={item => { setNotice(""); onOpenNotification(item.destination, () => { setReads(current => ({ ...current, [item.id]: true })); changeOpen(false); }, setNotice); }} notice={notice} />
        : <WorkflowRail workflows={workflows} counts={counts} previewCounts={previewCounts} active={active} preview={preview} onSelect={onSelect} onPreview={onPreview} />}
    </div>
    {ping && pingItem && <NotificationPing item={pingItem} onClose={() => setPing(false)} onOpen={() => changeOpen(true)} />}
  </aside>;
});
