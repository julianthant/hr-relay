import type { Page } from "@playwright/test";

export const SKELETON_READ_HOLD_MS = 2_500;

type Read = { pathname: string; query?: Record<string, string> } | { day: string } | { fileName: string };

export function holdDashboardSkeletonRead(page: Page, target: Read) {
  return page.evaluateHandle(({ target, delayMs }) => {
    const timing: { requestedAt?: number; withheldAt?: number; releasedAt?: number } = {};
    let matched = false;
    const hold = async () => {
      timing.withheldAt = performance.now();
      const until = timing.withheldAt + delayMs;
      while (performance.now() < until) {
        await new Promise<void>(resolve => window.setTimeout(resolve, Math.ceil(until - performance.now())));
      }
      timing.releasedAt = performance.now();
    };

    if ("fileName" in target) {
      File.prototype.arrayBuffer = async function (this: File) {
        if (matched || this.name !== target.fileName) return Blob.prototype.arrayBuffer.call(this);
        matched = true;
        timing.requestedAt = performance.now();
        const bytes = await Blob.prototype.arrayBuffer.call(this);
        await hold();
        return bytes;
      };
      return timing;
    }

    const fetchFromServer = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      const matches = "day" in target
        ? url.pathname === "/events/v1" && url.searchParams.get("topics") === `dashboard-day:${target.day}`
        : url.pathname === target.pathname
          && Object.entries(target.query ?? {}).every(([key, value]) => url.searchParams.get(key) === value);
      if (matched || !matches || method !== "GET" || url.origin !== location.origin) return fetchFromServer(input, init);
      matched = true;
      timing.requestedAt = performance.now();
      const response = await fetchFromServer(input, init);
      if ("pathname" in target) {
        await hold();
        return response;
      }

      if (!response.ok || response.body === null || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
        throw new Error("Expected a seeded dashboard-day event stream");
      }
      // Forward the greeting and delay only the first snapshot. The stream stays open.
      let pending = "";
      const body = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, string>({
        async transform(chunk, controller) {
          pending += chunk;
          let boundary = pending.indexOf("\n\n");
          while (boundary !== -1) {
            const event = pending.slice(0, boundary + 2);
            pending = pending.slice(boundary + 2);
            if (timing.withheldAt === undefined && /^data: \{"type":"snapshot"[,}]/mu.test(event)) await hold();
            controller.enqueue(event);
            boundary = pending.indexOf("\n\n");
          }
        },
      })).pipeThrough(new TextEncoderStream());
      return new Response(body, { headers: response.headers, status: response.status });
    };
    return timing;
  }, { target, delayMs: SKELETON_READ_HOLD_MS });
}
