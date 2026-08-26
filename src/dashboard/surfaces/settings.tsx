/**
 * Settings (ref dashboard-surfaces §2.5, 2i-D): the gear in the top bar, and the FULL-PAGE
 * takeover it opens — the demo's container, ratified as D272 item 1 / D274
 * item 5 (`ref dashboard-surfaces` §10). It was a `Dialog size="lg"`; a dialog
 * has no place in history and no back path, which is what the ledger rows
 * A65 / SE1–SE4 / SE8 were pointing at.
 *
 * Storage is READ-ONLY health: the bootstrap summary at rest (age/health,
 * §2.5's "expose age/health in Settings"), and the full read-only doctor on
 * demand — authority inspection, pending durable work, byte-re-verified
 * backup health, restore candidates, and what the live backup service last
 * did. Editable settings stay a deferred command family (`apply-settings`),
 * so nothing here pretends to save; the section list itself comes from the
 * SERVER's `settingsSections`, and a served section this build cannot render
 * says so by name instead of disappearing.
 *
 * Help → Keyboard is the OTHER half of D274 item 5 (SE7 / SE43 / SE44). The top
 * bar's keyboard glyph was deleted on the operator's instruction — *"we already
 * have help in settings"* — and the destination was never built, so the whole
 * legend was reachable from nowhere. It is a `client` section rather than a
 * served one because a legend of this bundle's own bindings is not a fact the
 * server holds.
 */
import { useState } from "react";
import {
  ArrowLeft,
  CircleAlert,
  Database,
  Keyboard as KeyboardIcon,
  Settings as SettingsIcon,
} from "lucide-react";
import type { StorageDoctorWire } from "../../domain/dashboard/storage.js";
import {
  SETTINGS_KEYBOARD_SECTION_ID,
  buildSettingsNav,
  resolveSettingsSection,
  storageNeedsAttention,
  type SettingsNavEntry,
  type SettingsNavIcon,
  type SettingsSection,
  type StorageHealthSummary,
} from "./settings-model.js";
import { DemoShortcutsLegend } from "./shortcuts.js";
import { DEMO_SHORTCUTS } from "./shortcuts-model.js";

export type { StorageHealthSummary, SettingsSection };
import {
  Banner,
  BulletList,
  Button,
  IconButton,
  MetaLine,
  Panel,
  PanelBody,
  PanelHeader,
  SectionLabel,
  Separator,
  StatusDot,
  dsFocus,
  dsIcon,
  dsMotion,
  dsText,
  useDsEnterTransition,
  type DsStatus,
} from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { useDashboardClient } from "../state/client-context.js";
import { fmtClock, plural } from "./format.js";

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
 * Ported in SHAPE from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `src/dashboard/components/dev/rebuild-demo/DemoSettings.tsx` (`DemoStorageBanner`).
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
  if (storage.authority === "healthy") return null;
  const backupHazard = storage.backup === "current" ? undefined : BACKUP_HAZARD[storage.backup];
  return (
    <Banner
      className={cn("shrink-0", className)}
      tone="danger"
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
 * The keyboard legend, at reading size (SE43).
 *
 * It renders the SAME registry the Top Bar popover was built against, through
 * the same component, so a key cannot be bound in one place and described in
 * another. The three rules below are not teaching — they are the conditions
 * under which these bindings do and do not fire, each one a fact
 * `app/global-keys.ts` enforces in its own header, and the one thing a legend
 * of keys cannot carry in a key column.
 */
function KeyboardSection() {
  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader
        title="Keyboard"
        subtitle="Every key the shell binds, by where it works."
        icon={<KeyboardIcon aria-hidden className={dsIcon.lg} />}
        meta={plural(DEMO_SHORTCUTS.length, "binding")}
      />
      <PanelBody className="flex flex-col gap-[var(--ds-space-section)] p-[var(--ds-space-cozy)]">
        <DemoShortcutsLegend grouped className="max-w-[64ch]" />

        <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
          <SectionLabel>When they fire</SectionLabel>
          <BulletList
            className="max-w-[86ch]"
            items={[
              "Never while the caret is in a text field — typing a name into search does not jump the queue.",
              "Never while a dialog or a drawer is open. That surface owns the keyboard, including Escape.",
              "Right-click, and the platform's own Menu / Shift+F10 key, open the same row menu that m does — m works from the SELECTION, so it does not need the row to be focused.",
            ]}
          />
        </div>
      </PanelBody>
    </Panel>
  );
}

const NAV_ICON: Record<SettingsNavIcon, typeof Database> = {
  storage: Database,
  keyboard: KeyboardIcon,
  unrendered: CircleAlert,
};

/**
 * One nav entry. `aria-current="page"` rather than `aria-selected`, because
 * this is navigation between pages of one surface and not a tablist — the
 * demo's own choice, and the one an assistive technology reads as "you are
 * here" rather than "this option is picked".
 */
