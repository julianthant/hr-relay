import {
Database,
Info,
ShieldAlert
} from "lucide-react";
import { useState } from "react";
import type { FrontendBootstrapWire } from "../../domain/dashboard/bootstrap.js";
import type { StorageDoctorWire } from "../../domain/dashboard/storage.js";
import { IconButton,Popover,PopoverContent,PopoverTrigger,Banner,Button,dsFocus,dsIcon,dsText,MetaLine,Panel,PanelBody,PanelHeader,Separator,StatusDot,type DsStatus } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useStorageClient as useDashboardClient } from "../state/storage-client.js";
import { fmtClock,fmtInstantDay,plural } from "./format.js";
import { useEditableSettings } from "./settings-editor-model.js";
import { PreflightControl } from "./settings-preflight.js";
import { STORAGE_RECOVERY_GUIDANCE,spanAuthorityProblemDetail,type StorageHealthSummary } from "./storage-settings-model.js";


/* whether the storage summary owes the operator attention, the nav fold and the
   section resolution all live in `settings-model.ts` — see the note there */

/** The at-rest indicator tones; the words themselves render beside the dots. */
function authorityStatusOf(authority: StorageHealthSummary["authority"]): DsStatus {
  return authority === "healthy" ? "verifiedDone" : "failed";
}


function backupStatusOf(backup: StorageHealthSummary["backup"]): DsStatus {
  if (backup === "current") return "verifiedDone";
  if (backup === "stale") return "waiting";
  return "failed";
}


/**
 * A dashboard that CANNOT WORK says so on EVERY view, not only on the page
 * that explains it — so this is mounted above the takeover switch, and the
 * queue, the intake workspace, the archive, the explorer, the catalog and the
 * activity report all carry it.
 *
 * D222 narrowed what earns the band to exactly that one state. A stale or
 * missing backup does not stop the work, and ref dashboard-surfaces §2.6 has always named it
 * a `storage` NOTIFICATION — so it now reaches the operator as a durable
 * inbox row (published by the composition's backup-health watch) plus the
 * gear's attention dot, never as a band over every view. The unreachable
 * authority stays here for a structural reason, not a volume preference: the
 * inbox is an authority table, so an authority that cannot be written cannot
 * record a notification about its own death — the banner is the one surface
 * that can still say it.
 *
 * The card's colour and content layout were ported from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc. D281 item 7 later
 * ruled the shell geometry from legacy hr-automation@1ec1d870,
 * `src/dashboard/components/dev/rebuild-demo/DemoSettings.tsx:1204-1237`:
 * full-bleed, bottom edge only, no radius. That is `Banner shape="band"`, a
 * deliberate arm that leaves the primitive's default card unchanged.
 *
 * The COPY is not ported. The demo's banner disclosed two lists — what still
 * works and what is blocked — authored against a demo's `StorageMode`, and
 * every line of them would have been a claim about a system nobody had asked.
 * What this one says is derived from the facts the bootstrap actually serves
 * (`authority`, `backup`, `checkedAt`) and nothing else.
 *
 * It is a HAZARD, which is one of D24's two exemptions from "a professional
 * dashboard does not explain itself": it names the state, the one consequence
 * that changes what the operator should do next, and the route to the doctor.
 * There is no third sentence, no disclosure, and no defence of the design.
 */
const AUTHORITY_HAZARD = "Nothing durable can be read or recorded.";

const BACKUP_HAZARD: Record<Exclude<StorageHealthSummary["backup"], "current">, string> = {
  stale: "The backup summary is stale. Run the doctor to inspect the exact backup and generation gap.",
  missing: "No backup manifest was found by the summary. Run the doctor to inspect recovery sources.",
};


export function StorageBanner({
  storage,
  onOpenSettings,
}: {
  storage: StorageHealthSummary;
  onOpenSettings: () => void;
}) {
  if (storage.authority === "healthy") return null;
  const backupHazard = storage.backup === "current" ? undefined : BACKUP_HAZARD[storage.backup];
  return (
    <Banner
      className="shrink-0"
      tone="danger"
      shape="band"
      /* D276 item 4 keeps `Banner` shared; D281 item 7 supplies this one
         site's band arm. The demo's glyph is `ShieldAlert`, and `Banner` takes
         an icon. A shield is the right word here — the band is about what is
         PROTECTING the data, not about a generic warning. */
      icon={<ShieldAlert aria-hidden className={dsIcon.lg} />}
      title="Authority storage is unavailable"
      action={
        <Button size="sm" variant="secondary" onClick={onOpenSettings}>
          Storage health
        </Button>
      }
    >
      <span className="flex flex-col gap-[var(--ds-space-tight)]">
        <span>
          {AUTHORITY_HAZARD}
          {/* Both facts, when both are true. The authority sentence leads
              because it is the one that changes what happens next. */}
          {backupHazard !== undefined ? ` ${backupHazard}` : ""}
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
    <span className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
      <StatusDot status={status} />
      <span className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{label}</span>
      <span className={cn(dsText.body, "min-w-0 break-words font-medium text-[color:var(--ds-fg)]")}>{value}</span>
    </span>
  );
}


