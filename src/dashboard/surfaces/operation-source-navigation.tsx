import { useEffect, useState, type ReactNode } from "react";
import type { OperationActionObservationWire } from "../../domain/dashboard/operation-structure.js";
import { Button } from "../ds/ui.js";
import { operationAddress } from "./operation-structure-model.js";
import { OperationSourceContext } from "./operation-source-navigation-model.js";

export function OperationSourceNavigation({ observations, onReveal, children }: { onReveal?: () => void; observations: readonly OperationActionObservationWire[]; children: ReactNode }) {
  const [target, setTarget] = useState<{ address: string; trigger: HTMLButtonElement }>();
  const returnToValue = () => { target?.trigger.scrollIntoView({ block: "center" }); target?.trigger.focus(); setTarget(undefined); };
  useEffect(() => {
    if (target === undefined) return;
    let second: number | undefined;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => {
      const row = document.getElementById(`operation-${target.address}`);
      row?.scrollIntoView({ block: "center" }); row?.focus();
    }); });
    return () => { cancelAnimationFrame(first); if (second !== undefined) cancelAnimationFrame(second); };
  }, [target]);
  return <OperationSourceContext.Provider value={{ address: target?.address, contains: (identity) => observations.some((item) => operationAddress(item.occurrence) === operationAddress(identity)), jump: (identity, trigger) => { onReveal?.(); setTarget({ address: operationAddress(identity), trigger }); } }}>
    <div className="operation-source-region" onKeyDown={(event) => { if (event.key === "Escape" && target !== undefined) { event.stopPropagation(); returnToValue(); } }}>
      {target !== undefined && <div className="operation-source-return"><Button size="toolbar" variant="secondary" onClick={returnToValue}>Return to value</Button></div>}
      {children}
    </div>
  </OperationSourceContext.Provider>;
}
