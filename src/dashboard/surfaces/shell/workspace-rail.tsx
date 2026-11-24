import { inboxMessage, type InboxWiring } from "../../state/inbox-wiring-adapter.js";
import { memo, useState } from "react";
import { PanelLeft } from "lucide-react";
import { IconButton, Tooltip, useToasts } from "../../ds/ui.js";
import type { NavbarData, NavbarSearchResult } from "./search/navbar-view-model.js";
import type { PaletteAction } from "./search/search-palette-model.js";
import { shortcutLabel, useShortcutPreferences } from "../settings/navigation/keyboard-preferences-model.js";
import { RailSearch } from "./search/navbar-view.js";
import { NotificationsPopover, type NotificationsShow } from "../notifications/notifications-popover.js";
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
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState<NotificationsShow>("all");
  const { toast } = useToasts();
  const onAlert = useNotificationAlert();
  const notificationRail = useNotificationRailModel({ open, onAlert, setOpen, onOpenNotification, served: inbox,
    // "Target is gone" explains nothing, so only a specific reason is shown under the title.
    onRefused: (item, message) => toast({ tone: "danger", key: "notification-refused", title: item.kind === "run" ? "Couldn't open this run" : "Couldn't open this notification",
      ...(message === inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") ? {} : { description: message }) }) });
  const start = useShortcutPreferences().bindings.start[0];
  const [collapsed, setCollapsed] = useRailCollapsed();
  return <aside aria-label="Workspace" className="workspace-rail ui-theme-scope" data-settings-open={settingsOpen} data-collapsed={collapsed || undefined}>
    <header className="workspace-rail-header">
      <h2>Relay</h2>
      <div className="workspace-rail-actions">
        <Tooltip side={collapsed ? "right" : "bottom"} content={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          <IconButton variant="ghost" size="sm" label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title="" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} icon={<PanelLeft aria-hidden className="size-4" />} />
        </Tooltip>
        <NotificationsPopover state={notificationRail.state} open={open} onOpenChange={notificationRail.changeOpen} show={show} onShow={setShow} notice={inbox.notice}
          onReadAll={notificationRail.onReadAll} onOpen={notificationRail.onOpenItem} onControl={(id, control) => { void notificationRail.onControl(id, control); }} canAct={notificationRail.canAct} />
        <RailSearch data={searchData} workflows={workflows} startKey={start && shortcutLabel(start).toUpperCase()} onAction={onSearchAction} onWorkflow={onSelect} onResult={onSearch} />
      </div>
    </header>
    <div className="workspace-rail-body">
      <WorkflowRail workflows={workflows} counts={counts} active={active} onSelect={onSelect} collapsed={collapsed} />
    </div>
  </aside>;
});
