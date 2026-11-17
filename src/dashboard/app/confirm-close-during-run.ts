import { useEffect } from "react";
import type { PersonPreferences } from "../../models/config/person-preferences.js";

export interface BeforeUnloadTarget {
  addEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
  removeEventListener(type: "beforeunload", listener: (event: BeforeUnloadEvent) => void): void;
}

export function closeNeedsConfirmation(mode: PersonPreferences["confirmCloseDuringRun"], runActive: boolean): boolean {
  return mode === "always" || (mode === "active-run" && runActive);
}

function askBeforeUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  Reflect.set(event, "returnValue", "");
}

/** Registers the browser's before-unload prompt only while the setting calls for it. */
export function useConfirmCloseDuringRun(mode: PersonPreferences["confirmCloseDuringRun"], runActive: boolean, target: BeforeUnloadTarget = window): void {
  const confirm = closeNeedsConfirmation(mode, runActive);
  useEffect(() => {
    if (!confirm) return undefined;
    target.addEventListener("beforeunload", askBeforeUnload);
    return () => target.removeEventListener("beforeunload", askBeforeUnload);
  }, [confirm, target]);
}
