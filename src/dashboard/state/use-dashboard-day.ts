/** The selected day's server state, and nothing else.
 * One subscription per day (ref frontend-backend-integration: one global stream, not a connection */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NotificationArrival } from "../../models/dashboard/subscription.js";
import type { DashboardDayWire } from "../../models/dashboard/projection.js";
import { createRowStore, type RowStore, type SubscriptionState } from "../client/index.js";
import { protocolError } from "../client/errors.js";
import { createKeptResults, dropKeptResults, failed, loaded, loadingWith, type AsyncResource } from "./async-resource.js";
import { useDashboardClient } from "./client-context.js";
import { noteRunData } from "./run-data-changes.js";

export interface DashboardDayState {
  readonly request: object;
  /** A new object each time this request's stream opens again after a reset; a read under an older one is pre-reset. */
  readonly stream?: object;
  readonly day: AsyncResource<DashboardDayWire>;
  readonly connection: SubscriptionState;
  /** The whole read-model values the stream carries for the open run. */
  readonly rows: RowStore;
  readonly subscribePublications: (listener: (arrival: NotificationArrival) => void) => () => void;
  readonly refresh: () => void;
}

/** How many days' last frames a page keeps for an instant return. */
export const KEPT_DAYS_LIMIT = 8;
const keptDays = createKeptResults<DashboardDayWire>(KEPT_DAYS_LIMIT);

/** The last frame this page kept for the day under this authority, if any. */
export function keptDayFrame(client: object, authorityEpoch: object | undefined, actorId: string | undefined, day: string): DashboardDayWire | undefined {
  return keptDays.get(client, [authorityEpoch, actorId], day)?.value;
}

/** `run` is the run whose panel rides the stream; changing it reopens the stream once and keeps the day. */
export function useDashboardDay(day: string | undefined, authorityEpoch?: object, actorId?: string, run?: string): DashboardDayState {
  const client = useDashboardClient();
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  // A new object per request, including A → B → A; the render guard runs before effects. The kept frame is
  // read here, during render, so the frame that switches the day already shows that day's kept copy.
  const request = useMemo(() => {
    const listeners = new Set<(arrival: NotificationArrival) => void>();
    const kept = day === undefined ? undefined : keptDays.get(client, [authorityEpoch, actorId], day);
    return { rows: createRowStore(), client, day, revision, authorityEpoch, actorId, kept,
      subscribePublications: (listener: (arrival: NotificationArrival) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
      publishPublication: (arrival: NotificationArrival) => { for (const listener of listeners) listener(arrival); },
    };
  }, [client, day, revision, authorityEpoch, actorId]);
  const activeRequest = useRef(request);
  activeRequest.current = request;
  const subscribePublications = request.subscribePublications;
  const rows = request.rows;
  const selectedRun = useRef(run);
  selectedRun.current = run;
  const subscriptionRef = useRef<{ select: (run: string | undefined) => void } | undefined>(undefined);
  const [result, setResult] = useState<{ request: typeof request; value: DashboardDayState }>();
  useEffect(() => {
    let active = true;
    let shown = request.kept;
    let stream = {};
    let value: DashboardDayState = { request, stream, day: loadingWith(shown), connection: { state: "connecting" }, rows, refresh, subscribePublications };
    // Whether this stream has served a frame or reported itself up; connecting again after either is a reset.
    let opened = false;
    const owns = (): boolean => active && activeRequest.current === request;
    const publish = (): void => { if (active) setResult({ request, value }); };
    publish();
    if (day === undefined) return () => { active = false; };
    let subscription: { close: () => void } | undefined;
    // Subscribe once the mount has settled: a mount cancelled in the same tick opens no stream.
    queueMicrotask(() => { if (!active) return; subscription = subscriptionRef.current = client.subscribeDay({
      day, rows, ...(selectedRun.current === undefined ? {} : { run: selectedRun.current }),
      ...(actorId === undefined ? {} : { publications: { actorId, onPublication: (arrival: NotificationArrival) => {
        if (!active || activeRequest.current !== request) return;
        request.publishPublication(arrival);
      } } }),
      onDay: (next, cursor = next.snapshotCursor) => {
        if (!active) return;
        if (next.day !== day) {
          const error = protocolError("day-request-identity-mismatch");
          value = { request, stream, day: failed(error), connection: { state: "stopped", error }, rows, refresh, subscribePublications };
        } else {
          opened = true;
          // A superseded stream can still deliver between the next render and this effect's cleanup; it keeps nothing.
          if (owns()) { keptDays.keep(client, [authorityEpoch, actorId], day, { value: next, at: cursor }); noteRunData(client, next); }
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
          ? failed(connection.error) : connection.state === "connecting" ? loadingWith(shown) : value.day, connection, rows, refresh, subscribePublications };
        publish();
      },
    }); });
    return () => { active = false; subscription?.close(); subscriptionRef.current = undefined; };
  }, [client, day, actorId, authorityEpoch, request, refresh, subscribePublications, rows]);
  useEffect(() => { subscriptionRef.current?.select(run); }, [run]);
  const current = result?.request === request ? result.value : { request, day: loadingWith(request.kept), connection: { state: "connecting" as const }, rows, refresh, subscribePublications };
  return current;
}
