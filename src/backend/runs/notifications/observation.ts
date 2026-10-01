import type { NotificationInbox } from "./inbox.js";
import type { NotificationTriggerEvent } from "../../../domain/notification-triggers.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";

export type NotificationObservation = Readonly<{ event: NotificationTriggerEvent; source: { identity: string; occurredAt: string } }>;
export type NotificationSourceRead = Readonly<{ observations: readonly NotificationObservation[]; diagnostics: readonly "NOTIFICATION_RECEIPT_MISSING"[] }>;
export type NotificationObservationStatus = Readonly<{ state: "ready" | "failed" | "stopped"; code?: "NOTIFICATION_OBSERVATION_FAILED" | "NOTIFICATION_RECEIPT_MISSING"; pending: number }>;

/** One owned observation at a time. Failed facts remain retryable at the next read. */
export function createNotificationObserver(deps: {
  inbox: Pick<NotificationInbox, "publish">;
  read(): NotificationSourceRead;
  health(): Promise<void>;
}) {
  let stopped = false;
  let running: Promise<void> | undefined;
  let status: NotificationObservationStatus = { state: "ready", pending: 0 };
  const pending = new Map<string, NotificationObservation>();
  const observe = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running !== undefined) return running;
    running = (async () => {
      let failures = 0;
      let code: NotificationObservationStatus["code"];
      try {
        const read = deps.read();
        failures += read.diagnostics.length;
        code = read.diagnostics[0];
        for (const item of read.observations) {
          const prior = pending.get(item.source.identity);
          if (prior !== undefined && canonicalJsonStringify(prior.event) !== canonicalJsonStringify(item.event)) throw new Error("NOTIFICATION_PENDING_SOURCE_CONFLICT");
          pending.set(item.source.identity, prior ?? item);
        }
      } catch { failures += 1; code = "NOTIFICATION_OBSERVATION_FAILED"; }
      status = { state: "ready", pending: pending.size };
      for (const [identity, item] of pending) {
        try { await deps.inbox.publish(item.event, item.source); pending.delete(identity); }
        catch { failures += 1; code = "NOTIFICATION_OBSERVATION_FAILED"; }
      }
      try { await deps.health(); } catch { failures += 1; code = "NOTIFICATION_OBSERVATION_FAILED"; }
      // Only closed diagnostics leave this boundary; exceptions may contain private archive data.
      status = failures === 0 ? { state: "ready", pending: 0 }
        : { state: "failed", code: code ?? "NOTIFICATION_OBSERVATION_FAILED", pending: failures };
    })().finally(() => { running = undefined; });
    return running;
  };
  return Object.freeze({ observe, status: () => status, async stop() { stopped = true; await running; if (status.state !== "failed") status = { state: "stopped", pending: 0 }; } });
}
