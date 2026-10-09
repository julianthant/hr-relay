
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { probePrimaryDisplay, type HostCommandRunner } from "../../../../../../src/backend/app/host/primary-display.js";

function darwinReport(displays: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ SPDisplaysDataType: [{ _name: "Apple M-series", spdisplays_ndrvs: displays }] });
}

const MAIN_LCD = { _name: "Color LCD", _spdisplays_resolution: "1512 x 982 @ 120.00Hz", _spdisplays_pixels: "3024 x 1964", spdisplays_main: "spdisplays_yes" };
const EXTERNAL = { _name: "DELL U2723QE", _spdisplays_resolution: "2560 x 1440 @ 60.00Hz", _spdisplays_pixels: "3840 x 2160" };

function runner(answers: Readonly<Record<string, string | Error>>): HostCommandRunner {
  return (file) => {
    const answer = answers[file];
    if (answer === undefined) throw new Error(`unexpected host command ${file}`);
    if (answer instanceof Error) throw answer;
    return answer;
  };
}

describe("primary display probe", () => {
  it("reads the macOS main display's LOGICAL resolution, not its backing pixels", () => {
    const observation = probePrimaryDisplay("darwin", runner({ system_profiler: darwinReport([EXTERNAL, MAIN_LCD]) }));
    assert.deepEqual(observation, { state: "detected", screenWidth: 1512, screenHeight: 982, source: "system_profiler" });
  });

  it("accepts a single unmarked macOS display and refuses an ambiguous set", () => {
    assert.deepEqual(
      probePrimaryDisplay("darwin", runner({ system_profiler: darwinReport([EXTERNAL]) })),
      { state: "detected", screenWidth: 2560, screenHeight: 1440, source: "system_profiler" },
    );
    assert.throws(
      () => probePrimaryDisplay("darwin", runner({ system_profiler: darwinReport([EXTERNAL, { ...EXTERNAL, _name: "second" }]) })),
      /2 displays with 0 marked main; the primary display is ambiguous/u,
    );
  });

  it("reports a macOS host with no attached display as unavailable, and a malformed answer as an error", () => {
    assert.deepEqual(
      probePrimaryDisplay("darwin", runner({ system_profiler: darwinReport([]) })),
      { state: "unavailable", reason: "no-display" },
    );
    assert.throws(
      () => probePrimaryDisplay("darwin", runner({ system_profiler: "not json" })),
      /system_profiler did not return JSON/u,
    );
    assert.throws(
      () => probePrimaryDisplay("darwin", runner({ system_profiler: darwinReport([{ ...MAIN_LCD, _spdisplays_resolution: "Retina" }]) })),
      /system_profiler reported a display resolution in an unrecognized shape/u,
    );
    assert.throws(
      () => probePrimaryDisplay("darwin", runner({ system_profiler: darwinReport([{ spdisplays_main: "spdisplays_yes" }]) })),
      /without a resolution/u,
    );
  });

  it("reads the Windows primary screen bounds and refuses an unrecognized answer", () => {
    assert.deepEqual(
      probePrimaryDisplay("win32", runner({ "powershell.exe": "2560x1440\r\n" })),
      { state: "detected", screenWidth: 2560, screenHeight: 1440, source: "powershell" },
    );
    assert.throws(
      () => probePrimaryDisplay("win32", runner({ "powershell.exe": "Add-Type : Cannot add type" })),
      /powershell reported a display resolution in an unrecognized shape/u,
    );
  });

  it("reads the X11 primary output, and treats a missing or displayless xrandr as unavailable", () => {
    const xrandr = [
      "Screen 0: minimum 320 x 200, current 5120 x 1440, maximum 16384 x 16384",
      "DP-1 connected primary 3440x1440+0+0 (normal left inverted right x axis y axis) 800mm x 335mm",
      "HDMI-1 connected 1680x1050+3440+0 (normal left inverted right x axis y axis) 474mm x 296mm",
    ].join("\n");
    assert.deepEqual(
      probePrimaryDisplay("linux", runner({ xrandr })),
      { state: "detected", screenWidth: 3440, screenHeight: 1440, source: "xrandr" },
    );
    const missing = Object.assign(new Error("spawnSync xrandr ENOENT"), { code: "ENOENT" });
    assert.deepEqual(probePrimaryDisplay("linux", runner({ xrandr: missing })), { state: "unavailable", reason: "probe-missing" });
    assert.deepEqual(
      probePrimaryDisplay("linux", runner({ xrandr: new Error("Can't open display") })),
      { state: "unavailable", reason: "no-display" },
    );
    assert.deepEqual(
      probePrimaryDisplay("linux", runner({ xrandr: "HDMI-1 connected 1680x1050+0+0" })),
      { state: "unavailable", reason: "no-display" },
    );
    assert.throws(
      () => probePrimaryDisplay("linux", runner({ xrandr: "DP-1 connected primary (normal left inverted right x axis y axis)" })),
      /xrandr reported the primary output without a current mode/u,
    );
  });

  it("never runs a command on a platform it has no probe for", () => {
    assert.deepEqual(
      probePrimaryDisplay("freebsd", () => { throw new Error("must not be called"); }),
      { state: "unavailable", reason: "unsupported-platform" },
    );
  });
});
