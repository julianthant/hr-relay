import type { ReactNode } from "react";
import { PreflightActionsContext, type PreflightActions } from "./preflight-actions-model.js";
export function PreflightActionsProvider({ actions, children }: { actions: PreflightActions; children: ReactNode }) {
  return <PreflightActionsContext.Provider value={actions}>{children}</PreflightActionsContext.Provider>;
}
