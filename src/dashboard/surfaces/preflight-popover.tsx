import { Stethoscope } from "lucide-react";
import { dsIcon, IconButton, Popover, PopoverContent, PopoverTrigger } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { type PreflightCheckWire, preflightVerdict, useDoctorPreflight } from "./preflight-popover-model.js";
import { PreflightReportContent } from "./settings-preflight.js";

/** Bootstrap rows are historical only; the shared served report owns current readiness. */
export function PreflightPopover(_props: { checks?: readonly PreflightCheckWire[]; onRerun?: () => void }) {
  const doctor = useDoctorPreflight();
  const verdict = doctor.preflight.state === "completed" ? preflightVerdict(doctor.preflight.checks) : "unavailable";
  return <Popover onOpenChange={open => { if (open) void doctor.refresh(); }}>
    <PopoverTrigger asChild>
      <IconButton size="sm" label={`Preflight: ${doctor.preflight.state === "running" ? "running" : verdict}`}
        icon={<Stethoscope aria-hidden className={dsIcon.md} />}
        className={cn(verdict === "fail" && "text-[color:var(--ds-danger)]", verdict === "warning" && "text-[color:var(--ds-status-waiting-fg)]")} />
    </PopoverTrigger>
    <PopoverContent title="Preflight" width="lg" side="bottom" align="end" className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto">
      <PreflightReportContent preflight={doctor.preflight} onRerun={doctor.rerunPreflight} />
    </PopoverContent>
  </Popover>;
}
