import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { it } from "vitest";
import { createDuoBrowserFocus } from "../../../../src/backend/runtime/browser/native-browser-focus.js";

it.each([150, Infinity])("uses monotonic time to await macOS focus (focus at %s ms)", async focusAtMs => {
  let elapsedSeconds = 0;
  const app = { unhide: true, activateWithOptions: () => undefined };
  const focus = createDuoBrowserFocus(250, "darwin", async (_file, args, budgetMs) => {
    const script = args[3];
    assert.ok(script);
    assert.equal(budgetMs, 250);
    const result: unknown = runInNewContext(`${script}\nrun(argv)`, {
      argv: args.slice(4),
      Date: { now() { throw new Error("focus-polled-wall-clock"); } },
      ObjC: { import: () => undefined },
      $: {
        NSRunningApplication: { runningApplicationWithProcessIdentifier: () => app },
        NSProcessInfo: { processInfo: { get systemUptime() { return elapsedSeconds; } } },
        NSWorkspace: { sharedWorkspace: { get frontmostApplication() {
          return { processIdentifier: elapsedSeconds * 1000 >= focusAtMs ? 123 : 456 };
        } } },
        NSRunLoop: { currentRunLoop: { runUntilDate(seconds: number) { elapsedSeconds += seconds; } } },
        NSDate: { dateWithTimeIntervalSinceNow: (seconds: number) => seconds },
      },
    }, { timeout: 500 });
    assert.equal(typeof result, "string");
    return result;
  });

  const activation = focus.returnToRelay({ platform: "darwin", processId: 123 });
  if (focusAtMs === Infinity) {
    await assert.rejects(activation, /duo-browser-focus-refused/u);
    assert.equal(elapsedSeconds, 0.2);
  } else {
    await activation;
    assert.ok(elapsedSeconds < 0.2);
  }
});
