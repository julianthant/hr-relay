import type { NotificationInbox } from "./inbox.js";
import type { NotificationTriggerEvent } from "../../../rules/notifications/notification-triggers.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

export type NotificationObservation = Readonly<{ event: NotificationTriggerEvent; source: { identity: string; occurredAt: string } }>;
export type NotificationSourceRead = Readonly<{ observations: readonly NotificationObservation[]; diagnostics: readonly "NOTIFICATION_RECEIPT_MISSING"[] }>;
export type NotificationObservationStatus = Readonly<{ state: "ready" | "failed" | "stopped"; code?: "NOTIFICATION_OBSERVATION_FAILED" | "NOTIFICATION_RECEIPT_MISSING"; pending: number }>;

/** Publications and health inspections each have a single owner; slow health reads do not delay new occurrences. */
export function createNotificationObserver(deps: {
  inbox: Pick<NotificationInbox, "publish">;
  read(): NotificationSourceRead;
  health(): Promise<void>;
}) {
  let stopped = false, drained = false;
  let healthFailure: NotificationObservationStatus["code"];
  let running: Promise<void> | undefined, publishing: Promise<void> | undefined;
  let sourceStatus: NotificationObservationStatus = { state: "ready", pending: 0 };
  const pending = new Map<string, NotificationObservation>();

  const observeSources = (changed?: () => boolean): Promise<void> | undefined => {
    if (stopped || publishing !== undefined) return publishing;
    let failures = 0;
    let code: NotificationObservationStatus["code"];
    try {
      if (changed !== undefined && !changed() && sourceStatus.state !== "failed") return;
      const read = deps.read();
      failures = read.diagnostics.length;
      code = read.diagnostics[0];
      for (const item of read.observations) {
        const prior = pending.get(item.source.identity);
        if (prior !== undefined && canonicalJsonStringify(prior.event) !== canonicalJsonStringify(item.event)) throw new Error("NOTIFICATION_PENDING_SOURCE_CONFLICT");
        pending.set(item.source.identity, prior ?? item);
      }
    } catch { failures += 1; code = "NOTIFICATION_OBSERVATION_FAILED"; }
    const settle = () => {
      sourceStatus = failures === 0 ? { state: "ready", pending: 0 }
        : { state: "failed", code: code ?? "NOTIFICATION_OBSERVATION_FAILED", pending: failures };
    };
    if (pending.size === 0) { settle(); return; }
    sourceStatus = { state: "ready", pending: pending.size };
    publishing = (async () => {
      for (const [identity, item] of pending) {
        try { await deps.inbox.publish(item.event, item.source); pending.delete(identity); }
        catch { failures += 1; code = "NOTIFICATION_OBSERVATION_FAILED"; }
      }
      settle();
    })().finally(() => { publishing = undefined; });
    return publishing;
  };
  const observe = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running !== undefined) return running;
    running = (async () => {
      const publications = observeSources();
      if (publications !== undefined) await publications;
      try { await deps.health(); healthFailure = undefined; } catch { healthFailure = "NOTIFICATION_OBSERVATION_FAILED"; }
    })().finally(() => { running = undefined; });
    return running;
  };
  const status = (): NotificationObservationStatus => {
    if (healthFailure !== undefined) return { state: "failed", code: healthFailure, pending: sourceStatus.pending + 1 };
    return drained && sourceStatus.state !== "failed" ? { state: "stopped", pending: 0 } : sourceStatus;
  };
  return Object.freeze({ observe, observeSources, status, async stop() {
    stopped = true;
    await Promise.all([running, publishing]);
    drained = true;
  } });
}
