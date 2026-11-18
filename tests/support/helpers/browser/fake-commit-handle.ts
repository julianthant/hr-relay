import { once } from "node:events";

export async function waitForFixturePageClose(event: "close", options: { signal: AbortSignal; timeout: number }): Promise<void> {
  const signal = options.timeout > 0 ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout)]) : options.signal;
  await once(new EventTarget(), event, { signal });
}

// Fake pages use synchronous trusted input. The headless integration tests exercise Chromium's input queue.
export function fakeCommitHandle(click: () => Promise<void>) {
  const view = Object.assign(new EventTarget(), { setTimeout, clearTimeout });
  const element = { ownerDocument: { defaultView: view } };
  return {
    evaluate: async <T>(read: (node: typeof element) => T) => read(element),
    evaluateHandle: async <T, A>(create: (node: typeof element, arg: A) => T, arg: A) => {
      const value = create(element, arg);
      return { evaluate: async <R>(read: (state: T) => R) => read(value), dispose: async () => {} };
    },
    async click({ signal }: { signal: AbortSignal }) {
      signal.throwIfAborted();
      const event = new Event("click", { cancelable: true });
      Object.defineProperties(event, {
        isTrusted: { value: true },
        composedPath: { value: () => [element, view] },
      });
      if (view.dispatchEvent(event)) await click();
    },
    dispose: async () => {},
  };
}
