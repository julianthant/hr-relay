import { describe,expect,it } from "vitest";
import { createNotificationObserver } from "../../../../src/backend/runs/notifications/observation.js";
describe("canonical notification producers", () => {
  it("serializes reads, exposes publication failure, retries and drains shutdown", async () => {
    let release: (() => void) | undefined; let reads = 0; let fail = true;
    const observer = createNotificationObserver({ read: () => { reads += 1; return { observations: [], diagnostics: [] }; }, health: async () => { await new Promise<void>(resolve => { release = resolve; }); if (fail) throw new Error("private diagnostic"); }, inbox: { publish: async () => { throw new Error("unused"); } } });
    const first = observer.observe(); expect(observer.observe()).toBe(first); expect(reads).toBe(1); release?.(); await first;
    expect(observer.status()).toEqual({ state: "failed", code: "NOTIFICATION_OBSERVATION_FAILED", pending: 1 });
    fail = false; const next = observer.observe(); let stopped = false; const stop = observer.stop().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false); release?.(); await next; await stop; expect(stopped).toBe(true);
    await observer.observe(); expect(reads).toBe(2);
  });
});
