import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { chromium, type Browser, type BrowserContext, type ConnectOverCDPTransport } from "playwright";
import { it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_BROWSER_LAUNCHER, BrowserLaunchUncertainError, chromiumProfileInUse, type OwnedBrowserProcess } from "../../../../src/backend/runtime/browser/native-browser.js";

function isPipeTransport(value: unknown): value is ConnectOverCDPTransport {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "send") === "function" && typeof Reflect.get(value, "close") === "function";
}

let child: ChildProcess;
const launches: { executable: string; args: readonly string[] }[] = [];
vi.mock("node:child_process", async importOriginal => {
  const real = await importOriginal<typeof import("node:child_process")>();
  return { ...real, spawn(executable: string, args: readonly string[]) { launches.push({ executable, args }); return child; } };
});

for (const stopped of [true, false]) it(`uses private pipes and requires positive child exit when stop is ${stopped ? "successful" : "refused"}`, async () => {
  child = new ChildProcess();
  const write = new PassThrough(), read = new PassThrough();
  Object.defineProperty(child, "stdio", { value: [null, null, null, write, read] });
  const kill = vi.spyOn(child, "kill").mockImplementation(signal => {
    assert.equal(signal, "SIGKILL");
    if (stopped) child.emit("exit", null, signal);
    return stopped;
  });
  const context = {} as BrowserContext;
  const fakeBrowser = { contexts: () => [context], newBrowserCDPSession: async () => ({
    async send(method: string, input: unknown) { assert.equal(method, "Browser.setDownloadBehavior"); assert.deepEqual(input, { behavior: "deny" }); }, async detach() {},
  }) } as unknown as Browser;
  let transport: ConnectOverCDPTransport | undefined;
  const connect = vi.spyOn(chromium, "connectOverCDP").mockImplementation(async value => {
    assert.ok(isPipeTransport(value)); transport = value; return fakeBrowser;
  });
  let owned: OwnedBrowserProcess | undefined;
  try {
    assert.equal(await DEFAULT_BROWSER_LAUNCHER.launch({ profileDirectory: "synthetic-owned-profile", extensionDirectory: "synthetic-extension",
      headless: false, acceptDownloads: false, downloadsPath: "synthetic-owned-profile", viewport: { width: 640, height: 720 }, timeoutMs: 50,
      ownedProcess: value => { owned = value; } }), context);
    assert.ok(owned); assert.ok(transport);
    const launch = launches.at(-1); assert.ok(launch);
    assert.equal(launch.executable, chromium.executablePath());
    assert.ok(launch.args.includes("--no-sandbox"));
    assert.ok(launch.args.includes("--remote-debugging-pipe"));
    assert.ok(launch.args.includes("--no-startup-window"));
    assert.ok(!launch.args.some(value => value.startsWith("--remote-debugging-port")));
    assert.equal(owned.exited(), false);
    let exits = 0; owned.onExit(() => { exits++; });
    if (stopped) { await owned.stop(50); assert.equal(owned.exited(), true); assert.equal(exits, 1); }
    else { await assert.rejects(owned.stop(50), /DUO_SETUP_STOP_FAILED/); assert.equal(owned.exited(), false); assert.equal(exits, 0); }
    const observed: object[] = []; transport.onmessage = value => observed.push(value);
    const response = Buffer.from(JSON.stringify({ id: 1, result: { title: "Synthetic é" } }) + "\0");
    read.write(response.subarray(0, response.length - 4)); read.write(response.subarray(response.length - 4));
    assert.deepEqual(observed, [{ id: 1, result: { title: "Synthetic é" } }]);
    const sent: string[] = []; write.on("data", (value: Buffer) => sent.push(value.toString("utf8")));
    transport.send({ id: 2, method: "Browser.getVersion" });
    assert.deepEqual(sent, ['{"id":2,"method":"Browser.getVersion"}\0']);
  } finally { connect.mockRestore(); kill.mockRestore(); write.destroy(); read.destroy(); }
});

