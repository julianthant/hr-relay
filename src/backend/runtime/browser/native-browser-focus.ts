import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserContext, Page } from "playwright";
import { z } from "zod";

const ProcessIdSchema = z.number().int().positive().max(0xffff_ffff);
const WorkAreaSchema = z.strictObject({ left: z.number().int(), top: z.number().int(), width: z.number().int().positive(), height: z.number().int().positive() });
const AppTargetSchema = z.strictObject({ workArea: WorkAreaSchema.optional(), platform: z.literal("darwin"), processId: ProcessIdSchema });
const WindowTargetSchema = z.strictObject({ workArea: WorkAreaSchema.optional(), platform: z.literal("win32"), processId: ProcessIdSchema,
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
  ObjC.import('AppKit'); ObjC.import('CoreGraphics');
  ObjC.bindFunction('CGWindowListCopyWindowInfo', ['id', ['uint32', 'uint32']]);
  var pid = Number($.NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier);
  var windows = ObjC.deepUnwrap($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, $.kCGNullWindowID));
  var window = windows.find(function(w) { return Number(w.kCGWindowOwnerPID) === pid && Number(w.kCGWindowLayer) === 0 && w.kCGWindowBounds.Width > 0; });
  if (!window) throw new Error('duo-browser-display-unproved');
  var bounds = window.kCGWindowBounds, screens = $.NSScreen.screens, primaryHeight = screens.objectAtIndex(0).frame.size.height;
  var selected, overlap = 0;
  for (var i = 0; i < screens.count; i++) {
    var screen = screens.objectAtIndex(i), frame = screen.frame;
    var top = primaryHeight - frame.origin.y - frame.size.height;
    var area = Math.max(0, Math.min(bounds.X + bounds.Width, frame.origin.x + frame.size.width) - Math.max(bounds.X, frame.origin.x))
      * Math.max(0, Math.min(bounds.Y + bounds.Height, top + frame.size.height) - Math.max(bounds.Y, top));
    if (area > overlap) { selected = screen; overlap = area; }
  }
  if (!selected) throw new Error('duo-browser-display-unproved');
  var visible = selected.visibleFrame;
  return JSON.stringify({processId: pid, workArea: {left: Math.round(visible.origin.x), top: Math.round(primaryHeight - visible.origin.y - visible.size.height), width: Math.round(visible.size.width), height: Math.round(visible.size.height)}});
}`;
const ACTIVATE_APP = `function run(args) {
  ObjC.import('AppKit');
  var pid = Number(args[0]);
  var app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(pid);
  app.unhide;
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
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int Size; public Rect Monitor, Work; public uint Flags; }
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
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
$relayMonitor = [RelayBrowserFocus]::MonitorFromWindow($relayWindowHandle, 0)
$relayMonitorInfo = New-Object RelayBrowserFocus+MonitorInfo
$relayMonitorInfo.Size = [System.Runtime.InteropServices.Marshal]::SizeOf($relayMonitorInfo)
if ($relayMonitor -eq [IntPtr]::Zero -or -not [RelayBrowserFocus]::GetMonitorInfo($relayMonitor, [ref]$relayMonitorInfo)) { throw 'duo-browser-display-unproved' }
@{ processId = $relayProcessId; windowHandle = $relayWindowHandle.ToInt64().ToString(); workArea = @{ left = $relayMonitorInfo.Work.Left; top = $relayMonitorInfo.Work.Top; width = ($relayMonitorInfo.Work.Right - $relayMonitorInfo.Work.Left); height = ($relayMonitorInfo.Work.Bottom - $relayMonitorInfo.Work.Top) } } | ConvertTo-Json -Compress
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
      WorkAreaSchema.parse(observation.workArea);
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
