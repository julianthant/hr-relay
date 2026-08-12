/**
 * Settings (doc 03 §2.5, 2i-D): the gear in the top bar, and the one section
 * the bootstrap serves today — Storage.
 *
 * Storage is READ-ONLY health: the bootstrap summary at rest (age/health,
 * §2.5's "expose age/health in Settings"), and the full read-only doctor on
 * demand — authority inspection, pending durable work, byte-re-verified
 * backup health, restore candidates, and what the live backup service last
 * did. Editable settings stay a deferred command family (`apply-settings`),
 * so nothing here pretends to save; the section list itself comes from the
 * SERVER's `settingsSections`, and a served section this build cannot render
 * says so by name instead of disappearing.
 */
import { useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import type { z } from "zod";
import type {
  SettingsSectionPrimitiveSchema,
  StorageHealthSummaryWireSchema,
} from "../../domain/dashboard/bootstrap.js";
import type { StorageDoctorWire } from "../../domain/dashboard/storage.js";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogTrigger,
  IconButton,
  MetaLine,
  SectionLabel,
  StatusDot,
  dsIcon,
  dsText,
  type DsStatus,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useDashboardClient } from "../state/client-context.js";
import { fmtClock, plural } from "./format.js";

export type StorageHealthSummary = z.infer<typeof StorageHealthSummaryWireSchema>;
export type SettingsSection = z.infer<typeof SettingsSectionPrimitiveSchema>;

/** The at-rest indicator tones; the words themselves render beside the dots. */
function authorityStatusOf(authority: StorageHealthSummary["authority"]): DsStatus {
  return authority === "healthy" ? "verifiedDone" : "failed";
}

function backupStatusOf(backup: StorageHealthSummary["backup"]): DsStatus {
  if (backup === "current") return "verifiedDone";
  if (backup === "stale") return "waiting";
  return "failed";
}

/** True when the top-bar gear should carry the attention dot. */
export function storageNeedsAttention(storage: StorageHealthSummary): boolean {
  return storage.authority !== "healthy" || storage.backup !== "current";
}

/**
 * A degraded dashboard says so on EVERY view, not only on the page that
 * explains it — so this is mounted above the takeover switch, and the queue,
 * the intake workspace, the archive, the explorer, the catalog and the
 * activity report all carry it.
 *
 * Ported in SHAPE from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `src/dashboard/components/dev/rebuild-demo/DemoSettings.tsx` (`DemoStorageBanner`).
 * The COPY is not ported. The demo's banner disclosed two lists — what still
 * works and what is blocked — authored against a demo's `StorageMode`, and
 * every line of them would have been a claim about a system nobody had asked.
 * What this one says is derived from the three facts the bootstrap actually
 * serves (`authority`, `backup`, `checkedAt`) and nothing else.
 *
 * It is a HAZARD, which is one of D24's two exemptions from "a professional
 * dashboard does not explain itself": it names the state, the one consequence
 * that changes what the operator should do next, and the route to the doctor.
 * There is no third sentence, no disclosure, and no defence of the design.
 *
 * The two hazards are deliberately not the same volume. An unreachable
 * authority stops the work; a stale or missing backup does not, and saying so
 * in the same breath is the whole point — an operator who cannot tell them
 * apart either stops when they did not need to or keeps filing real HR
 * transactions when they should not.
 */
const AUTHORITY_HAZARD = "Nothing durable can be read or recorded.";
const BACKUP_HAZARD: Record<Exclude<StorageHealthSummary["backup"], "current">, string> = {
  stale: "Runs and writes are unaffected; the newest verified backup is older than the backup cadence allows.",
  missing: "Runs and writes are unaffected; no verified backup was found, so there is no restore point.",
};

