import { useEffect, useRef } from "react";

const DIALOG = '[role="dialog"].launch-dialog';

/** Keeps a keyboard user inside the dialog when the control holding focus is disabled or replaced (Continue becoming a Start that is off, Start going busy):
 * the browser would drop focus to the page, and Tab from there leaves the dialog's controls out of reach. Focus moves to the dialog's surface. */
export function useKeepFocusInDialog(active: boolean): void {
  const held = useRef(false);
  useEffect(() => {
    const dialog = active ? document.querySelector<HTMLElement>(DIALOG) : null;
    if (dialog === null) { held.current = false; return; }
    const focused = document.activeElement;
    if (focused !== null && focused !== document.body && !(focused instanceof HTMLButtonElement && focused.disabled)) { held.current = dialog.contains(focused); return; }
    if (held.current) dialog.focus({ preventScroll: true });
  });
}