function SectionButton({
  entry,
  active,
  onClick,
}: {
  entry: SettingsNavEntry;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = NAV_ICON[entry.icon];
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-center gap-[var(--ds-space-snug)] rounded-[var(--ds-radius-md)]",
        "px-[var(--ds-space-base)] py-[var(--ds-space-snug)] text-left",
        dsText.ui,
        dsFocus,
        dsMotion.base,
        active
          ? "bg-[var(--ds-surface-selected)] font-semibold text-[color:var(--ds-fg)]"
          : "text-[color:var(--ds-fg-muted)] hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)]",
      )}
    >
      <Icon aria-hidden className={cn(dsIcon.md, "shrink-0")} />
      <span className="truncate">{entry.label}</span>
    </button>
  );
}

/**
 * The gear. A plain button now rather than a `DialogTrigger`: what it opens is
 * a page, so it navigates instead of raising a layer.
 *
 * `open` is still passed in rather than held here, because the page is
 * reachable from two places — this gear and the storage banner mounted above
 * every view — and a component's own `useState` cannot be opened by a sibling.
 */
export function SettingsGear({
  storage,
  open,
  onOpen,
}: {
  storage: StorageHealthSummary;
  open: boolean;
  onOpen: () => void;
}) {
  const attention = storageNeedsAttention(storage);
  return (
    <IconButton
      size="sm"
      label={attention ? "Settings — storage needs attention" : "Settings"}
      // The gear REPORTS that it owns the screen, in both representations:
      // `aria-pressed` for the accessibility tree and the surface-3 fill
      // for the eye. Every other pressed control in this cluster carries
      // the pair; the gear carried neither, so the one takeover an operator
      // opens most often was the one that never looked open.
      aria-pressed={open}
      onClick={onOpen}
      className={cn(open && "bg-[var(--ds-surface-3)] text-[color:var(--ds-fg)]")}
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
  );
}

/**
 * Settings, as a page (D272 item 1 / D274 item 5).
 *
 * The 220px nav on the left, `Back to the dashboard` at the top of it, and the
 * section's own panel filling the rest — the demo's shape (SE1–SE4, SE8). It
 * takes the same `Panel` + enter transition every other takeover in this tree
 * uses (D275 item 2), so the region does not arrive from a different direction
 * depending on which door was pressed.
 */
export function SettingsPage({
  storage,
  sections,
  section,
  onSection,
  onClose,
}: {
  storage: StorageHealthSummary;
  sections: readonly SettingsSection[];
  /** the open section id — `""` is the page's own default, from `?settings=` */
  section: string;
  onSection: (next: string) => void;
  onClose: () => void;
}) {
  const enter = useDsEnterTransition();
  const groups = buildSettingsNav(sections);
  const resolution = resolveSettingsSection(groups, section);
  const activeId = resolution.state === "open" ? resolution.entry.id : undefined;

  return (
    <Panel
      {...enter}
      aria-label="Settings"
      className={cn(
        "flex min-h-0 flex-1 flex-row",
        "data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))]",
        "data-[demo-enter=from]:opacity-0 ds-motion-enter",
      )}
    >
      <nav
        aria-label="Settings sections"
        className={cn(
          "flex w-[220px] shrink-0 flex-col gap-[var(--ds-space-hair)] overflow-y-auto",
          "border-r border-[color:var(--ds-border)] bg-[var(--ds-surface-1)] p-[var(--ds-space-base)]",
        )}
      >
        <Button
          variant="ghost"
          size="sm"
          icon={<ArrowLeft aria-hidden className={dsIcon.md} />}
          onClick={onClose}
          className="justify-start"
        >
          Back to the dashboard
        </Button>
        <Separator className="my-[var(--ds-space-tight)]" />
        {groups.map((group) => (
          <div key={group.heading} className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
            <SectionLabel className="px-[var(--ds-space-base)] pb-[var(--ds-space-tight)] pt-[var(--ds-space-cozy)]">
              {group.heading}
            </SectionLabel>
            {group.entries.map((entry) => (
              <SectionButton
                key={entry.id}
                entry={entry}
                active={entry.id === activeId}
                onClick={() => onSection(entry.id)}
              />
            ))}
          </div>
        ))}
      </nav>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-[var(--ds-space-base)] overflow-y-auto p-[var(--ds-space-cozy)]">
        {/* A link naming a section this build has no entry for is stated, never
            redirected: landing on Storage under `?settings=budgets` tells the
            operator they are reading something they are not. */}
        {resolution.state === "unknown" && (
          <Banner tone="danger" title="No such settings section">
            This build has no settings section called &quot;{resolution.requested}&quot;. Pick one from the
            list beside this.
          </Banner>
        )}
        {resolution.state === "empty" && (
          <Banner tone="warning" title="No settings sections">
            The server listed no settings sections and this build contributes none.
          </Banner>
        )}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_KEYBOARD_SECTION_ID && <KeyboardSection />}
        {resolution.state === "open" && resolution.entry.id === "storage" && <StorageSection storage={storage} />}
        {resolution.state === "open"
          && resolution.entry.source === "served"
          && resolution.entry.id !== "storage" && (
          // A served section without a renderer is a build gap, said by name —
          // never a section that silently vanishes.
          <section
            aria-label={resolution.entry.label}
            className="flex flex-col gap-[var(--ds-space-tight)]"
          >
            <SectionLabel>{resolution.entry.label}</SectionLabel>
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
              This build has no renderer for the served section &quot;{resolution.entry.id}&quot;.
            </span>
          </section>
        )}
      </div>
    </Panel>
  );
}
