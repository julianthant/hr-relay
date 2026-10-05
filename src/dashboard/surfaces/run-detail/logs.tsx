import { cn } from "../../lib/utils.js";
import type { QueueSurfaceWire } from "./identity/run-identity.js";

export function RunLivenessDot({ status }: { status: QueueSurfaceWire["status"] }) {
  const live = status === "running";
  return (
    <span className="inline-flex shrink-0 items-center">
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          live
            ? "animate-pulse bg-[var(--ds-status-running-mark)] motion-reduce:animate-none"
            : "bg-[var(--ds-fg-faint)]",
        )}
      />
      <span className="sr-only">{live ? "live" : "idle"}</span>
    </span>
  );
}
