import type { NotificationWire } from "../../../models/dashboard/projection.js";

export type FeedbackPolicy =
  | { state: "admitted"; toast: "danger" | "warning" | "success"; panel: true; target: "failure" | "run" | "storage" | "none"; trigger: "failed" | "repeating" | "verified-done" | "gate-waiting" | "write-parked" | "storage" | "backfill-gap" }
  | { state: "unresolved" }
  | { state: "provenance-unavailable" };

export function notificationFeedbackPolicy(kind: string | undefined): FeedbackPolicy {
  if (kind === undefined) return { state: "provenance-unavailable" };
  if (kind === "run-failed" || kind === "subject-mismatch") return { state: "admitted", toast: "danger", panel: true, target: "failure", trigger: "failed" };
  if (kind === "repeating-failure") return { state: "admitted", toast: "warning", panel: true, target: "failure", trigger: "repeating" };
  if (kind === "verified-done") return { state: "admitted", toast: "success", panel: true, target: "run", trigger: "verified-done" };
  if (kind === "gate-opened") return { state: "admitted", toast: "warning", panel: true, target: "run", trigger: "gate-waiting" };
  if (kind === "write-parked") return { state: "admitted", toast: "danger", panel: true, target: "run", trigger: "write-parked" };
  if (kind === "storage-degraded") return { state: "admitted", toast: "warning", panel: true, target: "storage", trigger: "storage" };
  if (kind === "backfill-gap") return { state: "admitted", toast: "danger", panel: true, target: "none", trigger: "backfill-gap" };
  throw new Error(`NOTIFICATION_FEEDBACK_KIND_UNREGISTERED: ${kind}`);
}

export type NotificationToastCandidate = NotificationWire;

export function notificationRowsForActor(rows: readonly NotificationWire[], actorId: string): readonly NotificationWire[] {
  return rows.filter(row => row.actorId === actorId);
}

export function createNotificationToastFeed() {
  const seen = new Map<string, string>();
  let connected = false;
  return {
    reset() { seen.clear(); connected = false; },
    update(rows: readonly NotificationWire[], live: boolean): NotificationToastCandidate[] {
      const baseline = !connected || !live;
      connected = live;
      const next: NotificationToastCandidate[] = [];
      for (const row of rows) {
        const prior = seen.get(row.notificationId);
        seen.set(row.notificationId, row.publicationId);
        if (baseline || prior === row.publicationId) continue;
        const policy = notificationFeedbackPolicy(row.sourceEvent?.state === "available" ? row.sourceEvent.kind : undefined);
        if (policy.state !== "admitted" || row.state === "snoozed") continue;
        if (row.kind === "backfill-gap") {
          if (policy.trigger !== "backfill-gap" || policy.target !== "none") throw new Error("NOTIFICATION_FEEDBACK_TARGET_MISMATCH");
        } else if (row.trigger !== policy.trigger || row.link?.kind !== policy.target) throw new Error("NOTIFICATION_FEEDBACK_TARGET_MISMATCH");
        next.push(row);
      }
      return next;
    },
  };
}

export function notificationToastPresentation(row: NotificationToastCandidate): { title: string; description: string; tone: "danger" | "warning" | "success"; action?: "Open failure" | "Open run" | "Open Storage" } {
  if (row.sourceEvent?.state !== "available") throw new Error("NOTIFICATION_FEEDBACK_PROVENANCE_UNAVAILABLE");
  const policy = notificationFeedbackPolicy(row.sourceEvent.kind);
  if (policy.state !== "admitted") throw new Error("NOTIFICATION_FEEDBACK_POLICY_UNRESOLVED");
  if (row.kind === "backfill-gap") {
    if (row.sourceEvent.kind !== "backfill-gap") throw new Error("NOTIFICATION_FEEDBACK_TARGET_MISMATCH");
    return { tone: "danger", title: "Notification history is incomplete", description: "Resnapshot and reconcile the affected work." };
  }
  const context = row.context;
  const workflow = context.state === "available" || context.state === "workflow-only" ? context.workflow : undefined;
  const action = policy.target === "failure" ? "Open failure" : policy.target === "run" ? "Open run" : "Open Storage";
  if (row.sourceEvent.kind === "subject-mismatch") return {
    tone: policy.toast, action,
    title: "Subject mismatch",
    description: workflow === undefined ? "A subject mismatch was detected." : `${workflow} · A subject mismatch was detected.`,
  };
  if (row.sourceEvent.kind === "run-failed") return { tone: policy.toast, action, title: "Run failed", description: context.state === "available" ? `${context.workflow} · ${context.subject}`
    : workflow ?? "A run failed." };
  if (row.sourceEvent.kind === "repeating-failure") return { tone: policy.toast, action, title: "Repeating failure", description: workflow === undefined ? "A failure pattern repeated." : `${workflow} · A failure pattern repeated.` };
  if (row.sourceEvent.kind === "verified-done") return { tone: policy.toast, action, title: "Verified completion", description: workflow === undefined ? "A run completed with verified evidence." : `${workflow} · A run completed with verified evidence.` };
  if (row.sourceEvent.kind === "gate-opened") return { tone: policy.toast, action, title: "Needs you", description: workflow === undefined ? "A run needs operator attention." : `${workflow} · A run needs operator attention.` };
  if (row.sourceEvent.kind === "write-parked") return { tone: policy.toast, action, title: "Write parked", description: workflow === undefined ? "A write is parked for review." : `${workflow} · A write is parked for review.` };
  if (row.sourceEvent.kind === "storage-degraded") return { tone: policy.toast, action, title: "Storage needs attention", description: "Storage needs attention." };
  throw new Error(`NOTIFICATION_FEEDBACK_KIND_UNREGISTERED: ${row.sourceEvent.kind}`);
}
