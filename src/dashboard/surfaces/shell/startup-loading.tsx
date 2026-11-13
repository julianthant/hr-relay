import { Skeleton, Spinner } from "../../ds/ui.js";
import { DashboardSkeleton } from "../shared/loading/loading.js";
import { AppLockup } from "./app-lockup.js";

export type StartupLoadingVariant = "mark" | "bar" | "shell";

/** Default `mark` is the recommended variant; the same 1fr/auto/1fr grid in every variant keeps the lockup still. */
export function StartupLoading({ variant = "mark" }: { variant?: StartupLoadingVariant }) {
  if (variant === "shell") return <main data-startup-loading={variant} className="flex min-h-0 flex-1 flex-col bg-[color:var(--ds-surface-page)]"><DashboardSkeleton /></main>;
  return (
    <main data-startup-loading={variant} role="status" aria-label="Starting Relay" aria-busy="true"
      className="grid min-h-0 flex-1 grid-rows-[1fr_auto_1fr] justify-items-center bg-[color:var(--ds-surface-page)] text-[color:var(--ds-fg)]">
      <div />
      <div className="flex items-center gap-2 text-[length:var(--ds-text-section)] font-semibold"><AppLockup /></div>
      <div className="pt-[var(--ds-space-loose)]">
        {variant === "mark" ? <Spinner label="Starting Relay" /> : <Skeleton className="h-0.5 w-40 rounded-full" />}
      </div>
    </main>
  );
}
