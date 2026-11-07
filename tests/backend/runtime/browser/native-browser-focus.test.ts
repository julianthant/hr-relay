import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import type { BrowserContext, Page } from "playwright";
import { it } from "vitest";
import { createDuoBrowserFocus, DuoBrowserFocusError, type FocusCommandRunner } from "../../../../src/backend/runtime/browser/native-browser-focus.js";

function browser(processes = [{ type: "browser", id: 421321 }], errors: { send?: Error; detach?: Error } = {}) {
  const calls: string[] = [];
  const page = {} as Page;
  const context = { newCDPSession: async (target: Page) => {
    assert.equal(target, page);
    return {
      async send(method: string, input?: unknown) {
        calls.push(method);
        if (method === "Browser.getWindowForTarget") return { windowId: 17 };
        if (method === "Browser.setWindowBounds") assert.deepEqual(input, { windowId: 17, bounds: { windowState: "normal" } });
        return {};
      },
      async detach() { calls.push("window-detach"); },
    };
  }, browser: () => ({ newBrowserCDPSession: async () => ({
    async send(method: string) { calls.push(method); if (errors.send) throw errors.send; return { processInfo: processes }; },
    async detach() { calls.push("detach"); if (errors.detach) throw errors.detach; },
  }) }) } as unknown as BrowserContext;
  return { context, page, calls };
}

it("activates the owned macOS browser process on each show and returns to the captured Relay app", async () => {
  const calls: { file: string; args: readonly string[]; timeoutMs: number }[] = [];
  const run: FocusCommandRunner = async (file, args, timeoutMs) => {
    calls.push({ file, args, timeoutMs });
    return calls.length === 1 ? JSON.stringify({ processId: 71, workArea: { left: 0, top: 25, width: 1600, height: 975 } }) : "focused\n";
  };
  const focus = createDuoBrowserFocus(5000, "darwin", run), owned = browser();
  const relay = await focus.captureRelay(); assert.ok(relay);
  assert.deepEqual(relay, { platform: "darwin", processId: 71, workArea: { left: 0, top: 25, width: 1600, height: 975 } });
  await focus.show(owned.context, owned.page); await focus.show(owned.context, owned.page); await focus.returnToRelay(relay);
  assert.deepEqual(calls.map(call => call.file), Array(4).fill("/usr/bin/osascript"));
  assert.deepEqual(calls.slice(1).map(call => call.args.slice(-2)), [["421321", "4000"], ["421321", "4000"], ["71", "4000"]]);
  const script = calls[1].args[3];
  assert.match(script, /runningApplicationWithProcessIdentifier\(pid\)/u);
  assert.match(script, /activateWithOptions\(1\)/u);
  assert.match(script, /frontmostApplication\.processIdentifier/u);
  assert.doesNotMatch(script, /System Events|AXRaise|activateWithOptions\(2\)/u);
  assert.ok(calls.every(call => call.timeoutMs === 5000));
  assert.deepEqual(owned.calls, Array.from({ length: 2 }, () => ["SystemInfo.getProcessInfo", "detach", "Browser.getWindowForTarget", "Browser.setWindowBounds", "Page.bringToFront", "window-detach"]).flat());
});

it("foregrounds the owned Windows process and preserves the original Relay window for return", async () => {
  const calls: { file: string; args: readonly string[] }[] = [];
  const run: FocusCommandRunner = async (file, args) => {
    calls.push({ file, args });
    return calls.length === 1 ? JSON.stringify({ processId: 72, windowHandle: "8192", workArea: { left: 0, top: 0, width: 1600, height: 950 } }) : "focused\r\n";
  };
  const focus = createDuoBrowserFocus(5000, "win32", run), owned = browser();
  const relay = await focus.captureRelay(); assert.ok(relay);
  assert.deepEqual(relay, { platform: "win32", processId: 72, windowHandle: "8192", workArea: { left: 0, top: 0, width: 1600, height: 950 } });
  await focus.show(owned.context, owned.page); await focus.returnToRelay(relay);
  assert.ok(calls.every(call => call.file === "powershell.exe"));
  assert.match(calls[1].args[3], /\$relayProcessId = 421321/u);
  assert.match(calls[2].args[3], /\$relayProcessId = 72/u);
  assert.ok(calls[2].args[3].includes("[IntPtr]::new([long]'8192')"));
  assert.deepEqual(owned.calls, ["SystemInfo.getProcessInfo", "detach"]);
});