type SpanAuthorityWithAccounting = Exclude<StorageDoctorWire["spanAuthority"], { state: "unavailable" }>;


function SpanArchiveAccounting({ archived }: { archived: SpanAuthorityWithAccounting["archived"] }) {
  return (
    <details>
      <summary className={cn(dsText.meta, dsFocus, "cursor-pointer text-[color:var(--ds-fg-secondary)]")}>
        {plural(archived.length, "archived run")}
      </summary>
      {archived.length === 0 ? (
        <span className={cn(dsText.meta, "mt-[var(--ds-space-tight)] block text-[color:var(--ds-fg-muted)]")}>
          No archived runs account for this corpus.
        </span>
      ) : (
        <ul
          aria-label="Archived span-authority runs"
          className="mt-[var(--ds-space-tight)] flex flex-col gap-[var(--ds-space-hair)]"
        >
          {archived.map((entry) => (
            <li
              key={entry.runId}
              title={entry.archivedAt}
              className={cn(dsText.meta, dsText.nums, "break-all text-[color:var(--ds-fg-muted)]")}
            >
              {entry.runId} · archived {fmtInstantDay(entry.archivedAt)} · {fmtClock(entry.archivedAt)}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}


function SpanAuthorityReport({ spanAuthority }: { spanAuthority: StorageDoctorWire["spanAuthority"] }) {
  if (spanAuthority.state === "unavailable") {
    return (
      <section
        aria-labelledby="span-authority-title"
        aria-live="polite"
        className="flex flex-col gap-[var(--ds-space-tight)] border-t border-[color:var(--ds-border)] pt-[var(--ds-space-base)]"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
          <StatusDot status="failed" />
          <h3 id="span-authority-title" className={cn(dsText.body, "font-semibold text-[color:var(--ds-danger)]")}>
            Span authority unavailable
          </h3>
        </span>
        <span className={cn(dsText.meta, dsText.nums, "break-words text-[color:var(--ds-danger)]")}>
          {spanAuthority.cause.code}: {spanAuthority.cause.summary}
        </span>
      </section>
    );
  }
  const reconciled = spanAuthority.state === "reconciled";
  return (
    <section
      aria-labelledby="span-authority-title"
      aria-live="polite"
      className="flex flex-col gap-[var(--ds-space-tight)] border-t border-[color:var(--ds-border)] pt-[var(--ds-space-base)]"
    >
      <span className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-snug)]">
        <StatusDot status={reconciled ? "verifiedDone" : "waiting"} />
        <h3
          id="span-authority-title"
          className={cn(
            dsText.body,
            "font-semibold",
            reconciled
              ? "text-[color:var(--ds-status-verified-done-fg)]"
              : "text-[color:var(--ds-status-waiting-fg)]",
          )}
        >
          Span authority {spanAuthority.state}
        </h3>
      </span>
      <span className={cn(dsText.meta, dsText.nums, "flex flex-wrap gap-x-[var(--ds-space-cozy)] gap-y-[var(--ds-space-hair)] text-[color:var(--ds-fg-muted)]")}>
        <span>{plural(spanAuthority.streamRunCount, "stream run")}</span>
        <span>{plural(spanAuthority.liveRunCount, "live authority run")}</span>
      </span>
      <SpanArchiveAccounting archived={spanAuthority.archived} />
      {spanAuthority.state === "degraded" && (
        <ul aria-label="Span authority problems" className="flex flex-col gap-[var(--ds-space-tight)]">
          {spanAuthority.problems.map((problem, index) => (
            <li
              key={`${problem.state}:${String(index)}`}
              className={cn(dsText.meta, "grid min-w-0 gap-[var(--ds-space-hair)] grid-cols-[max-content_minmax(0,1fr)]")}
            >
              <span className={cn(dsText.nums, "font-semibold text-[color:var(--ds-status-waiting-fg)]")}>
                {problem.state}
              </span>
              <span className={cn(dsText.nums, "min-w-0 break-all text-[color:var(--ds-fg-muted)]")}>
                {spanAuthorityProblemDetail(problem)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}


const COUNT_LABELS = [
  ["pendingCommands", "pending commands"],
  ["unresolvedWriteIntents", "unresolved write intents"],
  ["leases", "leases"],
  ["providerReservations", "provider reservations"],
  ["artifactOutbox", "artifact outbox"],
] as const;


function RecoveryStatus({ report }: { report: StorageDoctorWire }) {
  const recovery = report.recovery;
  return <section aria-label="Recovery status" aria-live="polite" className="flex flex-col gap-[var(--ds-space-tight)]">
    <HealthLine status={recovery.state === "clear" ? "verifiedDone" : "failed"} label="Recovery"
      value={recovery.state === "clear" ? "No interruption markers" : recovery.state === "interrupted" ? "Interrupted recovery" : "Inspection unavailable"} />
    {recovery.state !== "clear" && <>
      <span className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
        {recovery.state === "unavailable" ? recovery.cause.summary : "Runtime startup remains blocked. Preserve the evidence and settle the exact interrupted operation."}
      </span>
      <ul aria-label="Recovery findings" className={dsText.meta}>
        {recovery.findings.map(finding => <li key={finding.marker}>{finding.marker}: {finding.state}</li>)}
      </ul>
    </>}
  </section>;
}

function UpgradeAndCredentials({ report }: { report: StorageDoctorWire }) {
  const upgrades = report.authorityUpgrades, credentials = report.protectedSettings;
  return <>
    <section aria-label="Authority upgrade history" className="flex flex-col gap-[var(--ds-space-tight)]">
      <h3 className={cn(dsText.body, "font-semibold")}>Authority upgrade history</h3>
      {upgrades.state === "available" ? <ul className={cn(dsText.meta, dsText.nums)}>
        {upgrades.phases.map((row, index) => <li key={index}>
          {row.phase}: v{row.fromSchemaVersion} → v{row.toSchemaVersion}; {fmtInstantDay(row.recordedAt)} {fmtClock(row.recordedAt)}
        </li>)}
      </ul> : <span className={dsText.meta}>{upgrades.state === "unavailable"
        ? `Upgrade history unavailable: ${upgrades.cause.summary}`
        : upgrades.reason === "pre-journal-schema" ? "This source predates the upgrade journal." : "No upgrade history recorded."}</span>}
    </section>
    <section aria-label="Independent credentials" className="flex flex-col gap-[var(--ds-space-tight)]">
      <h3 className={cn(dsText.body, "font-semibold")}>Independent credentials</h3>
      {credentials.state === "available" ? <ul className={cn(dsText.meta, "grid grid-cols-2 gap-[var(--ds-space-tight)]")}>
        {credentials.entries.map(entry => <li key={entry.name}>{entry.name}: {entry.present ? "present" : "absent"}</li>)}
      </ul> : <span className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>Credential inspection unavailable: {credentials.cause.summary}</span>}
    </section>
  </>;
}


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

      <RecoveryStatus report={report} />
      <SpanAuthorityReport spanAuthority={report.spanAuthority} />
      <UpgradeAndCredentials report={report} />

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
            className={cn(dsText.meta, dsText.nums, "break-all text-[color:var(--ds-fg-muted)]")}
          >
            {candidate.state === "verified-compatible"
              ? `Verified bytes: ${candidate.manifestFileName}. ${candidate.selection === "lifecycle-pair" ? "Complete lifecycle pair" : "Individual database"}; restore ${candidate.restoreEligibility.state}. Schema v${String(candidate.schemaVersion)}; generation ${String(candidate.authorityGeneration)}; age ${fmtAge(candidate.ageMs)}.`
                + ("reason" in candidate.restoreEligibility ? ` ${candidate.restoreEligibility.reason}` : candidate.restoreEligibility.state === "requires-upgrade" ? " Supported source requires stopped conversion with this release." : " Stopped-system checks still apply.")
              : `INVALID ${candidate.manifestFileName} — ${candidate.cause.code}: ${candidate.cause.summary}`}
          </span>
        ))}
      </div>
    </div>
  );
}


function RecoveryGuidance() {
  return <Popover>
    <PopoverTrigger asChild>
      <IconButton size="xs" label="Storage recovery instructions" icon={<Info aria-hidden className={dsIcon.sm} />} />
    </PopoverTrigger>
    <PopoverContent title="Storage recovery instructions" width="lg"
      className="max-h-[var(--radix-popover-content-available-height)] overflow-y-auto">
      <div className="flex flex-col gap-[var(--ds-space-base)]">
        <p>Run these commands from the intended rebuild checkout. Stop its dashboard with Ctrl+C and wait for the BFF and all workers to finish before backup, upgrade or restore.</p>
        {STORAGE_RECOVERY_GUIDANCE.map(row => <section key={row.title} className="flex flex-col gap-[var(--ds-space-tight)]">
          <h3 className={cn(dsText.body, "font-semibold text-[color:var(--ds-fg)]")}>{row.title}</h3>
          <code className={cn(dsText.meta, dsText.nums, "block break-words whitespace-pre-wrap select-text")}>{row.command}</code>
          <p>{row.detail}</p>
        </section>)}
        <p>Interrupted or unavailable recovery: preserve the markers, suspect files and exact backup bytes. Correct the named evidence before replaying that exact operation. A generic retry is not safe. Never retry an UNKNOWN submit or re-admit a run lost during restore.</p>
        <p>After recovery, rerun the doctor and check credentials before restarting services. Interactive restore, upgrade and repair controls are deferred until a concrete workflow need or an explicit post-release request.</p>
      </div>
    </PopoverContent>
  </Popover>;
}


export function StorageSection({
  storage,
  editor,
  preflight,
}: {
  storage: StorageHealthSummary;
  editor: ReturnType<typeof useEditableSettings>;
  preflight: NonNullable<FrontendBootstrapWire["preflight"]>;
}) {
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

  const degraded = storage.authority !== "healthy";
  return (
    /*
      SE45 (D276 item 4). Every other Settings destination in this file is a
      `Panel` + `PanelHeader` + `PanelBody` — the demo's shape, and the shape
      `System hosts` and `Workflow capabilities` were built to. Storage was the
      one section that never got it and read as a loose `SectionLabel` inside
      the frame, which made the doctor look like part of the page rather than
      part of a destination.

      The header's `meta` is the demo's freshness slot filled with the fact this
      tree actually serves. The demo prints `newest backup <age>`; the summary
      wire carries `authority`, `backup` and `checkedAt` and NO backup age at
      all — the age exists only on the doctor report, which is a read the
      operator has not made yet. So the slot takes the check time rather than an
      invented or lazily-borrowed age, and the sentence below keeps the
      provenance half it used to say twice.
    */
    <Panel className="min-h-0 flex-1">
      <PanelHeader
        title="Storage health"
        headingLevel={2}
        icon={<Database aria-hidden className={dsIcon.lg} />}
        meta={`checked ${fmtClock(storage.checkedAt)}`}
      />
      <PanelBody className="flex flex-col gap-[var(--ds-space-base)] p-[var(--ds-space-cozy)]">
        {/*
          SE46 — the demo's verdict banner, keyed on the ONE fact that decides
          whether this dashboard can record anything. The two `HealthLine`s
          below are NOT replaced by it: the demo's single `mode` collapses
          authority and backup into one binary, and this wire serves them
          separately — a stale backup is not a read-only volume, and a banner
          that said so would be the surface losing a fact it holds. The banner
          is the verdict; the lines are the facts it was derived from.
        */}
        <Banner
          tone={degraded ? "danger" : "success"}
          title={degraded ? "Authority unavailable" : "Authority summary healthy"}
        >
          {degraded
            ? AUTHORITY_HAZARD
            : "Backup metadata has not been re-verified by this summary."}
        </Banner>

        <HealthLine status={authorityStatusOf(storage.authority)} label="Authority" value={storage.authority} />
        <HealthLine status={backupStatusOf(storage.backup)} label="Backup" value={storage.backup} />
        <span className="flex items-center gap-[var(--ds-space-snug)]">
          <Button size="sm" onClick={runDoctor} disabled={doctor.state === "loading"} aria-label="Run the read-only storage doctor">
            {doctor.state === "loading" ? "Running doctor…" : "Run storage doctor"}
          </Button>
          <RecoveryGuidance />
        </span>
        {doctor.state === "failed" && (
          <span role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
            {doctor.message}
          </span>
        )}
        {doctor.state === "loaded" && <DoctorReport report={doctor.report} />}
        <Separator />
        <PreflightControl editor={editor} retained={preflight} />
      </PanelBody>
    </Panel>
  );
}
