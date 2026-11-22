import { describe, expect, it, vi } from "vitest";
import { nextReleaseTag, runRelease, waitForIdleDashboard, type ReleaseOperations } from "../../../scripts/release/release.js";

describe("release command", () => {
  it("uses the next same-day suffix, even after a tag was removed", () => {
    expect(nextReleaseTag("2026-11-22", ["v2026.11.21"])).toBe("v2026.11.22");
    expect(nextReleaseTag("2026-11-22", ["v2026.11.22"])).toBe("v2026.11.22.2");
    expect(nextReleaseTag("2026-11-22", ["v2026.11.22", "v2026.11.22.4"])).toBe("v2026.11.22.5");
  });

  function operations() {
    return {
      printPlan: vi.fn(),
      verifyPromotion: vi.fn(),
      stopIdleDashboard: vi.fn(),
      publish: vi.fn(),
      syncStaging: vi.fn(),
      deploy: vi.fn(),
      restartDashboard: vi.fn(),
    } satisfies ReleaseOperations;
  }

  it("prints the plan before returning from a dry run without applying any step", async () => {
    const ops = operations();
    await runRelease(true, ops);
    expect(ops.printPlan).toHaveBeenCalledOnce();
    expect(ops.verifyPromotion).toHaveBeenCalledOnce();
    for (const operation of [ops.stopIdleDashboard, ops.publish, ops.syncStaging, ops.deploy, ops.restartDashboard]) {
      expect(operation).not.toHaveBeenCalled();
    }
  });

  it("blocks all release writes while the dashboard is busy", async () => {
    const ops = operations();
    const finishRun = Promise.withResolvers<void>();
    ops.stopIdleDashboard.mockReturnValue(finishRun.promise);
    const releasing = runRelease(false, ops);
    await vi.waitFor(() => expect(ops.stopIdleDashboard).toHaveBeenCalledOnce());
    expect(ops.publish).not.toHaveBeenCalled();
    expect(ops.deploy).not.toHaveBeenCalled();
    expect(ops.restartDashboard).not.toHaveBeenCalled();

    finishRun.resolve();
    await releasing;
    expect(ops.publish).toHaveBeenCalledBefore(ops.syncStaging);
    expect(ops.syncStaging).toHaveBeenCalledBefore(ops.deploy);
    expect(ops.deploy).toHaveBeenCalledBefore(ops.restartDashboard);
  });

  it("reports active runs and returns the idle snapshot only after another read", async () => {
    const busy = { targets: [{ runId: "unfinished" }] };
    const idle = { targets: [] };
    const read = vi.fn<() => Promise<typeof busy>>().mockResolvedValueOnce(busy).mockResolvedValueOnce(idle);
    const wait = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const report = vi.fn();

    await expect(waitForIdleDashboard(read, wait, report)).resolves.toBe(idle);
    expect(report).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Waiting for active dashboard runs"));
    expect(wait).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("refuses all release writes if the production gate fails", async () => {
    const ops = operations();
    ops.verifyPromotion.mockRejectedValue(new Error("Production check must pass"));
    await expect(runRelease(false, ops)).rejects.toThrow("Production check must pass");
    expect(ops.stopIdleDashboard).not.toHaveBeenCalled();
    expect(ops.publish).not.toHaveBeenCalled();
    expect(ops.deploy).not.toHaveBeenCalled();
  });
});
