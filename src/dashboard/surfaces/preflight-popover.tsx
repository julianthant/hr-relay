import {
ListChecks,
Stethoscope
} from "lucide-react";
import { Badge,Button,dsIcon,dsText,IconButton,Popover,PopoverContent,PopoverTrigger } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import {
fmtClock
} from "./format.js";
import { type PreflightCheckWire,type PreflightVerdict,preflightVerdict } from "./preflight-popover-model.js";


const PREFLIGHT_TONE: Record<PreflightVerdict, "success" | "warning" | "danger"> = {
  pass: "success",
  warning: "warning",
  fail: "danger",
};


/**
 * The advisory note the demo pins above the check list. It is the whole reason
 * this indicator is on screen rather than filed under a page of preferences.
 */
const PREFLIGHT_ADVISORY_NOTE =
  "Doctor never blocks a run. It tells you what will fail before you spend a Duo prompt finding out. A failing check beside a workflow you are not running today is information, not an error.";


/**
 * THE DOCTOR, as a standing indicator rather than a Settings section.
 *
 * It was a read-only panel plus a "Run doctor again" button with no `onClick`,
 * filed under a page of preferences — so the one thing it is for (knowing what
 * will fail BEFORE you spend a Duo prompt finding out) was three clicks away
 * from where a run is started. Here it is always on screen and its glyph
 * carries the worst verdict of the set.
 *
 * It mounts only when the bootstrap document serves `preflight`
 * (`FrontendBootstrapWireSchema#preflight`, ref frontend-backend-integration
 * §3.1). The current composition always serves its retained report; the
 * optional arm preserves read-forward compatibility with an older producer.
 * No served checks means no stethoscope: a green glyph over checks nobody ran
 * would be a pass verdict the server never made. The strict rerun route is
 * live; this screen keeps its button disabled until DCC3 supplies the typed
 * caller, and names the missing screen control rather than denying the route.
 */
export function PreflightPopover({
  checks,
  onRerun,
}: {
  checks?: readonly PreflightCheckWire[];
  onRerun?: () => void;
}) {
  if (checks === undefined || checks.length === 0) return null;
  const verdict = preflightVerdict(checks);
  const failing = checks.filter((check) => check.verdict === "fail").length;
  const warning = checks.filter((check) => check.verdict === "warning").length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          size="sm"
          label={
            verdict === "pass"
              ? "Preflight: every check passes"
              : `Preflight: ${failing} failing, ${warning} warning`
          }
          icon={<Stethoscope aria-hidden className={dsIcon.md} />}
          className={cn(
            verdict === "fail" && "text-[color:var(--ds-danger)]",
            verdict === "warning" && "text-[color:var(--ds-status-waiting-fg)]",
          )}
        />
      </PopoverTrigger>
      <PopoverContent title="Preflight" description={PREFLIGHT_ADVISORY_NOTE} width="lg" side="bottom" align="end">
        <div className="flex flex-col gap-[var(--ds-space-base)]">
          {checks.map((check) => (
            <div key={check.id} className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
              <div className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
                <Badge tone={PREFLIGHT_TONE[check.verdict]}>{check.verdict}</Badge>
                <span className={cn(dsText.ui, "min-w-0 truncate font-medium text-[color:var(--ds-fg)]")}>
                  {check.label}
                </span>
                <span className={cn(dsText.micro, dsText.nums, "ml-auto shrink-0 text-[color:var(--ds-fg-faint)]")}>
                  {fmtClock(check.checkedAt)}
                </span>
              </div>
              <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>{check.detail}</span>
              {check.blocks.length > 0 && (
                <span className={cn(dsText.meta, "text-[color:var(--ds-status-waiting-fg)]")}>
                  Blocks: {check.blocks.join(" · ")}
                </span>
              )}
              {check.remediation !== undefined && (
                <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Fix: {check.remediation}</span>
              )}
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            icon={<ListChecks aria-hidden className={dsIcon.md} />}
            disabled={onRerun === undefined}
            title={onRerun === undefined
              ? "Current doctor results are available here; rerun is not available from this screen yet"
              : undefined}
            onClick={onRerun}
          >
            Run doctor again
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
