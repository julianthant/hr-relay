import { useLayoutEffect, type RefObject } from "react";

export function useTabIndicator(list: RefObject<HTMLDivElement | null>, indicator: RefObject<HTMLSpanElement | null>): void {
  useLayoutEffect(() => {
    const container = list.current, marker = indicator.current;
    if (container === null || marker === null) return undefined;
    const update = () => {
      const active = container.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (active === null || active.getClientRects().length === 0) { marker.hidden = true; return; }
      marker.hidden = false;
      marker.style.transform = `translateX(${active.offsetLeft}px) scaleX(${active.offsetWidth})`;
    };
    const resize = new ResizeObserver(update);
    const observe = () => {
      resize.disconnect(); resize.observe(container);
      for (const tab of container.querySelectorAll('[role="tab"]')) resize.observe(tab);
      update();
    };
    const mutations = new MutationObserver(observe);
    mutations.observe(container, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["data-state"] });
    observe();
    container.dataset.indicatorReady = "true";
    return () => { resize.disconnect(); mutations.disconnect(); delete container.dataset.indicatorReady; };
  }, [list, indicator]);
}
