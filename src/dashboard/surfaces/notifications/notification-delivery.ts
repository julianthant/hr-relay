import { notificationTitle, type NotificationWire } from "../../../domain/dashboard/projection.js";

export type NotificationDeliveryState = "off" | "requesting" | "permission-default" | "permission-denied" | "unsupported" | "standby" | "active" | "delivery-failed";
export interface NotificationDeliveryPlatform {
  baseline(): Promise<readonly NotificationWire[]>;
  supported(): boolean;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  hold(signal: AbortSignal, work: () => Promise<void>): Promise<void>;
  show(title: string, options: { silent: boolean; tag: string }, onError: () => void): void;
}
/** Session-local suppression only. Durable rows and source identities stay on the server. */
export function createNotificationDelivery(platform: NotificationDeliveryPlatform, changed: (state: NotificationDeliveryState) => void) {
  let rows: readonly NotificationWire[] = [], connected = false, owner = false, baseline = true, closed = false, requesting = false;
  let release: (() => void) | undefined, lock: AbortController | undefined;
  const seen = new Map<string, number>();
  const remember = () => { for (const row of rows) seen.set(row.notificationId, Math.max(seen.get(row.notificationId) ?? 0, row.count)); };
  return {
    update(next: readonly NotificationWire[], live: boolean) {
      rows = next;
      if (!live || !connected || !owner || baseline) { remember(); baseline = !live; connected = live; return; }
      connected = live;
      for (const row of rows) {
        const prior = seen.get(row.notificationId) ?? 0;
        seen.set(row.notificationId, Math.max(prior, row.count));
        if (row.count <= prior || row.channel !== "ping" || row.state === "snoozed") continue;
        if (platform.permission() !== "granted") { changed(platform.permission() === "denied" ? "permission-denied" : "permission-default"); continue; }
        try {
          platform.show(notificationTitle(row.kind === "backfill-gap" ? "backfill-gap" : row.trigger), { silent: true, tag: row.publicationId }, () => { if (!closed) changed("delivery-failed"); });
        } catch { changed("delivery-failed"); }
      }
    },
    async enable() {
      if (closed || requesting || lock !== undefined) return;
      if (!platform.supported()) { changed("unsupported"); return; }
      requesting = true; changed("requesting");
      try {
        const permission = platform.permission() === "granted" ? "granted" : await platform.requestPermission();
        if (closed) return;
        if (permission !== "granted") { changed(permission === "denied" ? "permission-denied" : "permission-default"); return; }
        lock = new AbortController(); changed("standby");
        void platform.hold(lock.signal, async () => {
          if (closed) return;
          const current = await platform.baseline();
          if (closed) return;
          for (const row of current) seen.set(row.notificationId, Math.max(seen.get(row.notificationId) ?? 0, row.count));
          owner = true; baseline = false; changed("active");
          await new Promise<void>(resolve => { release = resolve; });
          owner = false;
        }).catch(() => { if (!closed) { lock = undefined; owner = false; changed("delivery-failed"); } });
      } catch { if (!closed) changed("delivery-failed"); }
      finally { requesting = false; }
    },
    close() { closed = true; owner = false; lock?.abort(); release?.(); },
  };
}
export function browserNotificationPlatform(readBaseline: () => Promise<readonly NotificationWire[]>): NotificationDeliveryPlatform {
  return {
    baseline: readBaseline,
    supported: () => globalThis.isSecureContext && "Notification" in globalThis && navigator.locks !== undefined,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    hold: async (signal, work) => { await navigator.locks.request("hrauto:notification-delivery:v1", { signal }, work); },
    show: (title, options, error) => { const notification = new Notification(title, options); notification.onerror = error; },
  };
}
