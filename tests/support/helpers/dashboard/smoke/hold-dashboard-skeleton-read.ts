import type { Page } from "@playwright/test";

export const SKELETON_READ_HOLD_MS = 2_500;

type Read = { pathname: string; query?: Record<string, string> } | { day: string } | { run: string } | { fileName: string };

type HeldRead = {
  timing: { requestedAt?: number; withheldAt?: number; windowStartedAt?: number; releasedAt?: number };
  startWindow(): void;
};

declare global {
  interface Window { relayColdSettingsHold?: HeldRead }
}

const EDITABLE_SETTINGS = "/api/v1/settings/editable";

export function holdDashboardSkeletonRead(page: Page, target: Read) {
  return page.evaluateHandle(installReadHold, { target, delayMs: SKELETON_READ_HOLD_MS });
}

export async function openWithColdSettingsHold(page: Page, origin: string, open: () => Promise<void>) {
  await page.addInitScript(installReadHold, { target: { pathname: EDITABLE_SETTINGS }, delayMs: SKELETON_READ_HOLD_MS, coldOrigin: origin });
  await open();
  return page.evaluateHandle(() => {
    if (window.relayColdSettingsHold === undefined) throw new Error("Cold Settings hold was not installed before boot");
    return window.relayColdSettingsHold;
  });
}

function installReadHold({ target, delayMs, coldOrigin }: { target: Read; delayMs: number; coldOrigin?: string }): HeldRead {
  const gate = Promise.withResolvers<void>();
  const read: HeldRead = { timing: {}, startWindow: () => gate.resolve() };
  if (coldOrigin === undefined) read.startWindow();
  else {
    if (location.origin !== coldOrigin || window !== window.top) return read;
    window.relayColdSettingsHold = read;
  }
  const { timing } = read;
  let matched = false;
  let releaseRead: Promise<void> | undefined;
  const hold = async () => {
    timing.withheldAt = performance.now();
    await gate.promise;
    timing.windowStartedAt = performance.now();
    const until = timing.windowStartedAt + delayMs;
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
    return read;
  }

  const fetchFromServer = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const topics = url.searchParams.get("topics") ?? "";
    const matches = "day" in target
      ? url.pathname === "/events/v1" && topics === `dashboard-day:${target.day}`
      : "run" in target
        ? url.pathname === "/events/v1" && topics.endsWith(`,run:${target.run}`)
        : url.pathname === target.pathname
        && Object.entries(target.query ?? {}).every(([key, value]) => url.searchParams.get(key) === value);
    if (!matches || method !== "GET" || url.origin !== location.origin || (matched && coldOrigin === undefined)) {
      return fetchFromServer(input, init);
    }
    matched = true;
    timing.requestedAt ??= performance.now();
    const serverRead = fetchFromServer(input, init);
    if ("pathname" in target) {
      // A second boot read of editable Settings must not warm the editor behind the first hold.
      releaseRead ??= serverRead.then(hold);
      const [response] = await Promise.all([serverRead, releaseRead]);
      return response;
    }

    const response = await serverRead;
    if (!response.ok || response.body === null || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
      throw new Error("Expected a seeded dashboard-day event stream");
    }
    // Forward the greeting and delay only the first envelope that carries the held read. The stream stays open.
    let pending = "";
    const body = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new TransformStream<string, string>({
      async transform(chunk, controller) {
        pending += chunk;
        let boundary = pending.indexOf("\n\n");
        while (boundary !== -1) {
          const event = pending.slice(0, boundary + 2);
          pending = pending.slice(boundary + 2);
          if (timing.withheldAt === undefined && carriesHeldRead(event, target)) await hold();
          controller.enqueue(event);
          boundary = pending.indexOf("\n\n");
        }
      },
    })).pipeThrough(new TextEncoderStream());
    return new Response(body, { headers: response.headers, status: response.status });
  };
  return read;
}

/** A day hold delays the first snapshot; a run hold delays the first envelope that carries the run's panel row. */
function carriesHeldRead(event: string, target: { day: string } | { run: string }): boolean {
  if ("day" in target) return /^data: \{"type":"snapshot"[,}]/mu.test(event);
  const data = event.split("\n").filter(line => line.startsWith("data: ")).map(line => line.slice(6)).join("\n");
  const envelope = JSON.parse(data) as { rows?: readonly unknown[] };
  return Array.isArray(envelope.rows) && envelope.rows.length > 0;
}
