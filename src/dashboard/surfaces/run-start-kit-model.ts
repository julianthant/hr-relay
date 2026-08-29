/**
 * The instance choice, and the systems it sends to a TEST instance
 *
 * It lives beside `run-start-kit.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import type { z } from "zod";
import type { SystemInstancePrimitiveSchema } from "../../domain/dashboard/bootstrap.js";
import type { SurfaceField } from "../../domain/workflow/ingress.js";
import type { BrowserSystemId } from "./system-chip-model.js";

export type SystemInstancePrimitive = z.infer<typeof SystemInstancePrimitiveSchema>;

export type SystemInstance = "prod" | "test";

/** exactly the shape `StartPlanSubmission.requestedInstance` takes */
export type InstanceChoice = Partial<Record<BrowserSystemId, SystemInstance>>;

export function surfaceValueLabel(constant: SurfaceField): string {
  switch (constant.value.kind) {
    case "text": return constant.value.text;
    case "boolean": return constant.value.value ? "yes" : "no";
    case "count": return String(constant.value.value);
  }
}

/** the systems this choice sends to a TEST instance — the badge every row will carry */
export function testSystemsOf(
  systems: readonly SystemInstancePrimitive[],
  choice: InstanceChoice,
): BrowserSystemId[] {
  return systems
    .map(({ system }) => system)
    .filter((system) => choice[system] === "test");
}
