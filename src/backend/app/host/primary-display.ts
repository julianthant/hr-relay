/**
 * Probe the host's primary display (D324; ref clock-config-secrets §3).
 *
 * One synchronous OS query per process tree, invoked through
 * `establishHostPrimaryDisplay`, which publishes the answer for every child.
 * The parsers are STRICT: an OS tool that answered in a shape this module does
 * not recognize is a thrown error naming the tool, never a guessed viewport.
 * Only two states are answers: a detected `width x height`, or `unavailable`
 * for a host that genuinely has no display to report.
 */
import { execFileSync } from "node:child_process";
import { z } from "zod";
import type { HostPrimaryDisplayObservation } from "../../../models/config/host-display.js";

export type HostCommandRunner = (file: string, args: readonly string[]) => string;

/** ENOENT from the probe binary itself: the tool is absent, so no display can be read through it. */
function isCommandMissing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "ENOENT";
}

const runHostCommand: HostCommandRunner = (file, args) =>
  execFileSync(file, [...args], {
    encoding: "utf8",
    timeout: 20_000,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

const DIMENSIONS = /^(\d{2,5})\s*x\s*(\d{2,5})(?:\s|$)/u;

function dimensions(text: string, tool: string): Readonly<{ screenWidth: number; screenHeight: number }> {
  const match = DIMENSIONS.exec(text.trim());
  if (match === null) throw new Error(`${tool} reported a display resolution in an unrecognized shape`);
  return { screenWidth: Number(match[1]), screenHeight: Number(match[2]) };
}

// macOS — `system_profiler SPDisplaysDataType -json`. `_spdisplays_resolution`
// is the LOGICAL resolution ("1512 x 982 @ 120.00Hz"), the size a browser
// window actually gets; `_spdisplays_pixels` is the backing store and is not it.
const SystemProfilerDisplaySchema = z.looseObject({
  _spdisplays_resolution: z.string().optional(),
  spdisplays_main: z.string().optional(),
});
const SystemProfilerSchema = z.looseObject({
  SPDisplaysDataType: z.array(z.looseObject({
    spdisplays_ndrvs: z.array(SystemProfilerDisplaySchema).optional(),
  })),
});

function probeDarwin(run: HostCommandRunner): HostPrimaryDisplayObservation {
  const raw = run("system_profiler", ["SPDisplaysDataType", "-json"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error("system_profiler did not return JSON", { cause: error });
  }
  const report = SystemProfilerSchema.parse(parsed);
  const displays = report.SPDisplaysDataType.flatMap((adapter) => adapter.spdisplays_ndrvs ?? []);
  if (displays.length === 0) return { state: "unavailable", reason: "no-display" };
  const main = displays.filter((display) => display.spdisplays_main === "spdisplays_yes");
  const chosen = main.length === 1 ? main[0] : displays.length === 1 ? displays[0] : undefined;
  if (chosen === undefined) {
    throw new Error(
      `system_profiler reported ${String(displays.length)} displays with ${String(main.length)} marked main; the primary display is ambiguous`,
    );
  }
  if (chosen._spdisplays_resolution === undefined) {
    throw new Error("system_profiler reported the main display without a resolution");
  }
  return { state: "detected", ...dimensions(chosen._spdisplays_resolution, "system_profiler"), source: "system_profiler" };
}

// Windows — the primary screen's bounds in logical pixels.
function probeWindows(run: HostCommandRunner): HostPrimaryDisplayObservation {
  const raw = run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Add-Type -AssemblyName System.Windows.Forms; $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; Write-Output (\"{0}x{1}\" -f $b.Width, $b.Height)",
  ]);
  return { state: "detected", ...dimensions(raw, "powershell"), source: "powershell" };
}

// Linux/X11 — the `primary` output's current mode. No xrandr, or an xrandr that
// cannot open a display, is a host without one.
function probeLinux(run: HostCommandRunner): HostPrimaryDisplayObservation {
  let raw: string;
  try {
    raw = run("xrandr", ["--current"]);
  } catch (error) {
    if (isCommandMissing(error)) return { state: "unavailable", reason: "probe-missing" };
    return { state: "unavailable", reason: "no-display" };
  }
  const primary = raw.split("\n").find((line) => / connected primary /u.test(line));
  if (primary === undefined) return { state: "unavailable", reason: "no-display" };
  const geometry = /\s(\d{2,5})x(\d{2,5})\+\d+\+\d+/u.exec(primary);
  if (geometry === null) throw new Error("xrandr reported the primary output without a current mode");
  return { state: "detected", screenWidth: Number(geometry[1]), screenHeight: Number(geometry[2]), source: "xrandr" };
}

export function probePrimaryDisplay(
  platform: NodeJS.Platform = process.platform,
  run: HostCommandRunner = runHostCommand,
): HostPrimaryDisplayObservation {
  switch (platform) {
    case "darwin": return probeDarwin(run);
    case "win32": return probeWindows(run);
    case "linux": return probeLinux(run);
    default: return { state: "unavailable", reason: "unsupported-platform" };
  }
}
