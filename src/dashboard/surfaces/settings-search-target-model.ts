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
      const group = found.closest<HTMLElement>(".ds-form-group");
      if (group !== null) {
        const bounds = found.getBoundingClientRect(), frame = group.getBoundingClientRect(), style = getComputedStyle(group);
        const border = parseFloat(style.borderLeftWidth), padding = parseFloat(style.paddingLeft);
        if (bounds.width >= frame.width - 2 * (border + padding) - 1) {
          found.style.setProperty("--settings-arrival-left", `${frame.left + border - bounds.left}px`);
          found.style.setProperty("--settings-arrival-right", `${bounds.right - frame.right + border}px`);
        }
      }
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
      const clearCue = () => { row?.classList.remove("settings-search-arrival"); row?.style.removeProperty("--settings-arrival-left"); row?.style.removeProperty("--settings-arrival-right"); };
      timer = setTimeout(clearCue, 1400);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(arrive); };
    observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "hidden", "style"] });
    schedule();
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer); row?.classList.remove("settings-search-arrival");
      row?.style.removeProperty("--settings-arrival-left"); row?.style.removeProperty("--settings-arrival-right");
      for (const [name, value] of previousAttributes) { if (value === null) row?.removeAttribute(name); else row?.setAttribute(name, value); }
    };
  }, [content, target, visit, section, label]);
}
