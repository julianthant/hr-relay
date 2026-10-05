import { createContext, useEffect, type RefObject } from "react";

export const SettingsSearchTargetContext = createContext<{ target?: string; visit: number }>({ visit: 0 });

export function useSettingsSearchArrival(content: RefObject<HTMLDivElement | null>, target: string | undefined, visit: number, section: string | undefined, label?: string): void {
  useEffect(() => {
    const container = content.current;
    if (container === null || target === undefined) return undefined;
    let row: HTMLElement | undefined;
    let previousAttributes: (readonly [string, string | null])[] = [];
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new MutationObserver(() => schedule());
    const arrive = () => {
      const found = [...container.querySelectorAll<HTMLElement>("[data-settings-path]")].find(element => element.dataset.settingsPath === target);
      if (found === undefined || found.getClientRects().length === 0) return;
      observer.disconnect();
      row = found;
      previousAttributes = ["tabindex", "role", "aria-label"].map(name => [name, found.getAttribute(name)] as const);
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      row.scrollIntoView({ block: "center", inline: "nearest", behavior: reducedMotion ? "instant" : "smooth" });
      row.setAttribute("tabindex", "-1");
      if (label !== undefined) { row.setAttribute("role", "group"); row.setAttribute("aria-label", label); }
      row.focus({ preventScroll: true });
      row.classList.remove("settings-search-arrival");
      // Restart the brief arrival cue when the same result is selected again.
      void row.offsetWidth;
      row.classList.add("settings-search-arrival");
      timer = setTimeout(() => row?.classList.remove("settings-search-arrival"), 1400);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(arrive); };
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "hidden", "style"] });
    schedule();
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer); row?.classList.remove("settings-search-arrival");
      for (const [name, value] of previousAttributes) { if (value === null) row?.removeAttribute(name); else row?.setAttribute(name, value); }
    };
  }, [content, target, visit, section, label]);
}
