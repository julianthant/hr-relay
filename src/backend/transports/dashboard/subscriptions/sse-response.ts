/**
 * The ONE bridge from a hub connection to an SSE response body (ref
 * frontend-backend-integration §3.5). It is a `pull()` source on purpose: the
 * Web Stream asks for the next envelope only when its consumer — the Node
 * adapter, which honours `res.write()` backpressure — has taken the previous
 * one, so demand flows from the socket to the hub's single bounded queue and
 * a slow browser is answered with the hub's loud `reset-required`, never with
 * an unbounded buffer here or a silently dropped envelope.
 *
 * Lifecycle: `cancel()` (client disconnect, adapter cancellation, server
 * shutdown) closes the connection exactly once; a hub close resolves the
 * outstanding pull with `undefined`, which ends the body cleanly.
 */
import type { DashboardStreamEnvelope } from "../../../../domain/dashboard/subscription.js";
import type { DashboardStreamConnection } from "./dashboard-stream.js";

/** One envelope as an SSE event: the cursor rides as the event id so `Last-Event-ID` resumes it. */
export function sseSerialize(envelope: DashboardStreamEnvelope): string {
  const id = "cursor" in envelope ? `id: ${envelope.cursor}\n` : "";
  return `${id}data: ${JSON.stringify(envelope)}\n\n`;
}

export function dashboardEventStreamBody(connection: DashboardStreamConnection): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const encode = (envelope: DashboardStreamEnvelope): Uint8Array => encoder.encode(sseSerialize(envelope));
  let closed = false;
  /** Closes the connection once; answers whether THIS call did it. */
  const closeOnce = (): boolean => {
    if (closed) return false;
    closed = true;
    connection.close();
    return true;
  };
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      for (const envelope of connection.initial) controller.enqueue(encode(envelope));
    },
    async pull(controller): Promise<void> {
      let envelope: DashboardStreamEnvelope | undefined;
      try {
        envelope = await connection.next();
      } catch (error: unknown) {
        // An errored stream is never cancel()ed by the machinery, so the
        // connection must be released here or the subscriber leaks in the hub.
        closeOnce();
        controller.error(error);
        return;
      }
      if (envelope === undefined) {
        // A cancel() that raced this pull already closed the stream; closing
        // the controller again would throw into the stream machinery.
        if (closeOnce()) controller.close();
        return;
      }
      controller.enqueue(encode(envelope));
    },
    cancel(): void {
      closeOnce();
    },
  });
}
