import { useState } from "react";
import { notificationsSample } from "./notifications/notifications-fixture.js";
import { NotificationPing, NotificationsView } from "./notifications/notifications-view.js";
import { updateNotification, type NotificationFilter } from "./notifications/notifications-view-model.js";

export function NotificationBell() {
  const scenario = typeof window === "undefined" ? "normal" : new URLSearchParams(window.location.search).get("notificationsPreview") ?? "normal";
  const [state, setState] = useState(() => notificationsSample(scenario));
  const [filter, setFilter] = useState<NotificationFilter>("attention");
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [ping, setPing] = useState(scenario === "ping");
  const pingItem = state.state === "ready" ? state.items.find(item => item.id === "sample-completed") : undefined;
  return <>
    <NotificationsView state={state} filter={filter} onFilter={setFilter} open={open} onOpenChange={next => { setOpen(next); if (next) setPing(false); }} onControl={(id, control) => setState(current => updateNotification(current, id, control))} onOpen={() => setNotice("Run navigation is not connected yet.")} notice={notice} />
    {ping && pingItem && <NotificationPing item={pingItem} onClose={() => setPing(false)} onOpen={() => { setPing(false); setOpen(true); }} />}
  </>;
}
