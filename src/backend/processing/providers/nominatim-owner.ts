import type { ChildProcess } from "node:child_process";
import { z } from "zod";
import { systemClock, machineMonotonicMs, type Clock } from "../../../rules/time/clock.js";
import { ProviderAdapterOutcomeSchema, ProviderRequestEnvelopeSchema, type ProviderAdapterOutcome } from "../../../models/providers/providers.js";
import type { ProviderAdapter, ProviderCallOptions } from "../../../workflow-kit/providers.js";

const RequestSchema = z.strictObject({ kind: z.literal("nominatim-request"), requestId: z.uuid(), deadlineMs: z.number().positive(), request: ProviderRequestEnvelopeSchema });
const CancelSchema = z.strictObject({ kind: z.literal("nominatim-cancel"), requestId: z.uuid() });
const ReplySchema = z.strictObject({ kind: z.literal("nominatim-reply"), requestId: z.uuid(), outcome: ProviderAdapterOutcomeSchema });

function unavailable(clock: Clock, code: "aborted" | "timeout" | "adapter-unavailable"): ProviderAdapterOutcome {
  const messages = { aborted: "Nominatim request was cancelled.", timeout: "Nominatim request deadline elapsed.", "adapter-unavailable": "Nominatim parent is unavailable; the request was not retried." };
  return ProviderAdapterOutcomeSchema.parse({ response: { state: "unavailable", reason: { code, message: messages[code] } }, evidence: { summary: messages[code], capturedAt: clock.now().toISOString() } });
}

export function createNominatimService(input: Readonly<{
  adapter: (fetchFn: typeof fetch) => ProviderAdapter<"geocode.nominatim">;
  fetchFn?: typeof fetch;
  clock?: Clock;
}>) {
  const clock = input.clock ?? systemClock;
  const controllers = new Set<AbortController>();
  const detachments = new Set<() => void>();
  let nextStart: number | undefined;
  let tail = Promise.resolve();
  let stopped = false;
  let stopping: Promise<void> | undefined;
  let adapter: ProviderAdapter<"geocode.nominatim"> | undefined;

  async function invoke(requestInput: unknown, options: ProviderCallOptions): Promise<ProviderAdapterOutcome> {
    const request = ProviderRequestEnvelopeSchema.parse(requestInput);
    if (request.capability !== "geocode.nominatim") throw new Error("nominatim-capability-mismatch");
    if (stopped || options.signal.aborted) return unavailable(clock, stopped ? "adapter-unavailable" : "aborted");
    const remaining = options.deadlineMonotonicMs - clock.monotonicMs();
    if (remaining <= 0 || remaining > 2_147_483_647) return unavailable(clock, "timeout");
    const controller = new AbortController();
    controllers.add(controller);
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, remaining);
    const cancelled = () => unavailable(clock, stopped ? "adapter-unavailable" : options.signal.aborted ? "aborted" : "timeout");
    const work = tail.then(async () => {
      if (controller.signal.aborted || stopped) return cancelled();
      nextStart ??= machineMonotonicMs() + 1000;
      const waitMs = nextStart - machineMonotonicMs();
      if (waitMs > 0) await new Promise<void>(done => {
        const wake = () => { clearTimeout(wait); done(); };
        const wait = setTimeout(() => { controller.signal.removeEventListener("abort", wake); done(); }, Math.ceil(waitMs));
        controller.signal.addEventListener("abort", wake, { once: true });
      });
      if (controller.signal.aborted || stopped || clock.monotonicMs() >= options.deadlineMonotonicMs) return cancelled();
      try {
        adapter ??= input.adapter((...args) => {
          try { return (input.fetchFn ?? fetch)(...args); }
          finally { nextStart = machineMonotonicMs() + 1000; }
        });
        return ProviderAdapterOutcomeSchema.parse(await adapter.invoke(request, { ...options, signal: controller.signal }));
      } catch { return unavailable(clock, controller.signal.aborted ? (options.signal.aborted ? "aborted" : "timeout") : "adapter-unavailable"); }
    });
    // The queue retains unfinished fetches even when their callers have cancelled.
    tail = work.then(() => {}, () => {});
    try {
      return await new Promise<ProviderAdapterOutcome>((done, reject) => {
        const cancel = () => done(cancelled());
        controller.signal.addEventListener("abort", cancel, { once: true });
        void work.then(done, reject).finally(() => controller.signal.removeEventListener("abort", cancel));
        if (controller.signal.aborted) cancel();
      });
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      void work.finally(() => controllers.delete(controller));
    }
  }

  function attach(child: ChildProcess): void {
    if (stopped || !child.connected) throw new Error("nominatim-parent-channel-unavailable");
    const requests = new Map<string, AbortController>();
    const receive = (value: unknown) => {
      const cancellation = CancelSchema.safeParse(value);
      if (cancellation.success) { requests.get(cancellation.data.requestId)?.abort(); return; }
      const parsed = RequestSchema.safeParse(value);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.request.capability !== "geocode.nominatim" || requests.has(message.requestId)) { disconnect(); return; }
      const controller = new AbortController();
      requests.set(message.requestId, controller);
      void invoke(message.request, { requestId: message.requestId, signal: controller.signal,
        deadlineMonotonicMs: clock.monotonicMs() + message.deadlineMs - machineMonotonicMs() }).then(outcome => {
        if (child.connected && !controller.signal.aborted) child.send({ kind: "nominatim-reply", requestId: message.requestId, outcome }, () => {});
      }).finally(() => requests.delete(message.requestId));
    };
    const disconnect = () => {
      child.removeListener("message", receive);
      child.removeListener("disconnect", disconnect);
      child.removeListener("exit", disconnect);
      for (const controller of requests.values()) controller.abort();
      requests.clear();
      detachments.delete(disconnect);
    };
    child.on("message", receive);
    child.once("disconnect", disconnect);
    child.once("exit", disconnect);
    detachments.add(disconnect);
  }

  return Object.freeze({ invoke, attach,
    stop(): Promise<void> {
      return stopping ??= (async () => {
        stopped = true;
        for (const controller of controllers) controller.abort();
        const deadline = machineMonotonicMs() + 5000;
        let drained = false;
        void tail.then(() => { drained = true; });
        while (!drained) {
          if (machineMonotonicMs() >= deadline) throw new Error("nominatim-owner-closure-unproven");
          await new Promise<void>(done => setTimeout(done, 1));
        }
        for (const detach of detachments) detach();
      })();
    },
  });
}

