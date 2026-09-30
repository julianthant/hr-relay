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


import type { IdentityGateDetail } from "../app/identity-ceremony.js";

const JOB_DISPOSITION_LABEL = {
  "single-active-job": "One active job", "no-active-job": "No active jobs",
  "concurrent-active-jobs": "Multiple active jobs", "indeterminate-status": "Employment status unknown",
} as const;

export function identityComparisonRows(gate: IdentityGateDetail) {
  const { packet } = gate;
  return packet.comparisons.map(row => {
    switch (row.field) {
      case "name": return { ...row, label: "Name" };
      case "eid": return { ...row, label: "Employee ID" };
      case "employment": return { ...row, label: "Employment", documentValue: "Separation request", ucpathValue: `${JOB_DISPOSITION_LABEL[packet.jobs.disposition]} · ${String(packet.jobs.rowCount)} record(s)` };
      case "name-search": return { ...row, label: "Name search", documentValue: packet.documentName,
        ucpathValue: packet.nameSearch.status === "resolved" ? `${packet.nameSearch.candidate.name} · ${packet.nameSearch.candidate.eid}`
          : packet.nameSearch.status === "ambiguous" ? `Multiple candidates · ${packet.nameSearch.candidateEids.join(", ")}` : "No matching employee" };
    }
  });
}
