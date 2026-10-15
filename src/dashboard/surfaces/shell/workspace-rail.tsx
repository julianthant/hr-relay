import type { InboxWiring } from "../../state/inbox-wiring-adapter.js";
import { useViewState } from "../../app/navigation/view-route-model.js";
import { ToggleButton } from "@heroui/react/toggle-button";
import { Bell } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";
import type { NavbarData, NavbarSearchResult } from "./search/navbar-view-model.js";
import { RailSearch } from "./search/navbar-view.js";
import { NotificationPing, NotificationsView } from "../notifications/notifications-view.js";
import { useNotificationRailModel } from "../notifications/notification-rail-model.js";
import type { NotificationDestination, NotificationsState } from "../notifications/notifications-view-model.js";
import type { WorkflowCountWire } from "./shell-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { WorkflowRail } from "./workflow-rail.js";


export const WorkspaceRail = memo(function WorkspaceRail({ workflows, counts, previewCounts, active, preview, onSelect, onPreview, settingsOpen, notifications, inbox, onOpenNotification, searchData, onSearch }: {
  workflows: readonly WorkflowCatalogEntry[]; counts?: readonly WorkflowCountWire[]; previewCounts?: readonly WorkflowCountWire[]; active: string; preview: string | null;
  onSelect: (id: string) => void; onPreview: (id: string) => void;
  settingsOpen: boolean;
  notifications: NotificationsState;
  inbox?: InboxWiring;
  searchData: NavbarData;
  onSearch: (result: NavbarSearchResult, opened: () => void, refused: (message: string) => void) => void;
  onOpenNotification: (destination: NotificationDestination, opened: () => void, refused: (message: string) => void) => void;
}) {
  const [filter, setFilter] = useViewState("notificationFilter", "all");
  const [category, setCategory] = useViewState("notificationCategory", "all");
  const [open, setOpen] = useViewState("notifications", false);
  const [notice, setNotice] = useState("");
  const notificationRail = useNotificationRailModel({ notifications, filter, setOpen, setNotice, onOpenNotification, served: inbox });
  const bell = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open || settingsOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault(); setOpen(false); bell.current?.focus();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, settingsOpen, setOpen]);
  return <aside aria-label="Workspace" className="workspace-rail ui-theme-scope" data-settings-open={settingsOpen} data-notifications-open={open} onKeyDown={event => {
      if (open && event.key === "Escape" && !(event.target instanceof HTMLElement && event.target.closest('[role="dialog"], [role="menu"]'))) { event.preventDefault(); event.stopPropagation(); setOpen(false); bell.current?.focus(); }
    }}>
    <header className="workspace-rail-header">
      <h2>Relay</h2>
      <div className="flex shrink-0 items-center gap-0.5">
        <ToggleButton ref={bell} isIconOnly size="sm" variant="ghost" isSelected={open} onChange={notificationRail.changeOpen} aria-controls={open ? "workspace-notifications" : undefined}
          aria-label={notificationRail.state.state === "loading" ? "Notifications loading" : notificationRail.state.state === "unavailable" ? "Notifications unavailable" : `Notifications, ${notificationRail.unread} unread`} className="rail-notification-toggle">
          <Bell aria-hidden className="size-4" />{notificationRail.unread !== undefined && notificationRail.unread > 0 && <span aria-label={`${notificationRail.unread} unread notifications`} className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-ui-info" />}
        </ToggleButton>
        <RailSearch data={searchData} onResult={onSearch} />
      </div>
    </header>
    <div className="workspace-rail-body" id={open ? "workspace-notifications" : undefined}>
      {open ? <NotificationsView state={notificationRail.state} filter={filter} onFilter={setFilter} category={category} onCategory={setCategory}
          onControl={notificationRail.onControl} onReadAll={notificationRail.onReadAll} onOpen={notificationRail.onOpenItem} notice={notice || inbox?.notice || ""} />
        : <WorkflowRail workflows={workflows} counts={counts} previewCounts={previewCounts} active={active} preview={preview} onSelect={onSelect} onPreview={onPreview} />}
    </div>
    {notificationRail.ping && notificationRail.pingItem && <NotificationPing item={notificationRail.pingItem} onClose={notificationRail.onClosePing} onOpen={notificationRail.onOpenPing} />}
  </aside>;
});
