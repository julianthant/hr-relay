/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoEvidence.tsx (`SystemChip`,
 * `SystemTag`) and demo-data.ts (`SYSTEM_CHIP` / `SYSTEM_ACCENT`). Only these
 * shared atoms are ported here; the rest of DemoEvidence defers to 2g.
 *
 * Typed against the rebuild's closed `BrowserSystemId` enum instead of the
 * demo's `SystemKey`, with an explicit label map — the demo's bare
 * `toUpperCase()` would render `NEW-KRONOS` for a closed id whose operator
 * name is two words.
 */
import { z } from "zod";
import { cn } from "../lib/utils.js";
import { dsClip, dsRadius, dsText } from "../ds/ui.js";
import { BrowserSystemIdSchema } from "../../domain/ids.js";

export type BrowserSystemId = z.infer<typeof BrowserSystemIdSchema>;

const SYSTEM_CHIP =
  "border border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] text-[color:var(--ds-recess-fg)]";

/** Closed presentation labels for the closed system enum. */
export const SYSTEM_LABEL: Record<BrowserSystemId, string> = {
  ucpath: "UCPATH",
  crm: "CRM",
  onbase: "ONBASE",
  kuali: "KUALI",
  servicenow: "SERVICENOW",
  i9: "I9",
  "new-kronos": "NEW KRONOS",
  "old-kronos": "OLD KRONOS",
  sharepoint: "SHAREPOINT",
};

/**
 * The dense system marker used inside a stream or a ledger row — the same atom
 * on the log line and on the Data row, so a `UCPATH` beside a value in the
 * rail and a `UCPATH` beside a line in the stream read as one thing.
 */
export function SystemChip({ system, className }: { system: BrowserSystemId; className?: string }) {
  return (
    <span
      className={cn(
        // 9px is below the type floor — the system a line came from is a fact
        // the operator reads, not a watermark. `micro` (10px) is the smallest
        // size in the system and the one every other count badge uses.
        "mr-[var(--ds-space-tight)] inline-block px-[var(--ds-space-tight)] align-[1px] font-bold",
        dsClip.token,
        dsRadius.xs,
        dsText.caps,
        SYSTEM_CHIP,
        className,
      )}
    >
      {SYSTEM_LABEL[system]}
    </span>
  );
}

/** the system a fact came from, with the `test` instance called out loud */
export function SystemTag({ system, instance }: { system?: BrowserSystemId; instance?: "prod" | "test" }) {
  if (!system) return null;
  return (
    <span className={cn("inline-flex items-center gap-[var(--ds-space-hair)]", dsText.caps, "text-[color:var(--ds-fg-muted)]")}>
      {SYSTEM_LABEL[system]}
      {instance === "test" && (
        <span className="text-[color:var(--ds-status-waiting-fg)]">· TEST</span>
      )}
    </span>
  );
}
