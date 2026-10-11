
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  assertDashboardPerformanceStructuralBounds,
  DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS,
  type DashboardPerformanceStructuralCounters,
} from "./dashboard-benchmark.js";

describe("the §7.4 dashboard perf fixture", () => {
  it("accepts the ratified non-duration structural performance bounds", () => {
    assert.doesNotThrow(() => assertDashboardPerformanceStructuralBounds({
      ...DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS,
    }));
  });

  it("refuses every structural performance regression by its exact counter", () => {
    const keys: readonly (keyof DashboardPerformanceStructuralCounters)[] = [
      "dayWireStatements",
      "rowPatchDayWireParses",
      "logsSpanEventParses",
      "logsFilesInScope",
      "runSnapshotStatements",
      "memberPreviewDeltaStatements",
    ];
    for (const key of keys) {
      const broken = {
        ...DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS,
        [key]: DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS[key] + 1,
      };
      assert.throws(
        () => assertDashboardPerformanceStructuralBounds(broken),
        new RegExp(`dashboard performance ${key} must`),
        key,
      );
    }
  });
});
