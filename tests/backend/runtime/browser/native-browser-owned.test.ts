import assert from "node:assert/strict";
import { ChildProcess } from "node:child_process";
import { PassThrough } from "node:stream";
import { chromium, type Browser, type BrowserContext, type ConnectOverCDPTransport } from "playwright";
import { it, vi } from "vitest";
import { DEFAULT_BROWSER_LAUNCHER, type OwnedBrowserProcess } from "../../../../src/backend/runtime/browser/native-browser.js";

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
