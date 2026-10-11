import { randomBytes } from "node:crypto";
import { createServer, createConnection, type Socket } from "node:net";
import { resolve } from "node:path";
import { z } from "zod";
import { systemClock, machineMonotonicMs, type Clock } from "../../../rules/time/clock.js";
import { ProviderAdapterOutcomeSchema, ProviderRequestEnvelopeSchema, type ProviderAdapterOutcome } from "../../../models/providers/providers.js";
import type { ProviderAdapter, ProviderCallOptions } from "../../../workflow-kit/providers.js";
import { acquireRuntimeProcessLock, readRuntimeProcessLock, runtimeProcessLockIsActive, readGeocodeRuntimeFile, writeGeocodeRuntimeFileExclusive, removeOwnedGeocodeRuntimeFile, type GeocodeFileCustody } from "../../storage/sqlite/runtime-process-locks.js";

const MAX_MESSAGE_BYTES = 65_536;
const ChannelSchema = z.strictObject({ generation: z.number().int().positive(), acquisitionId: z.uuid(), port: z.number().int().min(1).max(65535), token: z.string().regex(/^[a-f0-9]{64}$/u) });
const RequestSchema = z.strictObject({ token: ChannelSchema.shape.token, requestId: z.uuid(), deadlineMs: z.number().positive(), request: ProviderRequestEnvelopeSchema });
const ReplySchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("completed"), outcome: ProviderAdapterOutcomeSchema }),
  z.strictObject({ state: z.literal("unavailable"), code: z.enum(["aborted", "timeout", "adapter-unavailable"]) }),
]);
type Reply = z.output<typeof ReplySchema>;

function unavailable(clock: Clock, code: "aborted" | "timeout" | "adapter-unavailable"): ProviderAdapterOutcome {
  const messages = { aborted: "Nominatim request was cancelled.", timeout: "Nominatim request deadline elapsed.", "adapter-unavailable": "Nominatim owner or channel is unavailable; the request was not retried." };
  return ProviderAdapterOutcomeSchema.parse({ response: { state: "unavailable", reason: { code, message: messages[code] } }, evidence: { summary: messages[code], capturedAt: clock.now().toISOString() } });
}

