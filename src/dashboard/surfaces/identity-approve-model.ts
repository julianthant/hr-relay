/**
 * Which arm a served gate command resolves
 *
 * It lives beside `identity-approve.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to treat
 * it as a refresh boundary: one non-component export makes every edit to the
 * surface invalidate upward into `dashboard-app.tsx` and remount the app
 * instead of hot-swapping the component.
 */
import type { ActionDescriptorWire } from "../../domain/dashboard/actions.js";

/**
 * Which typed resolution a served descriptor names. Nothing else may open this
 * dialog — the wire's own `superRefine` already pins every action on this
 * section to a `resolve-gate` at the run's exact version, so an action that
 * names no resolution is a descriptor that changed shape under a surface
 * mid-flight, not a control to guess at.
 */
export function identityGateArm(action: ActionDescriptorWire): "approved" | "rejected" | undefined {
  if (action.kind !== "command" || action.command !== "resolve-gate") return undefined;
  return action.resolution;
}
