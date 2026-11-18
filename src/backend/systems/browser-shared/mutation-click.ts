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

async function guardedClick(capability: MutationCapability, control: Control, timeout?: number): Promise<void> {
  // The browser samples first, so transport time can only shorten the original probe window.
  const sampledAt = await control.evaluate(() => new Event("click").timeStamp);
  if (!Number.isFinite(sampledAt)) throw new Error("commit control has no valid browser timestamp");
  // Round toward the earlier millisecond on the browser's coarsened timestamp.
  const expiresAt = Math.floor(sampledAt) + remainingMutationProbeMs(capability) - 1;
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
      await control.click({ timeout, signal: cancel.signal });
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
  const control = await target.elementHandle({ timeout, signal: AbortSignal.timeout(remaining) });
  try {
    await guardedClick(capability, control, timeout);
  } finally {
    await control.dispose();
  }
}
