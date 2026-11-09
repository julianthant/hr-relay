import type { InboxWiring } from "../../state/inbox-wiring-adapter.js";
import { useViewState } from "../../app/navigation/view-route-model.js";
import { memo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { NavbarData, NavbarSearchResult } from "./search/navbar-view-model.js";
import { RailSearch } from "./search/navbar-view.js";
import { NotificationBell, NotificationPing, NotificationsPanel } from "../notifications/notifications-view.js";
import { useNotificationRailModel, type NotificationReads } from "../notifications/notification-rail-model.js";
import type { NotificationDestination, NotificationsState } from "../notifications/notifications-view-model.js";
import type { WorkflowCountWire } from "./shell-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { WorkflowRail } from "./workflow-rail.js";

export const WorkspaceRail = memo(function WorkspaceRail({ workflows, counts, previewCounts, active, preview, onSelect, onPreview, settingsOpen, notifications, reads, setReads, inbox, onOpenNotification, searchData, onSearch }: {
  workflows: readonly WorkflowCatalogEntry[]; counts?: readonly WorkflowCountWire[]; previewCounts?: readonly WorkflowCountWire[]; active: string; preview: string | null;
  onSelect: (id: string) => void; onPreview: (id: string) => void;
  settingsOpen: boolean;
  notifications: NotificationsState;
  reads: NotificationReads;
  setReads: Dispatch<SetStateAction<NotificationReads>>;
  inbox?: InboxWiring;
  searchData: NavbarData;
  onSearch: (result: NavbarSearchResult, opened: () => void, refused: (message: string) => void) => void;
  onOpenNotification: (destination: NotificationDestination, opened: () => void, refused: (message: string) => void) => void;
}) {
  const [open, setOpen] = useViewState("notifications", false);
  const [showPriority, setShowPriority] = useState(true);
  const [activeId, setActiveId] = useViewState("notificationActive", "", "replace");
  const [notice, setNotice] = useState("");
  const notificationRail = useNotificationRailModel({ notifications, reads, setReads, setOpen, setNotice, onOpenNotification, onActive: setActiveId, served: inbox });
  const bell = useRef<HTMLButtonElement>(null);
  const back = () => { notificationRail.changeOpen(false); bell.current?.focus(); };
  return <aside aria-label="Workspace" className="workspace-rail ui-theme-scope" data-settings-open={settingsOpen} data-notifications-open={open}>
    <header className="workspace-rail-header">
      <h2>Relay</h2>
      <div className="flex shrink-0 items-center gap-0.5">
        <NotificationBell ref={bell} open={open} unread={(notificationRail.unread ?? 0) > 0} onToggle={() => notificationRail.changeOpen(!open)}
          label={notificationRail.state.state === "loading" ? "Notifications loading" : notificationRail.state.state === "unavailable" ? "Notifications unavailable" : `Notifications, ${notificationRail.unread} unread`} />
        <RailSearch data={searchData} onResult={onSearch} />
      </div>
    </header>
    <div className="workspace-rail-body">
      {open ? <NotificationsPanel activeId={activeId} showPriority={showPriority} onShowPriority={setShowPriority} state={notificationRail.state} onReadAll={notificationRail.onReadAll} onOpen={notificationRail.onOpenItem} onBack={back} notice={notice || inbox?.notice || ""} />
        : <WorkflowRail workflows={workflows} counts={counts} previewCounts={previewCounts} active={active} preview={preview} onSelect={onSelect} onPreview={onPreview} />}
    </div>
    {notificationRail.ping && notificationRail.pingItem && <NotificationPing item={notificationRail.pingItem} />}
  </aside>;
});
