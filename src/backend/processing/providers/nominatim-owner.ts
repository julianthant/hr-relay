import type { ChildProcess } from "node:child_process";
import { z } from "zod";
import { systemClock, machineMonotonicMs, type Clock } from "../../../rules/time/clock.js";
import { ProviderAdapterOutcomeSchema, ProviderRequestEnvelopeSchema, type ProviderAdapterOutcome } from "../../../models/providers/providers.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import type { ProviderAdapter, ProviderCallOptions } from "../../../workflow-kit/providers.js";

const RequestSchema = z.strictObject({ kind: z.literal("nominatim-request"), requestId: z.uuid(), deadlineMs: z.number().positive(), request: ProviderRequestEnvelopeSchema });
const CancelSchema = z.strictObject({ kind: z.literal("nominatim-cancel"), requestId: z.uuid() });
const ReplySchema = z.strictObject({ kind: z.literal("nominatim-reply"), requestId: z.uuid(), outcome: ProviderAdapterOutcomeSchema });

/** Today's geocode-owner lifecycle. Pacing, abort and the worker adapter's one-way flag are not this state. */
export type NominatimOwnerPhase = "running" | "stopping" | "stopped" | "stop-failed";
export type NominatimOwnerEvent = "request" | "attach" | "stop" | "drained" | "drain-timeout";
type NominatimOwnerEffect = "queued" | "attached" | "stopping" | "same-promise" | "resolved" | "same-rejection" | "stopped" | "stop-failed";
type NominatimOwnerRefusal = "not-stopping" | "adapter-unavailable" | "channel-unavailable";
export type NominatimOwnerTransition = { readonly effect: NominatimOwnerEffect } | { readonly refused: NominatimOwnerRefusal };
type OwnerState = { phase: "running" } | { phase: "stopping"; done: Promise<void> } | { phase: "stopped" } | { phase: "stop-failed"; error: Error };

const NOT_STOPPING = { refused: "not-stopping" } as const;
const UNAVAILABLE = { refused: "adapter-unavailable" } as const;
const CHANNEL = { refused: "channel-unavailable" } as const;
const NOMINATIM_OWNER_TRANSITIONS = deepFreeze({
  running: { request: { effect: "queued" }, attach: { effect: "attached" }, stop: { effect: "stopping" }, drained: NOT_STOPPING, "drain-timeout": NOT_STOPPING },
  stopping: { request: UNAVAILABLE, attach: CHANNEL, stop: { effect: "same-promise" }, drained: { effect: "stopped" }, "drain-timeout": { effect: "stop-failed" } },
  stopped: { request: UNAVAILABLE, attach: CHANNEL, stop: { effect: "resolved" }, drained: NOT_STOPPING, "drain-timeout": NOT_STOPPING },
  "stop-failed": { request: UNAVAILABLE, attach: CHANNEL, stop: { effect: "same-rejection" }, drained: NOT_STOPPING, "drain-timeout": NOT_STOPPING },
} as const satisfies Record<NominatimOwnerPhase, Record<NominatimOwnerEvent, NominatimOwnerTransition>>);

export function transitionNominatimOwner(phase: NominatimOwnerPhase, event: NominatimOwnerEvent): NominatimOwnerTransition {
  return NOMINATIM_OWNER_TRANSITIONS[phase][event];
}

function unavailable(clock: Clock, code: "aborted" | "timeout" | "adapter-unavailable"): ProviderAdapterOutcome {
  const messages = { aborted: "Nominatim request was cancelled.", timeout: "Nominatim request deadline elapsed.", "adapter-unavailable": "Nominatim parent is unavailable; the request was not retried." };
  return ProviderAdapterOutcomeSchema.parse({ response: { state: "unavailable", reason: { code, message: messages[code] } }, evidence: { summary: messages[code], capturedAt: clock.now().toISOString() } });
}

