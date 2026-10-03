import type { NotificationWire } from "../../../models/dashboard/projection.js";

export type FeedbackPolicy =
  | { state: "admitted"; toast: "danger"; panel: true }
  | { state: "unresolved" }
  | { state: "provenance-unavailable" };

const DECLARED_UNSET = new Set([
  "subject-mismatch", "repeating-failure", "gate-opened", "write-parked", "storage-degraded", "verified-done", "backfill-gap",
]);

export function notificationFeedbackPolicy(kind: string | undefined): FeedbackPolicy {
  if (kind === undefined) return { state: "provenance-unavailable" };
  if (kind === "run-failed") return { state: "admitted", toast: "danger", panel: true };
  if (DECLARED_UNSET.has(kind)) return { state: "unresolved" };
  throw new Error(`NOTIFICATION_FEEDBACK_KIND_UNREGISTERED: ${kind}`);
}

export type FailureToastCandidate = Extract<NotificationWire, { kind: "notification" }>;

export function createFailureToastFeed() {
  const seen = new Map<string, string>();
  let connected = false;
  return {
    reset() { seen.clear(); connected = false; },
    update(rows: readonly NotificationWire[], live: boolean): FailureToastCandidate[] {
      const baseline = !connected || !live;
      connected = live;
      const next: FailureToastCandidate[] = [];
      for (const row of rows) {
        const prior = seen.get(row.notificationId);
        seen.set(row.notificationId, row.publicationId);
        if (baseline || prior === row.publicationId || row.kind !== "notification") continue;
        const policy = notificationFeedbackPolicy(row.sourceEvent?.state === "available" ? row.sourceEvent.kind : undefined);
        if (policy.state === "admitted" && row.trigger === "failed" && row.link?.kind === "failure" && row.state !== "snoozed") next.push(row);
      }
      return next;
    },
  };
}

export function failedRunToastDescription(row: FailureToastCandidate): string {
  const context = row.context;
  if (context.state === "available") return `${context.workflow} · ${context.subject}`;
  if (context.state === "workflow-only") return context.workflow;
  return "A run failed.";
}
