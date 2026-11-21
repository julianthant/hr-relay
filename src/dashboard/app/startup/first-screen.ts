import { useEffect, useState, type RefObject } from "react";
import { flushSync } from "react-dom";

export const SLOW_STARTUP_MS = 5_000;
export const FIRST_SCREEN_CAP_MS = 30_000;
const STILL_LOADING = '[data-slot="skeleton"], [data-loading-layout], [aria-busy="true"]:not(button)';

/**
 * The startup loader stays over the mounted dashboard until no part of it is still loading, then
 * lifts in one step. A read that never settles releases it after the cap, so only that part shows
 * its own loading state.
 */
export function useFirstScreen(screen: RefObject<HTMLElement | null>, mounted: boolean) {
  const [revealed, setRevealed] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_STARTUP_MS);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const node = screen.current;
    if (!mounted || node === null) { setRevealed(false); return; }
    if (revealed) return;
    const complete = () => node.querySelector(STILL_LOADING) === null;
    // flushSync: the reveal commits in the same task as the last load, so no frame shows the loader over a finished screen.
    const observer = new MutationObserver(() => { if (complete()) flushSync(() => setRevealed(true)); });
    observer.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy", "data-slot", "data-loading-layout"] });
    if (complete()) setRevealed(true);
    const cap = setTimeout(() => setRevealed(true), FIRST_SCREEN_CAP_MS);
    return () => { observer.disconnect(); clearTimeout(cap); };
  }, [screen, mounted, revealed]);
  return { revealed: mounted && revealed, slow };
}
