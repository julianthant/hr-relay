import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserContext, Page } from "playwright";
import { z } from "zod";

const ProcessIdSchema = z.number().int().positive().max(0xffff_ffff);
const AppTargetSchema = z.strictObject({ platform: z.literal("darwin"), processId: ProcessIdSchema });
const WindowTargetSchema = z.strictObject({ platform: z.literal("win32"), processId: ProcessIdSchema,
  windowHandle: z.string().regex(/^[1-9]\d{0,19}$/u) });
export type NativeFocusTarget = Readonly<z.infer<typeof AppTargetSchema> | z.infer<typeof WindowTargetSchema>>;
export interface DuoBrowserFocus {
  captureRelay(): Promise<NativeFocusTarget | undefined>;
  show(context: BrowserContext, page: Page): Promise<void>;
  returnToRelay(target: NativeFocusTarget): Promise<void>;
}
export type FocusCommandRunner = (file: string, args: readonly string[], timeoutMs: number) => Promise<string>;

export class DuoBrowserFocusError extends Error {
  constructor(options?: ErrorOptions) { super("duo-browser-focus-refused", options); this.name = "DuoBrowserFocusError"; }
}

const execFileAsync = promisify(execFile);
const runFocusCommand: FocusCommandRunner = async (file, args, timeoutMs) => {
  try {
    const { stdout } = await execFileAsync(file, [...args], { encoding: "utf8", timeout: timeoutMs, windowsHide: true });
    return stdout;
  } catch (cause) { throw new DuoBrowserFocusError({ cause }); }
};

const CAPTURE_APP = `function run() {
  ObjC.import('AppKit');
  return JSON.stringify({processId: Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier)});
}`;
const ACTIVATE_APP = `function run(args) {
  ObjC.import('AppKit');
  var pid = Number(args[0]);
  var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  app.unhide();
  app.activateWithOptions(1);
  var deadline = Date.now() + Number(args[1]);
  while (Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier) !== pid) {
    if (Date.now() >= deadline) throw new Error('duo-browser-focus-refused');
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.05));
  }
  return 'focused';
}`;

const WINDOWS_API = `Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RelayBrowserFocus {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
}
'@
`;
const CAPTURE_WINDOW = `${WINDOWS_API}
$relayWindowHandle = [RelayBrowserFocus]::GetForegroundWindow()
if ($relayWindowHandle -eq [IntPtr]::Zero) { throw 'duo-browser-focus-refused' }
[uint32]$relayProcessId = 0
[void][RelayBrowserFocus]::GetWindowThreadProcessId($relayWindowHandle, [ref]$relayProcessId)
@{ processId = $relayProcessId; windowHandle = $relayWindowHandle.ToInt64().ToString() } | ConvertTo-Json -Compress
`;

async function browserProcessId(context: BrowserContext): Promise<number> {
  const browser = context.browser();
  if (!browser) throw new DuoBrowserFocusError();
  const pipe = await browser.newBrowserCDPSession();
  const result = await pipe.send("SystemInfo.getProcessInfo").catch(async (error: unknown) => {
    try { await pipe.detach(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], "duo-browser-focus-observation-unproved", { cause: cleanup }); }
    throw error;
  });
  await pipe.detach();
  const processes = result.processInfo.filter(process => process.type === "browser");
  if (processes.length !== 1 || !processes[0]) throw new DuoBrowserFocusError();
  return ProcessIdSchema.parse(processes[0].id);
}

export function createDuoBrowserFocus(timeoutMs: number, platform: NodeJS.Platform = process.platform,
  run: FocusCommandRunner = runFocusCommand): DuoBrowserFocus {
  const command = (file: string, args: readonly string[]) => run(file, args, timeoutMs);
  const powershell = (script: string) => command("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
  async function activate(processId: number, windowHandle?: string): Promise<void> {
    const id = ProcessIdSchema.parse(processId);
    let result: string;
    if (platform === "darwin") result = await command("/usr/bin/osascript", ["-l", "JavaScript", "-e", ACTIVATE_APP, String(id), String(Math.floor(timeoutMs * 0.8))]);
    else if (platform === "win32") result = await powershell(`${WINDOWS_API}
$relayProcessId = ${id}
$relayWindowHandle = ${windowHandle === undefined ? `(Get-Process -Id $relayProcessId -ErrorAction Stop).MainWindowHandle` : `[IntPtr]::new([long]'${WindowTargetSchema.shape.windowHandle.parse(windowHandle)}')`}
if ($relayWindowHandle -eq [IntPtr]::Zero) { throw 'duo-browser-focus-refused' }
[uint32]$relayActualProcessId = 0
[void][RelayBrowserFocus]::GetWindowThreadProcessId($relayWindowHandle, [ref]$relayActualProcessId)
if ($relayActualProcessId -ne $relayProcessId) { throw 'duo-browser-focus-refused' }
if ([RelayBrowserFocus]::IsIconic($relayWindowHandle)) { [void][RelayBrowserFocus]::ShowWindowAsync($relayWindowHandle, 9) }
if (-not [RelayBrowserFocus]::SetForegroundWindow($relayWindowHandle)) { throw 'duo-browser-focus-refused' }
Write-Output 'focused'
`);
    else throw new DuoBrowserFocusError();
    if (result.trim() !== "focused") throw new DuoBrowserFocusError();
  }
  return {
    async captureRelay() {
      if (platform !== "darwin" && platform !== "win32") return undefined;
      const raw = platform === "darwin" ? await command("/usr/bin/osascript", ["-l", "JavaScript", "-e", CAPTURE_APP]) : await powershell(CAPTURE_WINDOW);
      const value: unknown = JSON.parse(raw);
      const observation = z.record(z.string(), z.unknown()).parse(value);
      return platform === "darwin" ? AppTargetSchema.parse({ ...observation, platform }) : WindowTargetSchema.parse({ ...observation, platform });
    },
    async show(context, page) {
      if (platform !== "darwin" && platform !== "win32") return;
      const processId = await browserProcessId(context);
      if (platform === "darwin") {
        const pipe = await context.newCDPSession(page);
        let failure: { error: unknown } | undefined;
        try {
          const { windowId } = await pipe.send("Browser.getWindowForTarget");
          await pipe.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
          await pipe.send("Page.bringToFront");
        } catch (error) { failure = { error }; }
        try { await pipe.detach(); }
        catch (cleanup) { throw new AggregateError(failure ? [failure.error, cleanup] : [cleanup], "duo-browser-focus-restoration-unproved", { cause: cleanup }); }
        if (failure) throw failure.error;
      }
      await activate(processId);
    },
    async returnToRelay(target) {
      if (target.platform !== platform) throw new DuoBrowserFocusError();
      await activate(target.processId, target.platform === "win32" ? target.windowHandle : undefined);
    },
  };
}
