import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { readEnumPreference, writePreference } from "../../lib/preference-storage.js";

const listeners = new Set<() => void>();
let sessionMotion: "on" | "off" | undefined;
const snapshot = () => sessionMotion ?? readEnumPreference("relay.animations", ["on", "off"], "on");
function subscribe(listener: () => void) {
  listeners.add(listener);
  const refresh = (event: StorageEvent) => {
    if (event.key === "relay.animations" || event.key === null) { sessionMotion = undefined; listener(); }
  };
  window.addEventListener("storage", refresh);
  return () => { listeners.delete(listener); window.removeEventListener("storage", refresh); };
}

export function useHubMotion() {
  const motion = useSyncExternalStore(subscribe, snapshot, () => "on");
  const [problem, setProblem] = useState<string>();
  useEffect(() => {
    const pointer = (event: PointerEvent) => {
      document.documentElement.dataset.hubInput = "pointer";
      const control = event.target instanceof Element ? event.target.closest("button,a[href],select,[role=button]") : null;
      if (control instanceof HTMLElement && control === document.activeElement) control.blur();
    };
    const keyboard = () => { document.documentElement.dataset.hubInput = "keyboard"; };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", keyboard, true);
    return () => { document.removeEventListener("pointerdown", pointer, true); document.removeEventListener("keydown", keyboard, true); };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.motion = motion;
    document.documentElement.dataset.hub = "";
  }, [motion]);
  const change = useCallback((enabled: boolean) => {
    const next = enabled ? "on" : "off";
    const result = writePreference("relay.animations", next);
    sessionMotion = next;
    setProblem(result.state === "unavailable" ? "Animations changed for this session. This browser could not save the preference." : undefined);
    listeners.forEach(listener => listener());
  }, []);
  return { enabled: motion === "on", change, problem };
}
