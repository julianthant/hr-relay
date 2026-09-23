import type { RunDetailTrustDeps } from "../run-detail-types.js";
import type { RunRecord } from "../../../../domain/run/record.js";
import type { RunFoldRecord } from "../../projectors/run-queue-projection.js";
import type { RunCaptureAvailabilityWire } from "../../../../domain/dashboard/run-detail.js";

export function availableSections(
  _row: RunFoldRecord | undefined,
  authority: RunRecord,
  trust?: RunDetailTrustDeps,
  captures?: RunCaptureAvailabilityWire,
): readonly ("logs" | "receipt" | "context-data" | "context-attempts" | "failure" | "captures" | "parked-write" | "identity-gate")[] {
  const { lifecycle } = authority;
  const terminal = lifecycle.state === "terminal";
  const settled = terminal && lifecycle.outcome !== "interrupted";
  return [
    "logs",
    ...(settled && trust !== undefined ? (["receipt"] as const) : []),
    "context-data",
    "context-attempts",
    ...(terminal && lifecycle.outcome === "failed" && trust !== undefined
      ? (["failure"] as const)
      : []),
    ...(captures?.state === "available" ? (["captures"] as const) : []),
    ...(lifecycle.state === "parked-write" ? (["parked-write"] as const) : []),
    /*
     * Every `parked-gate` run advertises the section, and the payload is a wire
     * RESOURCE: a run parked on a gate whose evidence node stored no identity
     * packet answers `missing` with the reason, exactly as `receipt` does for a
     * composition without the trust seam. Advertising only for gates this query
     * can fully serve would need the descriptor here, and would make "no gate
     * section" indistinguishable from "the packet is gone" — which is the
     * absence-versus-failure conflation this program bans.
     */
    ...(lifecycle.state === "parked-gate" ? (["identity-gate"] as const) : []),
  ];
}
