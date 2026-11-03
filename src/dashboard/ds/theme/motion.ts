import { useCallback, useEffect, useLayoutEffect } from "react";
import { usePersonPreferences, type PersonPreferencesPort } from "../../lib/person-preferences.js";

export function useHubMotion(port?: PersonPreferencesPort) {
  const preferences = usePersonPreferences(port);
  const motion = preferences.value.animations ? "on" : "off";
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
  const save = preferences.change;
  const change = useCallback((enabled: boolean) => { void save?.({ "preferences.animations": { set: enabled } }); }, [save]);
  return { enabled: preferences.value.animations, change, problem: preferences.problem };
}
