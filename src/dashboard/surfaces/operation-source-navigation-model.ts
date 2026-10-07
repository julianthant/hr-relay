import { createContext, useContext } from "react";
import type { DeclaredActionIdentity } from "../../rules/workflow/task-provenance.js";

type Navigation = { address?: string; contains: (identity: DeclaredActionIdentity) => boolean; jump: (identity: DeclaredActionIdentity, trigger: HTMLButtonElement) => void };
export const OperationSourceContext = createContext<Navigation | undefined>(undefined);
export const useOperationSourceNavigation = () => useContext(OperationSourceContext);
