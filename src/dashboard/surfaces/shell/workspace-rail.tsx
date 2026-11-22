import type { InboxWiring } from "../../state/inbox-wiring-adapter.js";
import { useViewState } from "../../app/navigation/view-route-model.js";
import { memo, useRef, useState } from "react";
import { PanelLeft } from "lucide-react";
import { IconButton, Tooltip } from "../../ds/ui.js";
import type { NavbarData, NavbarSearchResult } from "./search/navbar-view-model.js";
import type { PaletteAction } from "./search/search-palette-model.js";
import { shortcutLabel, useShortcutPreferences } from "../settings/navigation/keyboard-preferences-model.js";
import { RailSearch } from "./search/navbar-view.js";
import { NotificationBell, NotificationsPanel } from "../notifications/notifications-view.js";
import { useNotificationAlert, useNotificationRailModel } from "../notifications/notification-rail-model.js";
import type { NotificationDestination } from "../notifications/notifications-view-model.js";
import type { WorkflowCountWire } from "./shell-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { WorkflowRail } from "./workflow-rail.js";
import { useRailCollapsed } from "./workflow-rail-model.js";

export const WorkspaceRail = memo(function WorkspaceRail({ workflows, counts, active, onSelect, settingsOpen, inbox, onOpenNotification, searchData, onSearch, onSearchAction }: {
  workflows: readonly WorkflowCatalogEntry[]; counts?: readonly WorkflowCountWire[]; active: string;
  onSelect: (id: string) => void;
  settingsOpen: boolean;
  inbox: InboxWiring;
  searchData: NavbarData;
  onSearchAction: (action: PaletteAction) => void;
  onSearch: (result: NavbarSearchResult, opened: () => void, refused: (message: string) => void) => void;
  onOpenNotification: (destination: NotificationDestination, opened: () => void, refused: (message: string) => void) => void;
}) {
  const [open, setOpen] = useViewState("notifications", false);
  const [showPriority, setShowPriority] = useState(true);
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [activeId, setActiveId] = useViewState("notificationActive", "", "replace");
  const [notice, setNotice] = useState("");
  const onAlert = useNotificationAlert();
  const notificationRail = useNotificationRailModel({ open, onAlert, setOpen, setNotice, onOpenNotification, onActive: setActiveId, served: inbox });
  const start = useShortcutPreferences().bindings.start[0];
  const bell = useRef<HTMLButtonElement>(null);
  const [stored, setCollapsed] = useRailCollapsed();
  const collapsed = stored;
  const toggleBell = () => { if (stored && !open) setCollapsed(false); notificationRail.changeOpen(!open); };
  const back = () => { notificationRail.changeOpen(false); bell.current?.focus(); };
  return <aside aria-label="Workspace" className="workspace-rail ui-theme-scope" data-settings-open={settingsOpen} data-notifications-open={open} data-collapsed={collapsed || undefined}>
    <header className="workspace-rail-header">
      <h2>Relay</h2>
      <div className="workspace-rail-actions">
        <Tooltip side={collapsed ? "right" : "bottom"} content={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <IconButton variant="ghost" size="sm" label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title="" aria-expanded={!collapsed} onClick={() => { if (!collapsed && open) notificationRail.changeOpen(false); setCollapsed(!collapsed); }} icon={<PanelLeft aria-hidden className="size-4" />} />
        </Tooltip>
        <NotificationBell ref={bell} open={open} unread={(notificationRail.unread ?? 0) > 0} onToggle={toggleBell}
          label={notificationRail.state.state === "loading" ? "Notifications loading" : notificationRail.state.state === "unavailable" ? "Notifications unavailable" : `Notifications, ${notificationRail.unread} unread`} />
        <RailSearch data={searchData} workflows={workflows} startKey={start && shortcutLabel(start).toUpperCase()} onAction={onSearchAction} onWorkflow={onSelect} onResult={onSearch} />
      </div>
    </header>
    <div className="workspace-rail-body">
      {open && !collapsed ? <NotificationsPanel activeId={activeId} showPriority={showPriority} onShowPriority={setShowPriority} dismissed={dismissed} onDismiss={id => setDismissed(current => [...current, id])} onControl={notificationRail.onControl} state={notificationRail.state} onReadAll={notificationRail.onReadAll} onOpen={notificationRail.onOpenItem} onBack={back} notice={notice || inbox?.notice || ""} />
        : <WorkflowRail workflows={workflows} counts={counts} active={active} onSelect={onSelect} collapsed={collapsed} />}
    </div>
  </aside>;
});