it("uses the JXA property bridge for unhide before activating and verifying the owned app", async () => {
  const calls: string[] = [];
  let frontmost = 71;
  const focus = createDuoBrowserFocus(5000, "darwin", async (_file, args) => {
    const invoke: unknown = runInNewContext(`${args[3]}; run`, {
      ObjC: { import: () => undefined },
      $: {
        NSRunningApplication: { runningApplicationWithProcessIdentifier(pid: number) {
          assert.equal(pid, 421321);
          return {
            get unhide() { calls.push("unhide"); return true; },
            activateWithOptions(option: number) { assert.equal(option, 1); calls.push("activate"); frontmost = pid; return true; },
          };
        } },
        NSWorkspace: { sharedWorkspace: { get frontmostApplication() { calls.push("verify"); return { processIdentifier: frontmost }; } } },
      },
    });
    assert.ok(typeof invoke === "function");
    const result: unknown = Reflect.apply(invoke, undefined, [args.slice(4)]);
    assert.equal(result, "focused");
    return String(result);
  });
  const owned = browser();
  await focus.show(owned.context, owned.page);
  assert.deepEqual(calls, ["unhide", "activate", "verify"]);
});

for (const processes of [[], [{ type: "browser", id: 1 }, { type: "browser", id: 2 }], [{ type: "browser", id: -1 }]]) {
  it(`refuses missing, ambiguous or invalid browser ownership: ${JSON.stringify(processes)}`, async () => {
    const owned = browser(processes);
    let activations = 0;
    const focus = createDuoBrowserFocus(5000, "darwin", async () => { activations++; return "focused"; });
    await assert.rejects(focus.show(owned.context, owned.page));
    assert.equal(activations, 0);
    assert.deepEqual(owned.calls, ["SystemInfo.getProcessInfo", "detach"]);
  });
}

it("retains both an observation failure and its CDP cleanup failure without activating an app", async () => {
  const send = new Error("synthetic process observation failed"), detach = new Error("synthetic CDP detach failed");
  const owned = browser(undefined, { send, detach });
  const focus = createDuoBrowserFocus(5000, "darwin", async () => { throw new Error("must not activate after observation failure"); });
  await assert.rejects(focus.show(owned.context, owned.page), error => error instanceof AggregateError
    && error.errors.length === 2 && error.errors[0] === send && error.errors[1] === detach && error.cause === detach);
});

it("rejects an OS refusal instead of reporting successful foreground activation", async () => {
  const owned = browser(), focus = createDuoBrowserFocus(5000, "win32", async () => "blocked");
  await assert.rejects(focus.show(owned.context, owned.page), DuoBrowserFocusError);
});

it("keeps Linux development focus in the browser without calling desktop OS commands", async () => {
  const owned = browser(), focus = createDuoBrowserFocus(5000, "linux", async () => { throw new Error("unexpected desktop command"); });
  assert.equal(await focus.captureRelay(), undefined); await focus.show(owned.context, owned.page);
  assert.deepEqual(owned.calls, []);
  await assert.rejects(focus.returnToRelay({ platform: "darwin", processId: 71 }), DuoBrowserFocusError);
});

it("captures the work area of the frontmost owned app's display across negative screen coordinates", async () => {
  const screens = [
    { frame: { origin: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } }, visibleFrame: { origin: { x: 0, y: 0 }, size: { width: 1920, height: 1055 } } },
    { frame: { origin: { x: -1600, y: 180 }, size: { width: 1600, height: 900 } }, visibleFrame: { origin: { x: -1600, y: 180 }, size: { width: 1600, height: 876 } } },
  ];
  const focus = createDuoBrowserFocus(5000, "darwin", async (_file, args) => {
    const invoke: unknown = runInNewContext(`${args[3]}; run`, { ObjC: { import() {}, bindFunction(name: string, signature: unknown) { assert.equal(name, "CGWindowListCopyWindowInfo"); assert.deepEqual(JSON.parse(JSON.stringify(signature)), ["id", ["uint32", "uint32"]]); }, deepUnwrap: (value: unknown) => value }, $: {
      NSWorkspace: { sharedWorkspace: { frontmostApplication: { processIdentifier: 71 } } },
      CGWindowListCopyWindowInfo: () => [
        { kCGWindowOwnerPID: 99, kCGWindowLayer: 0, kCGWindowBounds: { X: 0, Y: 0, Width: 1900, Height: 1000 } },
        { kCGWindowOwnerPID: 71, kCGWindowLayer: 0, kCGWindowBounds: { X: -1500, Y: 100, Width: 900, Height: 700 } },
      ], kCGWindowListOptionOnScreenOnly: 1, kCGNullWindowID: 0,
      NSScreen: { screens: { count: screens.length, objectAtIndex: (index: number) => screens[index] } },
    } });
    assert.ok(typeof invoke === "function"); const result: unknown = Reflect.apply(invoke, undefined, []); assert.equal(typeof result, "string"); return String(result);
  });
  assert.deepEqual(await focus.captureRelay(), { platform: "darwin", processId: 71, workArea: { left: -1600, top: 24, width: 1600, height: 876 } });
});
