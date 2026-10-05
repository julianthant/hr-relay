import { useCallback, useEffect, useState } from "react";
import type { z } from "zod";
import type { RunDetailWireSchema } from "../../../domain/dashboard/run-detail.js";
import type { ActionDescriptorWire } from "../../../domain/dashboard/actions.js";
import type { PanelSections } from "./sections.js";
import type { DashboardActionHandler } from "../shared/actions/actions.js";
import type { IdentityApproveTarget } from "./identity/identity-approve.js";
import { identityGateArm } from "./identity/identity-approve-model.js";
import type { ParkResolveTarget, ParkedWritePayload } from "./resolution/park-resolve.js";
import { parkResolutionArm } from "./resolution/park-resolve-model.js";
type RunDetailWire = z.infer<typeof RunDetailWireSchema>;
export function useSeekAnchor(active: boolean, block: ScrollLogicalPosition = "center"): {
  setNode: (node: HTMLElement | null) => void;
  inView: boolean;
  seek: () => void;
} {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!active || node === null) {
      setInView(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      // No observer: assume the decision is NOT visible, so the notice shows.
      // Failing toward "reachable" is the only safe direction for something a
      // run is blocked on.
      setInView(false);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.3 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [active, node]);

  const seek = useCallback(() => {
    if (node === null) return;
    const reduced =
      typeof window !== "undefined"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({ block, behavior: reduced ? "auto" : "smooth" });
    node.focus({ preventScroll: true });
  }, [node, block]);

  return { setNode, inView, seek };
}

export function useGateParkResolution(input: Readonly<{
  detail: RunDetailWire;
  sections: PanelSections;
}>): Readonly<{
  gateSection: PanelSections["identity-gate"];
  gateActions: readonly ActionDescriptorWire[];
  parked: ParkedWritePayload | undefined;
  gateTarget: IdentityApproveTarget | null;
  parkTarget: ParkResolveTarget | null;
  setGateTarget: (target: IdentityApproveTarget | null) => void;
  setParkTarget: (target: ParkResolveTarget | null) => void;
  onResolveGate: DashboardActionHandler;
  onResolvePark: DashboardActionHandler;
}> {
  const gateSection = input.sections["identity-gate"];
  const gateActions = gateSection?.state === "available" ? gateSection.value.actions : [];
  const parked = input.sections["parked-write"];
  const [gateTarget, setGateTarget] = useState<IdentityApproveTarget | null>(null);
  const [parkTarget, setParkTarget] = useState<ParkResolveTarget | null>(null);
  useEffect(() => {
    setGateTarget(null);
    setParkTarget(null);
  }, [input.detail.runId]);

  const onResolveGate = useCallback<DashboardActionHandler>((action) => {
    if (gateSection?.state !== "available") {
      throw new Error(
        `action ${action.key} was pressed while the identity-gate section is `
        + `${gateSection?.state ?? "absent"}; there is no packet to answer`,
      );
    }
    if (identityGateArm(action) === undefined || action.kind !== "command") {
      throw new Error(
        `the identity-gate section served ${action.key}, which names no ref write-safety §14.4 resolution`,
      );
    }
    setGateTarget({ gate: gateSection, action });
  }, [gateSection]);

  const onResolvePark = useCallback<DashboardActionHandler>((action) => {
    if (parked === undefined) return;
    if (parkResolutionArm(action) === undefined || action.kind !== "command") {
      throw new Error(
        `the parked-write section served ${action.key}, which is not a ref write-safety §4.1 resolution`,
      );
    }
    setParkTarget({ parked, action });
  }, [parked]);

  return {
    gateSection,
    gateActions,
    parked,
    gateTarget,
    parkTarget,
    setGateTarget,
    setParkTarget,
    onResolveGate,
    onResolvePark,
  };
}