export function StorageBanner({
  storage,
  onOpenSettings,
  className,
}: {
  storage: StorageHealthSummary;
  onOpenSettings: () => void;
  /** the shell's own edge — the band does not know where it is mounted */
  className?: string;
}) {
  if (!storageNeedsAttention(storage)) return null;
  const stopped = storage.authority !== "healthy";
  const backupHazard = storage.backup === "current" ? undefined : BACKUP_HAZARD[storage.backup];
  return (
    <Banner
      className={cn("shrink-0", className)}
      tone={stopped ? "danger" : "warning"}
      title={
        stopped
          ? "Authority storage is unavailable"
          : storage.backup === "stale"
            ? "The newest backup is stale"
            : "Storage has no restore point"
      }
      action={
        <Button size="sm" variant="secondary" onClick={onOpenSettings}>
          Storage health
        </Button>
      }
    >
      <span className="flex flex-col gap-[var(--ds-space-tight)]">
        <span>
          {stopped ? AUTHORITY_HAZARD : backupHazard}
          {/* Both facts, when both are true. The authority sentence leads
              because it is the one that changes what happens next. */}
          {stopped && backupHazard !== undefined ? ` ${backupHazard}` : ""}
        </span>
        <MetaLine items={[`checked ${fmtClock(storage.checkedAt)}`]} />
      </span>
    </Banner>
  );
}

function fmtAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${String(minutes)}m`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

type DoctorState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "loaded"; report: StorageDoctorWire }
  | { state: "failed"; message: string };

function HealthLine({ status, label, value }: { status: DsStatus; label: string; value: string }) {
  return (
    <span className="flex items-center gap-[var(--ds-space-snug)]">
      <StatusDot status={status} />
      <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{label}</span>
      <span className={cn(dsText.body, "font-medium text-[color:var(--ds-fg)]")}>{value}</span>
    </span>
  );
}

const COUNT_LABELS = [
  ["pendingCommands", "pending commands"],
  ["unresolvedWriteIntents", "unresolved write intents"],
  ["leases", "leases"],
  ["durableOutbox", "durable outbox"],
  ["runTerminalOutbox", "terminal outbox"],
  ["providerReservations", "provider reservations"],
  ["artifactOutbox", "artifact outbox"],
  ["captureFinalizationOutboxes", "capture finalizations"],
] as const;

function DoctorReport({ report }: { report: StorageDoctorWire }) {
  const counts = report.counts;
  return (
    <div className="flex flex-col gap-[var(--ds-space-base)]">
      <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
        Read-only doctor · checked {fmtClock(report.checkedAt)}
      </span>

      {report.authority.state === "healthy" ? (
        <HealthLine
          status="verifiedDone"
          label="Authority"
          value={`healthy — schema v${String(report.authority.schemaVersion)} · generation ${String(report.authority.authorityGeneration)} · ${plural(report.authority.pageCount, "page")}`}
        />
      ) : (
        <HealthLine
          status="failed"
          label="Authority"
          value={`degraded — ${report.authority.cause.code}: ${report.authority.cause.summary}`}
        />
      )}

      {counts.state === "available" ? (
        <div className="grid grid-cols-2 gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-tight)]">
          {COUNT_LABELS.map(([key, label]) => (
            <span key={key} className="flex items-baseline justify-between gap-[var(--ds-space-base)]">
              <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{label}</span>
              <span className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg)]")}>
                {counts.values[key]}
              </span>
            </span>
          ))}
        </div>
      ) : (
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          Pending counts unavailable — {counts.cause.summary}
        </span>
      )}

      {report.backup.state === "current" || report.backup.state === "stale" ? (
        <HealthLine
          status={report.backup.state === "current" ? "verifiedDone" : "waiting"}
          label="Backup"
          value={`${report.backup.state} — ${report.backup.latest.backupFileName} · age ${fmtAge(report.backup.latest.ageMs)}`
            + (report.backup.latest.generationGap.state === "known"
              ? ` · generation gap ${String(report.backup.latest.generationGap.value)}`
              : ` · generation gap unknown`)}
        />
      ) : (
        <HealthLine
          status="failed"
          label="Backup"
          value={`${report.backup.state} — ${report.backup.cause.summary}`}
        />
      )}

      {report.service.state === "ok" && (
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          Backup service: last run ok at {fmtClock(report.service.finishedAt)} (generation {report.service.finalGeneration})
        </span>
      )}
      {report.service.state === "failed" && (
        <span role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
          Backup service: last run FAILED at {fmtClock(report.service.failedAt)} — {report.service.message}
        </span>
      )}
      {report.service.state === "never-run" && (
        <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
          Backup service: {report.service.reason}
        </span>
      )}

      <div className="flex flex-col gap-[var(--ds-space-tight)]">
        <span className={cn(dsText.meta, "font-medium text-[color:var(--ds-fg-secondary)]")}>
          {plural(report.restoreCandidates.length, "restore candidate")}
        </span>
        {report.restoreCandidates.map((candidate) => (
          <span
            key={candidate.manifestFileName}
            className={cn(dsText.meta, dsText.nums, "text-[color:var(--ds-fg-muted)]")}
          >
            {candidate.state === "verified-compatible"
              ? `ok ${candidate.manifestFileName} — created ${fmtClock(candidate.createdAt)} · generation ${String(candidate.authorityGeneration)} · age ${fmtAge(candidate.ageMs)}`
              : `INVALID ${candidate.manifestFileName} — ${candidate.cause.code}: ${candidate.cause.summary}`}
          </span>
        ))}
      </div>
    </div>
  );
}

function StorageSection({ storage }: { storage: StorageHealthSummary }) {
  const client = useDashboardClient();
  const [doctor, setDoctor] = useState<DoctorState>({ state: "idle" });

  const runDoctor = (): void => {
    setDoctor({ state: "loading" });
    client.storageDoctor().then(
      (report) => setDoctor({ state: "loaded", report }),
      (caught: unknown) => setDoctor({
        state: "failed",
        message: caught instanceof Error ? caught.message : String(caught),
      }),
    );
  };

  return (
    <section aria-label="Storage" className="flex flex-col gap-[var(--ds-space-base)]">
      <SectionLabel>Storage</SectionLabel>
      <HealthLine status={authorityStatusOf(storage.authority)} label="Authority" value={storage.authority} />
      <HealthLine status={backupStatusOf(storage.backup)} label="Backup" value={storage.backup} />
      <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
        Summary checked {fmtClock(storage.checkedAt)} — from the newest write-time-verified backup
        manifest; the doctor below re-verifies bytes.
      </span>
      <span>
        <Button size="sm" onClick={runDoctor} disabled={doctor.state === "loading"} aria-label="Run the read-only storage doctor">
          {doctor.state === "loading" ? "Running doctor…" : "Run storage doctor"}
        </Button>
      </span>
      {doctor.state === "failed" && (
        <span role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
          {doctor.message}
        </span>
      )}
      {doctor.state === "loaded" && <DoctorReport report={doctor.report} />}
    </section>
  );
}

/**
 * The gear, and the one dialog Settings has.
 *
 * `open` is CONTROLLED by the app rather than held here, because the dialog is
 * now reachable from two places — the gear, and the storage banner mounted
 * above every view — and a component's own `useState` cannot be opened by a
 * sibling. Radix still owns focus return: the trigger it returns focus to is
 * the gear, which is on screen in every view the banner is.
 */
export function SettingsControl({
  storage,
  sections,
  open,
  onOpenChange,
}: {
  storage: StorageHealthSummary;
  sections: readonly SettingsSection[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const attention = storageNeedsAttention(storage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <IconButton
          size="sm"
          label={attention ? "Settings — storage needs attention" : "Settings"}
          icon={
            <span className="relative inline-flex">
              <SettingsIcon aria-hidden className={dsIcon.md} />
              {attention && (
                <span aria-hidden className="pointer-events-none absolute right-[-3px] top-[-3px]">
                  <StatusDot status={storage.authority === "healthy" ? "waiting" : "failed"} />
                </span>
              )}
            </span>
          }
        />
      </DialogTrigger>
      <DialogContent title="Settings" size="lg">
        <DialogBody className="flex flex-col gap-[var(--ds-space-loose)]">
          {sections.map((section) => (
            section.id === "storage"
              ? <StorageSection key={section.id} storage={storage} />
              : (
                // A served section without a renderer is a build gap, said by
                // name — never a section that silently vanishes.
                <section key={section.id} aria-label={section.label} className="flex flex-col gap-[var(--ds-space-tight)]">
                  <SectionLabel>{section.label}</SectionLabel>
                  <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                    This build has no renderer for the served section &quot;{section.id}&quot;.
                  </span>
                </section>
              )
          ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
