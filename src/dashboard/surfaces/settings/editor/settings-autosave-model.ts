import { useCallback, useEffect, useRef } from "react";

export type SettingsBlurEvent = Readonly<{ target: EventTarget | null; relatedTarget: EventTarget | null }>;

export function blurredSettingsPath(event: SettingsBlurEvent): string | undefined {
  if (!(event.target instanceof HTMLElement) || !event.target.matches('input, textarea, [role="spinbutton"]')) return undefined;
  const field = event.target.closest<HTMLElement>("[data-settings-path]");
  if (field === null || (event.relatedTarget instanceof Node && field.contains(event.relatedTarget))) return undefined;
  return field.dataset.settingsPath;
}

/** The browser drops focus from a control the save lock just disabled; that loss is not an operator choice. */
function lostToDisabling(element: HTMLElement): boolean {
  return element.matches(":disabled") || element.getAttribute("aria-disabled") === "true" || element.closest("[aria-disabled='true'], [data-disabled]") !== null;
}

/** Owns a Settings form's blur flush and keeps keyboard focus across its save lock. */
export function useSettingsFormFocus<T extends HTMLElement>(locked: boolean, onFieldBlur: (event: SettingsBlurEvent) => void): (element: T | null) => () => void {
  const lockedRef = useRef(locked);
  const displaced = useRef<HTMLElement | null>(null);
  const flush = useRef(onFieldBlur);
  useEffect(() => { flush.current = onFieldBlur; }, [onFieldBlur]);
  const attach = useCallback((element: T | null) => {
    const focusOut = (event: FocusEvent): void => {
      if (event.relatedTarget === null && event.target instanceof HTMLElement && (lockedRef.current || lostToDisabling(event.target))) displaced.current = event.target;
      flush.current(event);
    };
    const focusIn = (): void => { displaced.current = null; };
    element?.addEventListener("focusout", focusOut);
    document.addEventListener("focusin", focusIn);
    return () => { element?.removeEventListener("focusout", focusOut); document.removeEventListener("focusin", focusIn); };
  }, []);
  useEffect(() => {
    lockedRef.current = locked;
    const target = displaced.current;
    if (locked || target === null) return;
    displaced.current = null;
    const active = document.activeElement;
    if (!target.isConnected || (active !== null && active !== document.body)) return;
    target.focus({ preventScroll: true });
  }, [locked]);
  return attach;
}
