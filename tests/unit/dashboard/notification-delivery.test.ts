import { describe, expect, it } from "vitest";
import { createNotificationDelivery, type NotificationDeliveryPlatform } from "../../../src/dashboard/surfaces/notifications/notification-delivery.js";
import { NotificationWireSchema } from "../../../src/domain/dashboard/projection.js";
const row = (publication = "a", changes = {}) => NotificationWireSchema.parse({ kind: "notification", notificationId: "11111111-1111-4111-8111-111111111111", actorId: "local-operator", channel: "ping", count: "abcdef0".indexOf(publication) + 1, publicationId: publication.repeat(64), trigger: "failed", readState: "unread", severity: "error", title: "private text must not reach OS", state: "unread", occurredAt: "2026-09-14T17:00:00.000Z", revision: 1, ...changes });
function platform() {
  let permission: NotificationPermission = "default", throwNow = false;
  let onError: (() => void) | undefined;
  const sent: { title: string; silent: boolean }[] = [];
  const waiting: (() => void)[] = [];
  let held = false;
  const drain = () => { if (!held) waiting.shift()?.(); };
  const api: NotificationDeliveryPlatform = {
    baseline: async () => [row()],
    supported: () => true, permission: () => permission, requestPermission: async () => permission,
    hold: async (signal, work) => new Promise<void>((resolve, reject) => {
      const start = () => { if (signal.aborted) { reject(new Error("aborted")); drain(); return; } held = true; void work().then(() => { held = false; resolve(); drain(); }); };
      waiting.push(start); drain();
    }),
    show: (title, options, error) => { if (throwNow) throw new Error("private OS error"); sent.push({ title, silent: options.silent }); onError = error; },
  };
  return { api, sent, allow: (value: NotificationPermission) => { permission = value; }, throwing: () => { throwNow = true; }, error: () => onError?.() };
}
const flush = async () => { for (let n = 0; n < 5; n += 1) await Promise.resolve(); };
describe("desktop notification delivery", () => {
  it("delivers a newly committed pinned gap once and suppresses existing pins on enable", async () => {
    const pinned = (id: string) => NotificationWireSchema.parse({ kind: "backfill-gap", notificationId: id,
      actorId: "local-operator", channel: "ping", count: 1, publicationId: id.replaceAll("-", "").repeat(2),
      severity: "error", title: "Notification history is incomplete", state: "pinned", occurredAt: "2026-09-14T17:00:00.000Z" });
    const old = pinned("22222222-2222-4222-8222-222222222222"), fresh = pinned("33333333-3333-4333-8333-333333333333");
    const p = platform(); p.allow("granted");
    const c = createNotificationDelivery({ ...p.api, baseline: async () => [old] }, () => {});
    c.update([old], true); await c.enable(); await flush(); c.update([old], true);
    expect(p.sent).toEqual([]);
    c.update([old, fresh], true); c.update([old, fresh], true);
    expect(p.sent).toEqual([{ title: "Notification history is incomplete", silent: true }]); c.close();
  });
  it("requires a gesture, ignores baselines/reload/reconnect and state edits, and never toasts Inbox or snoozed rows", async () => {
    const p = platform(), statuses: string[] = [];
    const c = createNotificationDelivery(p.api, status => statuses.push(status));
    c.update([row()], true); expect(p.sent).toEqual([]);
    await c.enable(); expect(statuses.at(-1)).toBe("permission-default");
    p.allow("granted"); await c.enable(); await flush();
    c.update([row()], true); c.update([row("a", { readState: "read", revision: 2 })], true); expect(p.sent).toEqual([]);
    c.update([row("b")], true); expect(p.sent).toEqual([{ title: "Run failed", silent: true }]);
    c.update([row("b")], true); c.update([row("c", { channel: "inbox" })], true); c.update([row("d", { state: "snoozed" })], true); expect(p.sent).toHaveLength(1);
    c.update([row("e")], false); c.update([row("f")], true); expect(p.sent).toHaveLength(1);
    c.update([row("0")], true); expect(p.sent).toHaveLength(2);
    c.close();
  });
  it("allows one owner across tabs and baselines after ownership transfers", async () => {
    const p = platform(); p.allow("granted");
    const a = createNotificationDelivery(p.api, () => {}), b = createNotificationDelivery(p.api, () => {});
    a.update([row()], true); b.update([row()], true); await a.enable(); await b.enable(); await flush();
    a.update([row("b")], true); b.update([row("b")], true); expect(p.sent).toHaveLength(1);
    a.close(); await flush(); b.update([row("b")], true); expect(p.sent).toHaveLength(1);
    b.update([row("c")], true); expect(p.sent).toHaveLength(2); b.close();
  });
  it("reports denial, unsupported APIs, synchronous failures and asynchronous errors", async () => {
    const p = platform(), states: string[] = [], c = createNotificationDelivery(p.api, state => states.push(state));
    p.allow("denied"); await c.enable(); expect(states.at(-1)).toBe("permission-denied");
    p.allow("granted"); c.update([row()], true); await c.enable(); await flush();
    c.update([row("b")], true); p.error(); expect(states.at(-1)).toBe("delivery-failed");
    p.throwing(); c.update([row("c")], true); expect(states.at(-1)).toBe("delivery-failed"); c.close();
    const unavailable = createNotificationDelivery({ ...p.api, supported: () => false }, state => states.push(state));
    await unavailable.enable(); expect(states.at(-1)).toBe("unsupported"); unavailable.close();
  });
});
