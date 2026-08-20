/**
 * Which resolution a served park command names
 *
 * It lives beside `park-resolve.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";

/** Which typed resolution a descriptor names. Nothing else may open this dialog. */
export function parkResolutionArm(action: ActionDescriptorWire): "present" | "absent" | undefined {
  if (action.kind !== "command") return undefined;
  if (action.command === "resolve-write-present") return "present";
  if (action.command === "resolve-write-absent") return "absent";
  return undefined;
}
