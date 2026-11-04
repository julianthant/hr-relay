import assert from "node:assert/strict";
import type { BrowserContext } from "playwright";
import { it } from "vitest";
import { createDuoBrowserFocus, DuoBrowserFocusError, type FocusCommandRunner } from "../../../../src/backend/runtime/browser/native-browser-focus.js";

function browser(processes = [{ type: "browser", id: 421321 }], errors: { send?: Error; detach?: Error } = {}) {
  const calls: string[] = [];
  const context = { browser: () => ({ newBrowserCDPSession: async () => ({
    async send(method: string) { calls.push(method); if (errors.send) throw errors.send; return { processInfo: processes }; },
    async detach() { calls.push("detach"); if (errors.detach) throw errors.detach; },
  }) }) } as unknown as BrowserContext;
  return { context, calls };
}

it("activates the owned macOS browser process on each show and returns to the captured Relay app", async () => {
  const calls: { file: string; args: readonly string[]; timeoutMs: number }[] = [];
  const run: FocusCommandRunner = async (file, args, timeoutMs) => {
    calls.push({ file, args, timeoutMs });
    return calls.length === 1 ? JSON.stringify({ processId: 71 }) : "focused\n";
  };
  const focus = createDuoBrowserFocus(5000, "darwin", run), owned = browser();
  const relay = await focus.captureRelay(); assert.ok(relay);
  assert.deepEqual(relay, { platform: "darwin", processId: 71 });
  await focus.show(owned.context); await focus.show(owned.context); await focus.returnToRelay(relay);
  assert.deepEqual(calls.map(call => call.file), Array(4).fill("/usr/bin/osascript"));
  assert.deepEqual(calls.slice(1).map(call => call.args.at(-1)), ["421321", "421321", "71"]);
  assert.ok(calls.every(call => call.timeoutMs === 5000));
  assert.deepEqual(owned.calls, ["SystemInfo.getProcessInfo", "detach", "SystemInfo.getProcessInfo", "detach"]);
});

it("foregrounds the owned Windows process and preserves the original Relay window for return", async () => {
  const calls: { file: string; args: readonly string[] }[] = [];
  const run: FocusCommandRunner = async (file, args) => {
    calls.push({ file, args });
    return calls.length === 1 ? JSON.stringify({ processId: 72, windowHandle: "8192" }) : "focused\r\n";
  };
  const focus = createDuoBrowserFocus(5000, "win32", run), owned = browser();
  const relay = await focus.captureRelay(); assert.ok(relay);
  assert.deepEqual(relay, { platform: "win32", processId: 72, windowHandle: "8192" });
  await focus.show(owned.context); await focus.returnToRelay(relay);
  assert.ok(calls.every(call => call.file === "powershell.exe"));
  assert.match(calls[1].args[3], /\$relayProcessId = 421321/u);
  assert.match(calls[2].args[3], /\$relayProcessId = 72/u);
  assert.ok(calls[2].args[3].includes("[IntPtr]::new([long]'8192')"));
  assert.deepEqual(owned.calls, ["SystemInfo.getProcessInfo", "detach"]);
});

for (const processes of [[], [{ type: "browser", id: 1 }, { type: "browser", id: 2 }], [{ type: "browser", id: -1 }]]) {
  it(`refuses missing, ambiguous or invalid browser ownership: ${JSON.stringify(processes)}`, async () => {
    const owned = browser(processes);
    let activations = 0;
    const focus = createDuoBrowserFocus(5000, "darwin", async () => { activations++; return "focused"; });
    await assert.rejects(focus.show(owned.context));
    assert.equal(activations, 0);
    assert.deepEqual(owned.calls, ["SystemInfo.getProcessInfo", "detach"]);
  });
}

it("retains both an observation failure and its CDP cleanup failure without activating an app", async () => {
  const send = new Error("synthetic process observation failed"), detach = new Error("synthetic CDP detach failed");
  const owned = browser(undefined, { send, detach });
  const focus = createDuoBrowserFocus(5000, "darwin", async () => { throw new Error("must not activate after observation failure"); });
  await assert.rejects(focus.show(owned.context), error => error instanceof AggregateError
    && error.errors.length === 2 && error.errors[0] === send && error.errors[1] === detach && error.cause === detach);
});

it("rejects an OS refusal instead of reporting successful foreground activation", async () => {
  const owned = browser(), focus = createDuoBrowserFocus(5000, "win32", async () => "blocked");
  await assert.rejects(focus.show(owned.context), DuoBrowserFocusError);
});

it("keeps Linux development focus in the browser without calling desktop OS commands", async () => {
  const owned = browser(), focus = createDuoBrowserFocus(5000, "linux", async () => { throw new Error("unexpected desktop command"); });
  assert.equal(await focus.captureRelay(), undefined); await focus.show(owned.context);
  assert.deepEqual(owned.calls, []);
  await assert.rejects(focus.returnToRelay({ platform: "darwin", processId: 71 }), DuoBrowserFocusError);
});
