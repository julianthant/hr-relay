// Use a pull source so socket demand controls delivery; pushing would bypass backpressure.
import type { DashboardStreamEnvelope } from "../../../../models/dashboard/subscription.js";
import type { DashboardStreamConnection } from "./dashboard-stream.js";
import type { CompositeConnection } from "./run-logs-stream.js";
import type { CompositeStreamEnvelope } from "../../../../models/dashboard/run-logs-subscription.js";

/** One envelope as an SSE event: the cursor rides as the event id so `Last-Event-ID` resumes it. */
export function sseSerialize(envelope: DashboardStreamEnvelope): string {
  const id = "cursor" in envelope ? `id: ${envelope.cursor}\n` : "";
  return `${id}data: ${JSON.stringify(envelope)}\n\n`;
}

function streamBody<T>(connection: Readonly<{ initial: readonly T[]; next(): Promise<T | undefined>; close(): void }>,
  serialize: (envelope: T, initial: boolean, finalInitial: boolean) => string,
  lifecycle?: (phase: "started" | "settled" | "failed" | "reset", durationMs: number) => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const encode = (envelope: T, initial: boolean, finalInitial: boolean): Uint8Array => {
    if ((envelope as { type?: string }).type === "reset-required") reset = true;
    return encoder.encode(serialize(envelope, initial, finalInitial));
  };
  let closed = false;
  let reset = false;
  const started = performance.now();
  lifecycle?.("started", 0);
  /** Closes the connection once; answers whether THIS call did it. */
  const closeOnce = (failed = false): boolean => {
    if (closed) return false;
    closed = true;
    connection.close();
    lifecycle?.(failed ? "failed" : reset ? "reset" : "settled", performance.now() - started);
    return true;
  };
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const [index, envelope] of connection.initial.entries()) {
        controller.enqueue(encode(envelope, true, index === connection.initial.length - 1));
      }
    },
    async pull(controller): Promise<void> {
      let envelope: T | undefined;
      try {
        envelope = await connection.next();
      } catch (error: unknown) {
        // An errored stream is never cancel()ed by the machinery, so the
        // connection must be released here or the subscriber leaks in the hub.
        closeOnce(true);
        controller.error(error);
        return;
      }
      if (envelope === undefined) {
        // A cancel() that raced this pull already closed the stream; closing
        // the controller again would throw into the stream machinery.
        if (closeOnce()) controller.close();
        return;
      }
      controller.enqueue(encode(envelope, false, false));
    },
    cancel(): void {
      closeOnce();
    },
  });
}

export function dashboardEventStreamBody(connection: DashboardStreamConnection, lifecycle?: Parameters<typeof streamBody>[2]): ReadableStream<Uint8Array> {
  return streamBody(connection, sseSerialize, lifecycle);
}

export function compositeEventStreamBody(connection: CompositeConnection, lifecycle?: Parameters<typeof streamBody>[2]): ReadableStream<Uint8Array> {
  return streamBody(connection, (envelope: CompositeStreamEnvelope, initial, finalInitial) => {
    const resumeEligible = envelope.source === "control" && envelope.type === "reset-required" ? false
      : !initial || (finalInitial && envelope.source === "control"
        && envelope.type === "health" && envelope.state === "live");
    return `${resumeEligible ? `id: ${envelope.transportCursor}\n` : ""}data: ${JSON.stringify(envelope)}\n\n`;
  }, lifecycle);
}