for (const outcome of ["exit-without-reply", "no-exit", "refused", "transport-failed"] as const) it(`ordinary shutdown sends Browser.close on the owned root pipe and requires positive exit (${outcome})`, async () => {
  child = new ChildProcess();
  const write = new PassThrough(), read = new PassThrough();
  Object.defineProperty(child, "stdio", { value: [null, null, null, write, read] });
  const kill = vi.spyOn(child, "kill").mockImplementation(() => assert.fail("ordinary shutdown must not force the child"));
  const sessionCalls: string[] = [];
  let exitDelivered = false;
  const deliverExit = () => { if (outcome === "exit-without-reply" && !exitDelivered) { exitDelivered = true; child.emit("exit", 0, null); } };
  const context = { browser: () => browser } as unknown as BrowserContext;
  const browser = { isConnected: () => true, contexts: () => [context], newBrowserCDPSession: async () => ({
    // A session close exits the child but never answers, so a reply-dependent stop cannot settle.
    async send(method: string) { sessionCalls.push(method); if (method === "Browser.close") { deliverExit(); await new Promise<never>(() => {}); } }, async detach() {},
  }) } as unknown as Browser;
  let transport: ConnectOverCDPTransport | undefined;
  const connect = vi.spyOn(chromium, "connectOverCDP").mockImplementation(async value => { assert.ok(isPipeTransport(value)); transport = value; return browser; });
  let process: OwnedBrowserProcess | undefined;
  try {
    await DEFAULT_BROWSER_LAUNCHER.launch({ profileDirectory: "synthetic-owned-profile", extensionDirectory: "synthetic-extension", headless: true,
      nativeOnly: true, acceptDownloads: false, downloadsPath: "synthetic-owned-profile", viewport: { width: 640, height: 720 }, timeoutMs: 50,
      ownedProcess: owned => { process = owned; } });
    assert.ok(process); assert.ok(transport);
    const forwarded: object[] = []; transport.onmessage = value => forwarded.push(value);
    // Chromium's CDP dispatcher only accepts signed 32-bit command ids.
    const wire = z.strictObject({ id: z.number().int().min(-(2 ** 31)).max(2 ** 31 - 1).negative(), method: z.literal("Browser.close") });
    const sent: unknown[] = [];
    write.on("data", (value: Buffer) => {
      const raw: unknown = JSON.parse(value.toString("utf8").replace(/\0$/u, "")); sent.push(raw);
      const message = wire.safeParse(raw); if (!message.success) return;
      deliverExit();
      if (outcome === "refused") read.write(JSON.stringify({ id: message.data.id, error: { code: -32000, message: "synthetic refusal" } }) + "\0");
    });
    if (outcome === "transport-failed") write.destroy();
    const started = Date.now();
    if (outcome === "exit-without-reply") {
      const owned = process;
      await owned.stop(2000, true).catch((error: unknown) => {
        throw new Error(`stop refused after exitDelivered=${String(exitDelivered)} exited=${String(owned.exited())}`, { cause: error });
      });
      assert.equal(exitDelivered, true);
    }
    else await assert.rejects(process.stop(outcome === "refused" ? 2000 : 50, true), /DUO_SETUP_STOP_FAILED/);
    if (outcome !== "no-exit" && outcome !== "transport-failed") assert.ok(Date.now() - started < 1000, "settles on exit or refusal, not the deadline");
    assert.deepEqual(sessionCalls, ["Browser.setDownloadBehavior"]);
    assert.equal(sent.length, outcome === "transport-failed" ? 0 : 1);
    for (const message of sent) assert.equal(wire.safeParse(message).success, true, `invalid CDP close command ${JSON.stringify(message)}`);
    assert.equal(process.exited(), outcome === "exit-without-reply");
    assert.deepEqual(forwarded, [], "the shutdown reply is never forwarded to Playwright");
    const args = launches.at(-1)?.args; assert.ok(args); assert.ok(args.includes("--disable-extensions")); assert.ok(args.includes("--use-mock-keychain"));
    assert.ok(args.includes("--no-sandbox"));
    assert.equal(args.some(arg => arg.startsWith("--load-extension=")), false);
  } finally { connect.mockRestore(); kill.mockRestore(); write.destroy(); read.destroy(); }
});

for (const exits of [false, true]) it(`classifies a busy profile only with bounded diagnostics and positive child exit (exit=${exits})`, async () => {
  child = new ChildProcess();
  const diagnostic = new PassThrough(), write = new PassThrough(), read = new PassThrough();
  Object.defineProperty(child, "stdio", { value: [null, null, diagnostic, write, read] });
  Object.defineProperty(child, "stderr", { value: diagnostic });
  const original = new Error("synthetic pipe closed");
  const connect = vi.spyOn(chromium, "connectOverCDP").mockImplementation(async () => {
    diagnostic.write("synthetic-private-path Failed to create a ProcessSingleton for your ");
    diagnostic.write("profile directory.");
    if (exits) { child.emit("exit", 21, null); child.emit("close", 21, null); }
    throw original;
  });
  let process: OwnedBrowserProcess | undefined;
  try {
    await assert.rejects(DEFAULT_BROWSER_LAUNCHER.launch({ profileDirectory: "synthetic-owned-profile", extensionDirectory: "synthetic-extension", headless: true,
      nativeOnly: true, acceptDownloads: false, downloadsPath: "synthetic-owned-profile", viewport: { width: 640, height: 720 }, timeoutMs: 50,
      ownedProcess: owned => { process = owned; } }), error => {
      assert.equal(chromiumProfileInUse(error), exits);
      assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /synthetic-private-path/);
      if (!exits) assert.ok(error instanceof BrowserLaunchUncertainError);
      return true;
    });
    assert.ok(process); assert.equal(process.exited(), exits);
  } finally { connect.mockRestore(); diagnostic.destroy(); write.destroy(); read.destroy(); }
});
