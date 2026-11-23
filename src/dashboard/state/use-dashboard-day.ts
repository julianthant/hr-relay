/** The selected day's server state, and nothing else.
 * One subscription per day (ref frontend-backend-integration: one global stream, not a connection */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotificationPublicationWire } from "../../models/dashboard/subscription.js";
import type { DashboardDayWire } from "../../models/dashboard/projection.js";
import type { SubscriptionState } from "../client/index.js";
import { protocolError } from "../client/errors.js";
import { createKeptResults, dropKeptResults, failed, loaded, loadingWith, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";

export interface DashboardDayState {
  readonly request: object;
  /** A new object each time this request's stream opens again after a reset; a read under an older one is pre-reset. */
  readonly stream?: object;
  readonly day: AsyncResource<DashboardDayWire>;
  readonly connection: SubscriptionState;
  readonly subscribePublications: (listener: (publication: NotificationPublicationWire) => void) => () => void;
  readonly refresh: () => void;
}

/** How many days' last frames a page keeps for an instant return. */
export const KEPT_DAYS_LIMIT = 8;
const keptDays = createKeptResults<DashboardDayWire>(KEPT_DAYS_LIMIT);

export function useDashboardDay(day: string | undefined, nowIso?: string, authorityEpoch?: object, actorId?: string): DashboardDayState {
  const client = useDashboardClient();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const firedExpiries = useRef(new Set<string>());
  // A new object per request, including A → B → A; the render guard runs before effects. The kept frame is
  // read here, during render, so the frame that switches the day already shows that day's kept copy.
  const request = useMemo(() => {
    const listeners = new Set<(publication: NotificationPublicationWire) => void>();
    const kept = day === undefined ? undefined : keptDays.get(client, [authorityEpoch, actorId], day);
    return { client, day, revision, authorityEpoch, actorId, kept,
      subscribePublications: (listener: (publication: NotificationPublicationWire) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      publishPublication: (publication: NotificationPublicationWire) => { for (const listener of listeners) listener(publication); },
    };
  }, [client, day, revision, authorityEpoch, actorId]);
  const activeRequest = useRef(request);
  activeRequest.current = request;
  const subscribePublications = request.subscribePublications;
  const [result, setResult] = useState<{ request: typeof request; value: DashboardDayState }>();
  useEffect(() => {
    let active = true;
    let shown = request.kept;
    let stream = {};
    let value: DashboardDayState = { request, stream, day: loadingWith(shown), connection: { state: "connecting" }, refresh, subscribePublications };
    // Whether this stream has served a frame or reported itself up; connecting again after either is a reset.
    let opened = false;
    const owns = (): boolean => active && activeRequest.current === request;
    const publish = (): void => { if (active) setResult({ request, value }); };
    publish();
    if (day === undefined) return () => { active = false; };
    let subscription: { close: () => void } | undefined;
    // Subscribe once the mount has settled: a mount cancelled in the same tick opens no stream.
    queueMicrotask(() => { if (!active) return; subscription = client.subscribeDay({
      day,
      ...(actorId === undefined ? {} : { publications: { actorId, onPublication: (publication: NotificationPublicationWire) => {
        if (!active || activeRequest.current !== request) return;
        request.publishPublication(publication);
      } } }),
      onDay: (next) => {
        if (!active) return;
        if (next.day !== day) {
          const error = protocolError("day-request-identity-mismatch");
          value = { request, stream, day: failed(error), connection: { state: "stopped", error }, refresh, subscribePublications };
        } else {
          opened = true;
          // A superseded stream can still deliver between the next render and this effect's cleanup; it keeps nothing.
          if (owns()) keptDays.keep(client, [authorityEpoch, actorId], day, { value: next, at: next.snapshotCursor });
          value = { ...value, day: loaded(next) };
        }
        publish();
      },
      onState: (connection) => {
        if (!active) return;
        // A stream reset, even before this request's first frame: nothing kept from before it may show.
        if (connection.state === "connecting" && opened) {
          opened = false;
          shown = undefined;
          stream = {};
          if (owns()) dropKeptResults(client);
        }
        if (connection.state !== "connecting" && connection.state !== "stopped") opened = true;
        value = { request, stream, day: connection.state === "stopped" && connection.error !== undefined
          ? failed(connection.error) : connection.state === "connecting" ? loadingWith(shown) : value.day, connection, refresh, subscribePublications };
        publish();
      },
    }); });
    return () => { active = false; subscription?.close(); };
  }, [client, day, actorId, authorityEpoch, request, refresh, subscribePublications]);
  const current = result?.request === request ? result.value : { request, day: loadingWith(request.kept), connection: { state: "connecting" as const }, refresh, subscribePublications };
  useEffect(() => {
    if (current.day.state !== "loaded" || nowIso === undefined) return;
    const pending = current.day.value.notifications
      .flatMap(row => row.kind === "notification" && row.state === "snoozed" && row.snoozedUntil !== undefined
        ? [{ key: `${row.notificationId}:${row.snoozedUntil}`, until: Date.parse(row.snoozedUntil) }] : [])
      .filter(entry => !firedExpiries.current.has(entry.key))
      .sort((a, b) => a.until - b.until)[0];
    if (pending === undefined) return;
    const timer = setTimeout(() => { firedExpiries.current.add(pending.key); refresh(); }, Math.max(0, pending.until - Date.parse(nowIso)));
    return () => clearTimeout(timer);
  }, [current.day, nowIso, refresh]);
  return current;
}
