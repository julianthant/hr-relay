import { useRef, type ReactNode } from "react";
import { FirstScreenRevealedContext, useFirstScreen, type StartupDeadline } from "../../app/startup/first-screen.js";
import { DashboardClientProvider, useDashboardClient } from "../../state/client-context.js";
import { dsText } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { AppLockup } from "./app-lockup.js";
import "./startup-loading.css";

/**
 * One loader from app start to the finished first screen: the dashboard mounts hidden beneath it
 * and appears once it has its data. The 1fr/auto/1fr grid keeps the lockup still while the bar loops.
 */
/** `startDeadline` opens each mount's deadline, shared with ports built above the loader so their first-screen reads expire with it. */
export function StartupLoading({ children, startDeadline }: { children?: ReactNode; startDeadline?: () => StartupDeadline }) {
  const screen = useRef<HTMLDivElement>(null);
  const mounted = children !== undefined;
  const { revealed, slow, client } = useFirstScreen(screen, mounted, useDashboardClient(), startDeadline);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {!revealed && <main data-startup-loading role="status" aria-label="Starting Relay" aria-busy="true"
        className="absolute inset-0 grid grid-rows-[1fr_auto_1fr] justify-items-center bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]">
        <div />
        <div className="flex items-center gap-2 text-[length:var(--ds-text-section)] font-semibold"><AppLockup /></div>
        <div className="flex flex-col items-center gap-[var(--ds-space-loose)] pt-[var(--ds-space-loose)]">
          <div className="startup-bar" aria-hidden />
          {slow && <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Taking longer than usual</p>}
        </div>
      </main>}
      {mounted && <div ref={screen} className={cn("flex min-h-0 flex-1 flex-col", !revealed && "invisible")} inert={!revealed} aria-hidden={!revealed || undefined}>
        <FirstScreenRevealedContext.Provider value={revealed}><DashboardClientProvider client={client}>{children}</DashboardClientProvider></FirstScreenRevealedContext.Provider>
      </div>}
    </div>
  );
}
