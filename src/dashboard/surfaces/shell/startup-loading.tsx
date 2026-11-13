import { AppLockup } from "./app-lockup.js";
import "./startup-loading.css";

/** The 1fr/auto/1fr grid keeps the lockup still while the bar loops and when the dashboard replaces it. */
export function StartupLoading() {
  return (
    <main data-startup-loading role="status" aria-label="Starting Relay" aria-busy="true"
      className="grid min-h-0 flex-1 grid-rows-[1fr_auto_1fr] justify-items-center bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]">
      <div />
      <div className="flex items-center gap-2 text-[length:var(--ds-text-section)] font-semibold"><AppLockup /></div>
      <div className="pt-[var(--ds-space-loose)]"><div className="startup-bar" aria-hidden /></div>
    </main>
  );
}
