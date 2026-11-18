import type { ElementHandle, Locator } from "playwright";
import type { MutationCapability } from "../../../models/ui/driver.js";
import { remainingMutationProbeMs } from "../../../workflow-kit/mutation-capability.js";

type Control = ElementHandle<HTMLElement | SVGElement>;
type Dispatch = "accepted" | "expired" | "unobserved";

function guardCommit(control: Element, expiresAt: number) {
  const view = control.ownerDocument.defaultView;
  if (!view) throw new Error("commit control has no active window");
  const verdict = Promise.withResolvers<Dispatch>();
  const listen = new AbortController();
  const now = () => new Event("click").timeStamp;
  let pending = true;
  function expire() {
    pending = false;
    verdict.resolve("expired");
  }
  const timer = view.setTimeout(expire, Math.max(0, expiresAt - now()));
  view.addEventListener("click", event => {
    if (!event.composedPath().includes(control)) return;
    // Sample at dispatch. The input event itself may have spent time in the renderer queue.
    if (pending && !(now() < expiresAt)) expire();
    if (pending && event.isTrusted) {
      pending = false;
      view.clearTimeout(timer);
      verdict.resolve("accepted");
    } else {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { capture: true, signal: listen.signal });
  return {
    verdict: verdict.promise,
    stop() { listen.abort(); view.clearTimeout(timer); verdict.resolve("unobserved"); },
  };
}

async function guardedClick(
  capability: MutationCapability, control: Control, timeout?: number, actionSignal?: AbortSignal,
): Promise<void> {
  actionSignal?.throwIfAborted();
  // The browser samples first, so transport time can only shorten the original probe window.
  const sampledAt = await control.evaluate(() => new Event("click").timeStamp);
  if (!Number.isFinite(sampledAt)) throw new Error("commit control has no valid browser timestamp");
  // Round toward the earlier millisecond on the browser's coarsened timestamp.
  const expiresAt = Math.floor(sampledAt) + remainingMutationProbeMs(capability) - 1;
  actionSignal?.throwIfAborted();
  const guard = await control.evaluateHandle(guardCommit, expiresAt);
  const cancel = new AbortController();
  let dispatch: Dispatch | undefined;
  // Observe in the original document before starting input. A timely click retains Playwright's navigation wait.
  const verdict = guard.evaluate(state => state.verdict).then(result => {
    dispatch = result;
    if (result === "expired") cancel.abort();
  }, (error: unknown) => { cancel.abort(); throw error; });
  async function click() {
    try {
      remainingMutationProbeMs(capability);
      const signal = actionSignal ? AbortSignal.any([actionSignal, cancel.signal]) : cancel.signal;
      signal.throwIfAborted();
      await control.click({ timeout, signal });
    } finally {
      try {
        await guard.evaluate(state => state.stop());
      } catch (error) {
        // A confirmed click may have replaced the document that owned the listener.
        if (dispatch !== "accepted" || !(error instanceof Error)
          || !/Execution context was destroyed|Cannot find context with specified id/u.test(error.message)) throw error;
      }
    }
  }
  try {
    const [action, observation] = await Promise.allSettled([click(), verdict]);
    if (observation.status === "rejected") throw observation.reason;
    if (dispatch === "expired") throw new Error("probe deadline expired before the commit click was dispatched");
    if (action.status === "rejected") throw action.reason;
    if (dispatch !== "accepted") throw new Error("commit click dispatch was not observed");
  } finally {
    await guard.dispose();
  }
}

export async function clickWithMutationCapability(
  capability: MutationCapability,
  target: Locator | Control,
  timeout?: number,
): Promise<void> {
  const remaining = remainingMutationProbeMs(capability);
  if (!("elementHandle" in target)) return guardedClick(capability, target, timeout);
  // The page applies its effective action timeout (including context defaults) once for the whole operation.
  const finished = new AbortController();
  const lifetime = target.page().waitForEvent("close", { timeout, signal: finished.signal }).then(() => {
    throw new Error("page closed during the commit click");
  });
  const click = async () => {
    const signal = AbortSignal.any([finished.signal, AbortSignal.timeout(remaining)]);
    const control = await target.elementHandle({ timeout: 0, signal });
    try {
      await guardedClick(capability, control, 0, finished.signal);
    } finally {
      await control.dispose();
    }
  };
  const operation = click();
  try {
    await Promise.race([lifetime, operation]);
  } finally {
    finished.abort();
    // The first failure stays primary. Fenced custody ends only after the input and its handles have drained.
    await Promise.allSettled([operation, lifetime]);
  }
}