/** The pipe router's registration port; the router itself lives in the worker runtime. */
type IpcFamilyRegistry = Readonly<{ register(family: string, handler: (message: Readonly<{ kind: string }>, handle: unknown) => void): void }>;

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
  let state: OwnerState = { phase: "running" };
  let closure: Promise<void> | undefined;
  let adapter: ProviderAdapter<"geocode.nominatim"> | undefined;
  const ownerCell = (event: NominatimOwnerEvent): NominatimOwnerTransition => transitionNominatimOwner(state.phase, event);
  const requestUnavailable = (): boolean => { const cell = ownerCell("request"); return "refused" in cell && cell.refused === "adapter-unavailable"; };

  async function invoke(requestInput: unknown, options: ProviderCallOptions): Promise<ProviderAdapterOutcome> {
    const request = ProviderRequestEnvelopeSchema.parse(requestInput);
    if (request.capability !== "geocode.nominatim") throw new Error("nominatim-capability-mismatch");
    if (requestUnavailable() || options.signal.aborted) return unavailable(clock, requestUnavailable() ? "adapter-unavailable" : "aborted");
    const remaining = options.deadlineMonotonicMs - clock.monotonicMs();
    if (remaining <= 0 || remaining > 2_147_483_647) return unavailable(clock, "timeout");
    const controller = new AbortController();
    controllers.add(controller);
    const abort = () => controller.abort();
    options.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, remaining);
    const cancelled = () => unavailable(clock, requestUnavailable() ? "adapter-unavailable" : options.signal.aborted ? "aborted" : "timeout");
    const work = tail.then(async () => {
      if (controller.signal.aborted || requestUnavailable()) return cancelled();
      nextStart ??= machineMonotonicMs() + 1000;
      const waitMs = nextStart - machineMonotonicMs();
      if (waitMs > 0) await new Promise<void>(done => {
        const wake = () => { clearTimeout(wait); done(); };
        const wait = setTimeout(() => { controller.signal.removeEventListener("abort", wake); done(); }, Math.ceil(waitMs));
        controller.signal.addEventListener("abort", wake, { once: true });
      });
      if (controller.signal.aborted || requestUnavailable() || clock.monotonicMs() >= options.deadlineMonotonicMs) return cancelled();
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

  /** The child pipe's router owns the `message` listener; this family answers `nominatim-request` and `nominatim-cancel`. */
  function attach(child: ChildProcess, router: IpcFamilyRegistry): void {
    const attached = ownerCell("attach");
    if (("refused" in attached && attached.refused === "channel-unavailable") || !child.connected) throw new Error("nominatim-parent-channel-unavailable");
    const requests = new Map<string, AbortController>();
    const receive = (value: unknown) => {
      const cancellation = CancelSchema.safeParse(value);
      if (cancellation.success) { requests.get(cancellation.data.requestId)?.abort(); return; }
      const parsed = RequestSchema.safeParse(value);
      if (!parsed.success || parsed.data.request.capability !== "geocode.nominatim" || requests.has(parsed.data.requestId)) { disconnect(); return; }
      const message = parsed.data;
      const controller = new AbortController();
      requests.set(message.requestId, controller);
      void invoke(message.request, { requestId: message.requestId, signal: controller.signal,
        deadlineMonotonicMs: clock.monotonicMs() + message.deadlineMs - machineMonotonicMs() }).then(outcome => {
        if (child.connected && !controller.signal.aborted) child.send({ kind: "nominatim-reply", requestId: message.requestId, outcome }, () => {});
      }).finally(() => requests.delete(message.requestId));
    };
    const disconnect = () => {
      child.removeListener("disconnect", disconnect);
      child.removeListener("exit", disconnect);
      for (const controller of requests.values()) controller.abort();
      requests.clear();
      detachments.delete(disconnect);
    };
    router.register("nominatim-", receive);
    child.once("disconnect", disconnect);
    child.once("exit", disconnect);
    detachments.add(disconnect);
  }

  return Object.freeze({ invoke, attach,
    stop(): Promise<void> {
      const cell = ownerCell("stop");
      if (closure !== undefined && "effect" in cell && (cell.effect === "same-promise" || cell.effect === "resolved" || cell.effect === "same-rejection")) return closure;
      if (!("effect" in cell) || cell.effect !== "stopping") throw new Error("nominatim-owner-not-stopping");
      state = { phase: "stopping", done: Promise.resolve() };
      const done = (async () => {
        for (const controller of controllers) controller.abort();
        const deadline = machineMonotonicMs() + 5000;
        let drained = false;
        void tail.then(() => { drained = true; });
        while (!drained) {
          if (machineMonotonicMs() >= deadline) {
            const timeout = ownerCell("drain-timeout");
            if (!("effect" in timeout) || timeout.effect !== "stop-failed") throw new Error("nominatim-owner-not-stopping");
            const error = new Error("nominatim-owner-closure-unproven");
            state = { phase: "stop-failed", error };
            throw error;
          }
          await new Promise<void>(finish => setTimeout(finish, 1));
        }
        const drainedCell = ownerCell("drained");
        if (!("effect" in drainedCell) || drainedCell.effect !== "stopped") throw new Error("nominatim-owner-not-stopping");
        state = { phase: "stopped" };
        for (const detach of detachments) detach();
      })();
      closure = done;
      if (state.phase === "stopping") state = { phase: "stopping", done };
      return done;
    },
  });
}

export function createNominatimWorkerAdapter(clock: Clock = systemClock) {
  const pending = new Map<string, (outcome: ProviderAdapterOutcome) => void>();
  let stopped = false;
  let routed = false;
  const disconnect = () => { stopped = true; for (const finish of [...pending.values()]) finish(unavailable(clock, "adapter-unavailable")); };
  const receive = (value: unknown) => {
    const reply = ReplySchema.safeParse(value);
    if (reply.success) pending.get(reply.data.requestId)?.(reply.data.outcome); else disconnect();
  };
  let listening = false;
  return Object.freeze({ capability: "geocode.nominatim" as const,
    /** Registers the reply family on the child's router; without it every request is unavailable. */
    attach(router: IpcFamilyRegistry): void { router.register("nominatim-", receive); routed = true; },
    async invoke(requestInput: unknown, options: ProviderCallOptions): Promise<ProviderAdapterOutcome> {
      const request = ProviderRequestEnvelopeSchema.parse(requestInput);
      if (request.capability !== "geocode.nominatim") throw new Error("nominatim-capability-mismatch");
      if (stopped || !routed || !process.connected || process.send === undefined) return unavailable(clock, "adapter-unavailable");
      if (!listening) { process.once("disconnect", disconnect); listening = true; }
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
      process.removeListener("disconnect", disconnect);
    },
  });
}