export function createNominatimWorkerAdapter(clock: Clock = systemClock) {
  const pending = new Map<string, (outcome: ProviderAdapterOutcome) => void>();
  let stopped = false;
  const disconnect = () => { stopped = true; for (const finish of [...pending.values()]) finish(unavailable(clock, "adapter-unavailable")); };
  const receive = (value: unknown) => {
    const reply = ReplySchema.safeParse(value);
    if (reply.success) pending.get(reply.data.requestId)?.(reply.data.outcome);
  };
  let listening = false;
  return Object.freeze({ capability: "geocode.nominatim" as const,
    async invoke(requestInput: unknown, options: ProviderCallOptions): Promise<ProviderAdapterOutcome> {
      const request = ProviderRequestEnvelopeSchema.parse(requestInput);
      if (request.capability !== "geocode.nominatim") throw new Error("nominatim-capability-mismatch");
      if (stopped || !process.connected || process.send === undefined) return unavailable(clock, "adapter-unavailable");
      if (!listening) { process.on("message", receive); process.once("disconnect", disconnect); listening = true; }
      if (options.signal.aborted) return unavailable(clock, "aborted");
      const remaining = options.deadlineMonotonicMs - clock.monotonicMs();
      if (remaining <= 0 || remaining > 2_147_483_647) return unavailable(clock, "timeout");
      if (pending.has(options.requestId)) throw new Error("nominatim-request-already-pending");
      return new Promise<ProviderAdapterOutcome>(done => {
        const cancel = (code: "aborted" | "timeout") => {
          if (process.connected) process.send?.({ kind: "nominatim-cancel", requestId: options.requestId }, () => {});
          finish(unavailable(clock, code));
        };
        const abort = () => cancel("aborted");
        const timer = setTimeout(() => cancel("timeout"), remaining);
        const finish = (outcome: ProviderAdapterOutcome) => {
          if (!pending.delete(options.requestId)) return;
          clearTimeout(timer);
          options.signal.removeEventListener("abort", abort);
          done(outcome);
        };
        pending.set(options.requestId, finish);
        options.signal.addEventListener("abort", abort, { once: true });
        process.send?.({ kind: "nominatim-request", requestId: options.requestId, deadlineMs: machineMonotonicMs() + remaining, request }, error => {
          if (error !== null) finish(unavailable(clock, "adapter-unavailable"));
        });
        if (options.signal.aborted) abort();
      });
    },
    async stop(): Promise<void> {
      for (const requestId of pending.keys()) if (process.connected) process.send?.({ kind: "nominatim-cancel", requestId }, () => {});
      disconnect();
      process.removeListener("message", receive);
      process.removeListener("disconnect", disconnect);
    },
  });
}