/** One authenticated request per connection; disconnect is cancellation, never replay. */
export function createNominatimService(input: Readonly<{
  processLockRoot: string;
  adapter: (fetchFn: typeof fetch) => ProviderAdapter<"geocode.nominatim">;
  fetchFn?: typeof fetch;
  clock?: Clock;
}>) {
  const root = resolve(input.processLockRoot);
  const clock = input.clock ?? systemClock;
  type Owner = Readonly<{ stop(): Promise<void> }>;
  let owned: Owner | undefined;
  let pendingOwnership: Promise<Owner> | undefined;
  let unreleasedFailure: Error | undefined;
  let stopping: Promise<void> | undefined;
  let stopped = false;
  const connections = new Set<Socket>();
  const clients = new Set<Socket>();

  async function own() {
    const lock = acquireRuntimeProcessLock({ processLockRoot: root, name: "geocode", pid: process.pid });
    const acquisitionId = z.uuid().parse(lock.acquisitionId);
    const channelName = `${lock.generation}-${acquisitionId}.channel.json`;
    let channelCustody: GeocodeFileCustody | undefined;
    const token = randomBytes(32).toString("hex");
    const queue: Array<() => Promise<void>> = [];
    const controllers = new Set<AbortController>();
    let draining = false;
    let closing = false;
    let nextStart = machineMonotonicMs() + 1000;
    let adapter: ProviderAdapter<"geocode.nominatim">;
    const drain = async () => {
      if (draining) return;
      draining = true;
      try { while (queue.length > 0) { const work = queue.shift(); if (work !== undefined) await work(); } }
      finally { draining = false; }
    };
    const server = createServer(socket => {
      connections.add(socket);
      socket.on("error", () => socket.destroy());
      let text = "";
      let received = false;
      const controller = new AbortController();
      controllers.add(controller);
      socket.once("close", () => { controller.abort(); controllers.delete(controller); connections.delete(socket); });
      socket.setTimeout(15_000, () => socket.destroy());
      socket.on("data", chunk => {
        if (received) { socket.destroy(); return; }
        text += chunk.toString("utf8");
        if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) { socket.destroy(); return; }
        if (!text.endsWith("\n")) return;
        received = true;
        let request: z.output<typeof RequestSchema>;
        try { request = RequestSchema.parse(JSON.parse(text)); }
        catch { socket.destroy(); return; }
        if (request.token !== token || request.request.capability !== "geocode.nominatim" || closing) { socket.destroy(); return; }
        socket.setTimeout(0);
        const deadline = request.deadlineMs;
        const remainingMs = deadline - machineMonotonicMs();
        if (remainingMs <= 0 || remainingMs > 2_147_483_647) { socket.end(`${JSON.stringify({ state: "unavailable", code: "timeout" })}\n`); return; }
        const timer = setTimeout(() => controller.abort(), remainingMs);
        const reply = (value: Reply) => { if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`); };
        const work = async () => {
          let wait: ReturnType<typeof setTimeout> | undefined;
          const wake = () => { if (wait !== undefined) clearTimeout(wait); };
          try {
            if (controller.signal.aborted || closing) { reply({ state: "unavailable", code: closing ? "adapter-unavailable" : "timeout" }); return; }
            while (nextStart > machineMonotonicMs() && !controller.signal.aborted && !closing) await new Promise<void>(done => {
              const abort = () => { wake(); done(); };
              controller.signal.addEventListener("abort", abort, { once: true });
              wait = setTimeout(() => { controller.signal.removeEventListener("abort", abort); done(); }, Math.ceil(nextStart - machineMonotonicMs()));
            });
            if (controller.signal.aborted || closing || machineMonotonicMs() >= deadline) { reply({ state: "unavailable", code: closing ? "adapter-unavailable" : "timeout" }); return; }
            const outcome = ProviderAdapterOutcomeSchema.parse(await adapter.invoke(request.request, { signal: controller.signal, deadlineMonotonicMs: deadline, requestId: request.requestId }));
            reply({ state: "completed", outcome });
          } catch { reply({ state: "unavailable", code: controller.signal.aborted ? "timeout" : "adapter-unavailable" }); }
          finally { wake(); clearTimeout(timer); controller.signal.removeEventListener("abort", cancelQueued); controllers.delete(controller); }
        };
        const cancelQueued = () => {
          const index = queue.indexOf(work);
          if (index < 0) return;
          queue.splice(index, 1);
          clearTimeout(timer);
          controllers.delete(controller);
          reply({ state: "unavailable", code: closing ? "adapter-unavailable" : "timeout" });
        };
        controller.signal.addEventListener("abort", cancelQueued, { once: true });
        queue.push(work);
        void drain();
      });
    });
    let ownerStopping: Promise<void> | undefined;
    const stopOwner = (): Promise<void> => ownerStopping ??= (async () => {
      closing = true;
      for (const controller of controllers) controller.abort();
      for (const socket of connections) socket.destroy();
      if (server.listening) await new Promise<void>((done, reject) => server.close(error => error === undefined ? done() : reject(error)));
      const closureDeadline = machineMonotonicMs() + 5000;
      while (draining) {
        if (machineMonotonicMs() >= closureDeadline) throw new Error("nominatim-owner-closure-unproven");
        await new Promise<void>(done => setTimeout(done, 1));
      }
      if (channelCustody !== undefined) {
        const record = ChannelSchema.parse(JSON.parse(readGeocodeRuntimeFile(root, channelName).text));
        if (record.generation !== lock.generation || record.acquisitionId !== acquisitionId || record.token !== token) throw new Error("nominatim-owner-channel-ownership-lost");
        removeOwnedGeocodeRuntimeFile(root, channelName, channelCustody);
      }
      lock.release();
    })();
    try {
      adapter = input.adapter((...args) => {
        try { return (input.fetchFn ?? fetch)(...args); }
        finally { nextStart = machineMonotonicMs() + 1000; }
      });
      await new Promise<void>((done, reject) => { server.once("error", reject); server.listen({ host: "127.0.0.1", port: 0 }, () => { server.removeListener("error", reject); done(); }); });
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("nominatim-owner-endpoint-unavailable");
      channelCustody = writeGeocodeRuntimeFileExclusive(root, channelName, `${JSON.stringify({ generation: lock.generation, acquisitionId, port: address.port, token })}\n`);
    } catch (error) {
      try { await stopOwner(); }
      catch (cleanupError) { unreleasedFailure = cleanupError instanceof Error ? cleanupError : new Error("nominatim-owner-cleanup-failed", { cause: cleanupError }); throw new AggregateError([error, cleanupError], "nominatim-owner-startup-closure-unproven", { cause: cleanupError }); }
      throw error;
    }
    return Object.freeze({ stop: stopOwner });
  }

  return Object.freeze({
    async invoke(requestInput: unknown, options: ProviderCallOptions): Promise<ProviderAdapterOutcome> {
      const request = ProviderRequestEnvelopeSchema.parse(requestInput);
      if (request.capability !== "geocode.nominatim") throw new Error("nominatim-capability-mismatch");
      if (stopped || options.signal.aborted) return unavailable(clock, stopped ? "adapter-unavailable" : "aborted");
      const remaining = () => options.deadlineMonotonicMs - clock.monotonicMs();
      if (remaining() <= 0) return unavailable(clock, "timeout");
      let channel: z.output<typeof ChannelSchema>;
      try {
        const record = readRuntimeProcessLock(root, "geocode");
        if (record === undefined || record.releasedAt !== null || !runtimeProcessLockIsActive(root, "geocode")) {
          if (unreleasedFailure !== undefined) return unavailable(clock, "adapter-unavailable");
          pendingOwnership ??= own();
          const attempt = pendingOwnership;
          try { owned = await attempt; }
          finally { if (pendingOwnership === attempt) pendingOwnership = undefined; }
        } else if (pendingOwnership !== undefined) owned = await pendingOwnership;
        const current = readRuntimeProcessLock(root, "geocode");
        if (current === undefined || current.releasedAt !== null || !("acquisitionId" in current)) return unavailable(clock, "adapter-unavailable");
        channel = ChannelSchema.parse(JSON.parse(readGeocodeRuntimeFile(root, `${current.generation}-${current.acquisitionId}.channel.json`).text));
        if (channel.generation !== current.generation || channel.acquisitionId !== current.acquisitionId) return unavailable(clock, "adapter-unavailable");
      } catch { return unavailable(clock, "adapter-unavailable"); }
      if (stopped || remaining() <= 0 || options.signal.aborted) return unavailable(clock, stopped ? "adapter-unavailable" : options.signal.aborted ? "aborted" : "timeout");
      return new Promise<ProviderAdapterOutcome>(done => {
        const socket = createConnection({ host: "127.0.0.1", port: channel.port });
        clients.add(socket);
        let text = "";
        let settled = false;
        const finish = (outcome: ProviderAdapterOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options.signal.removeEventListener("abort", abort);
          clients.delete(socket);
          socket.destroy();
          done(outcome);
        };
        const abort = () => finish(unavailable(clock, "aborted"));
        const timer = setTimeout(() => finish(unavailable(clock, "timeout")), remaining());
        options.signal.addEventListener("abort", abort, { once: true });
        socket.once("connect", () => {
          if (options.signal.aborted) { abort(); return; }
          socket.write(`${JSON.stringify({ token: channel.token, requestId: options.requestId, deadlineMs: machineMonotonicMs() + remaining(), request })}\n`);
        });
        socket.on("data", chunk => {
          text += chunk.toString("utf8");
          if (Buffer.byteLength(text) > MAX_MESSAGE_BYTES) { finish(unavailable(clock, "adapter-unavailable")); return; }
          if (!text.endsWith("\n")) return;
          try {
            const reply = ReplySchema.parse(JSON.parse(text));
            finish(reply.state === "completed" ? reply.outcome : unavailable(clock, reply.code));
          } catch { finish(unavailable(clock, "adapter-unavailable")); }
        });
        socket.once("error", () => finish(unavailable(clock, "adapter-unavailable")));
        socket.once("close", () => finish(unavailable(clock, "adapter-unavailable")));
      });
    },
    stop(): Promise<void> {
      return stopping ??= (async () => {
        stopped = true;
        for (const socket of clients) socket.destroy();
        if (pendingOwnership !== undefined) await pendingOwnership.then(owner => owner.stop(), () => {
          if (unreleasedFailure !== undefined) throw unreleasedFailure;
        });
        if (owned !== undefined) await owned.stop();
        if (unreleasedFailure !== undefined) throw unreleasedFailure;
      })();
    },
  });
}
