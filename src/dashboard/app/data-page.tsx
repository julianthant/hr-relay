import { useEffect, useRef, type ReactNode } from "react";
import { DsBodyScope, dsSurface } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import "../surfaces/settings/settings-data.css";
import "../surfaces/settings/hub-settings.css";

const HEADING_FOCUS = "w-fit rounded-sm";
const PAGE_LABEL = { spreadsheets: "Spreadsheets", explore: "Explorer", activity: "Analytics" } as const;

/** A data page in the main region: it replaces the queue and Logs, and focus lands on its heading on arrival. */
export function DataPage({ page, children }: { page: keyof typeof PAGE_LABEL; children: ReactNode }) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const heading = region.current?.querySelector<HTMLElement>("h1");
      if (heading === null || heading === undefined) { region.current?.focus({ preventScroll: true }); return; }
      heading.tabIndex = -1;
      heading.classList.add(...HEADING_FOCUS.split(" "));
      heading.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [page]);
  return (
    // `settings-takeover` carries the page-heading and row rules every full page shares with Settings.
    <div className="settings-takeover flex min-h-0 min-w-0 flex-1">
    <div ref={region} tabIndex={-1} aria-label={PAGE_LABEL[page]} role="region" data-data-page={page}
      className={cn("settings-content flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-[var(--ds-space-section)] py-[var(--ds-space-page)]", dsSurface.bodyPage)}>
      <DsBodyScope className="settings-tab-body flex flex-col gap-[var(--ds-space-page)]">{children}</DsBodyScope>
    </div>
    </div>
  );
}
