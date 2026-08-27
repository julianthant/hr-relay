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
import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CircleAlert,
  Database,
  Info,
  Keyboard as KeyboardIcon,
  Link2,
  Settings as SettingsIcon,
  ShieldAlert,
  Table2,
} from "lucide-react";
import {
  SETTINGS_SYSTEM_HOSTS_SECTION_ID,
  SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
  type SettingsFactsWire,
} from "../../domain/dashboard/settings.js";
import type { StorageDoctorWire } from "../../domain/dashboard/storage.js";
import {
  CAPABILITY_SPECS,
  SETTINGS_GEAR_ID,
  SETTINGS_KEYBOARD_SECTION_ID,
  buildSettingsNav,
  capabilityAvailableCount,
  capabilityMatrix,
  resolveSettingsSection,
  storageNeedsAttention,
  systemHostsMeta,
  useSettingsFacts,
  type CapabilityCell,
  type SettingsNavEntry,
  type SettingsNavIcon,
  type SettingsSection,
  type StorageHealthSummary,
} from "./settings-model.js";
import { DemoShortcutsLegend } from "./shortcuts.js";
import { DEMO_SHORTCUTS } from "./shortcuts-model.js";

export type { StorageHealthSummary, SettingsSection };
import {
  Badge,
  Banner,
  BulletList,
  Button,
  Chip,
  IconButton,
  MetaLine,
  Panel,
  PanelBody,
  PanelHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SectionLabel,
  Separator,
  Spinner,
  StatusDot,
  TakeoverFrame,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  dsClip,
  dsFocus,
  dsIcon,
  dsMotion,
  dsText,
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
      /* SE63/SE64 (D276 item 4). SE63 is already ported: `Banner`'s danger
         shell IS the demo's bespoke div — the same
         `--ds-danger-border` / `--ds-danger-quiet` pair — and reverting a
         primitive to a hand-rolled container to match a file that predates it
         would trade the shared treatment for a copy of it. SE64 is the real
         difference, and it is one prop: the demo's glyph is `ShieldAlert`, and
         `Banner` takes an icon. A shield is the right word here — the band is
         about what is PROTECTING the data, not about a generic warning. */
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
        subtitle="The tracker volume, the authority generation, and the backups a restore would use."
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
          title={degraded ? "Read-only — degraded" : "Read-write — healthy"}
        >
          {degraded
            ? AUTHORITY_HAZARD
            : "From the newest write-time-verified backup manifest; the doctor below re-verifies bytes."}
        </Banner>

        <HealthLine status={authorityStatusOf(storage.authority)} label="Authority" value={storage.authority} />
        <HealthLine status={backupStatusOf(storage.backup)} label="Backup" value={storage.backup} />
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
      </PanelBody>
    </Panel>
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

/* ── the two served status sections (D274 item 6, ledger 3 SE40–SE42) ─────── */

/**
 * The async half of both sections, drawn rather than hidden (D275 item 4).
 *
 * A refusal is NOT an empty table. "No test host is configured" and "we could
 * not ask the server" are different sentences about the same blank space, and a
 * page whose job is to state facts may not let one stand in for the other — so
 * the failed arm names the failure, in an `alert`, instead of rendering an
 * honest-looking page of nothing.
 */
const FACTS_LOADING = "Reading what this deployment is configured with";

function FactsPane({
  facts,
  children,
}: {
  facts: ReturnType<typeof useSettingsFacts>;
  children: (loaded: SettingsFactsWire) => ReactNode;
}) {
  if (facts.state === "loading") {
    return (
      <span
        className={cn(
          dsText.meta,
          "flex items-center gap-[var(--ds-space-snug)] p-[var(--ds-space-cozy)]",
          "text-[color:var(--ds-fg-muted)]",
        )}
      >
        {/* The spinner IS the `role="status"` here, so its name is what a
            screen reader reads — it carries the real sentence rather than
            "Loading" over the top of it, and the visible copy is hidden from
            the tree so the one fact is announced once. ONE expression feeds
            both halves, the way intake's review checkbox does. */}
        <Spinner label={FACTS_LOADING} />
        <span aria-hidden>{FACTS_LOADING}…</span>
      </span>
    );
  }
  if (facts.state === "failed") {
    return (
      // No inner `role="alert"`: a `danger` Banner already carries one
      // (`primitives-layout.tsx`), and nesting a second is the exact defect the
      // D273 items 9–10 refused-notice merge ratified out — the sentence is
      // announced twice and every `getByRole("alert")` here goes ambiguous.
      <Banner
        className="m-[var(--ds-space-cozy)]"
        tone="danger"
        title="These facts could not be read"
      >
        <span className="flex flex-col gap-[var(--ds-space-tight)]">
          <span>{facts.message}</span>
          <span>Nothing below is missing — nothing below was asked for.</span>
        </span>
      </Banner>
    );
  }
  return <>{children(facts.facts)}</>;
}

/**
 * SE40 — the hosts this deployment resolves, per system.
 *
 * It STATES and sets nothing, and the banner says why that is a decision rather
 * than an unbuilt control: the instance is a per-RUN choice the envelope
 * carries, and a standing override here would redirect every future run with no
 * expiry and nothing on screen to say so. `none provisioned` is the served
 * absence — the projection drops a test host that is not distinct from
 * production, because a run asking for that one is refused (D274 item 6).
 */
function SystemHostsSection() {
  const facts = useSettingsFacts();
  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader
        title="System hosts"
        subtitle="Where a run goes when it opens each system."
        icon={<Link2 aria-hidden className={dsIcon.lg} />}
        meta={facts.state === "loaded" ? systemHostsMeta(facts.facts.systemHosts) : undefined}
      />
      <PanelBody className="flex flex-col">
        <FactsPane facts={facts}>
          {(loaded) => (
            <>
              <Banner
                tone="info"
                title="Choosing between these is a per-run decision"
                className="m-[var(--ds-space-cozy)]"
              >
                A run envelope carries the instance per system and defaults to production; a start
                that asks for <strong>test</strong> is refused outright unless a distinct test host is
                configured, never quietly sent to production. This page states the hosts and sets
                none — a standing override here would redirect every future run with no expiry and
                nothing on screen to say so.
              </Banner>
              <Table label="System entry hosts">
                <THead>
                  <TR>
                    <TH>System</TH>
                    <TH>Production</TH>
                    <TH>Test</TH>
                  </TR>
                </THead>
                <TBody>
                  {loaded.systemHosts.map((host) => (
                    <TR key={host.system}>
                      <TD className="whitespace-nowrap">{host.system}</TD>
                      {/* `break-all` belongs to the URL, never to the cell: a
                          deep PeopleSoft route has no spaces to wrap at, and
                          the same rule applied to the absence below spelled it
                          `none pro / visioned`. Prose wraps at words. */}
                      <TD numeric><span className="break-all">{host.production}</span></TD>
                      {host.test.state === "provisioned" ? (
                        <TD numeric><span className="break-all">{host.test.url}</span></TD>
                      ) : host.test.state === "not-distinct" ? (
                        // Configured, but identical to production — refused at
                        // run time by `resolveSystemEntryUrl`. Stated by name
                        // rather than folded into `none provisioned`, which
                        // would read as "nobody configured a sandbox" when the
                        // true fact is "a sandbox was configured wrong" (unit
                        // F11b finding 2).
                        <TD>
                          <span className={cn(dsText.meta, "whitespace-nowrap text-[color:var(--ds-danger)]")}>
                            provisioned identical to production — refused
                          </span>
                        </TD>
                      ) : (
                        <TD>
                          <span className={cn(dsText.meta, "whitespace-nowrap text-[color:var(--ds-fg-faint)]")}>
                            none provisioned
                          </span>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </>
          )}
        </FactsPane>
      </PanelBody>
    </Panel>
  );
}

/**
 * ONE capability cell. Three states, told apart by SHAPE and by WORD, never by
 * colour, and nothing here is pressable: this is a page that STATES, and a
 * toggle would be a second control for a decision that belongs to a start.
 *
 * All three arms take the SAME shape — a short state token, then the sentence —
 * and the reason it is not the demo's "filled chip carrying the value" is
 * `Chip`'s own docstring: *if a fact cannot survive truncation it is not a
 * chip*. A chip is `dsClip.token` outside and `dsClip.text` inside, so a
 * `break-words` on its child is dead CSS and a three-system list would cut with
 * nothing to recover it — on any pointer, which DESIGN.md bans outright and
 * D272 items 8–9 ratified against twice already. The detail wraps beside the
 * token instead, where it has somewhere to wrap TO, and it is not `nums`:
 * "3 correctable fields" is prose, and a fact declares its kind (F2d).
 */
function CapabilityCellView({ cell }: { cell: CapabilityCell }) {
  const available = cell.state === "available";
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-[var(--ds-space-tight)]">
      <Chip tone={available ? "info" : cell.state === "not-built" ? "warning" : "neutral"}>
        {available ? "Yes" : cell.state === "not-built" ? "Not built" : "N/A"}
      </Chip>
      <span
        className={cn(
          dsText.meta,
          "min-w-0 break-words",
          // The answer is the page's content; a reason is its explanation.
          available ? "text-[color:var(--ds-fg)]" : "text-[color:var(--ds-fg-muted)]",
        )}
      >
        {available ? cell.detail : cell.reason}
      </span>
    </span>
  );
}

/**
 * SE41/SE42 — what each workflow can do, read down one capability at a time.
 *
 * CAPABILITY-MAJOR rather than a grid of six columns by seven rows, and that is
 * the whole design decision. A true matrix is a horizontal scroll with a header
 * the eye loses, and its cells can hold only a tick — which throws away the half
 * of the answer that matters, namely WHICH systems, WHICH gates, and WHY not.
 * Read down a capability and "which ones have a dry run?" is one glance, with
 * the reason attached to every no.
 */
function CapabilitiesSection({ workflowLabels }: { workflowLabels: ReadonlyMap<string, string> }) {
  const facts = useSettingsFacts();
  return (
    <Panel className="min-h-0 flex-1">
      <PanelHeader
        title="Workflow capabilities"
        subtitle="What each registered workflow can do, and what it will not do."
        icon={<Table2 aria-hidden className={dsIcon.lg} />}
        meta={facts.state === "loaded"
          ? `${String(facts.facts.workflowCapabilities.length)} workflows · ${String(CAPABILITY_SPECS.length)} capabilities`
          : undefined}
      />
      <PanelBody className="flex flex-col gap-[var(--ds-space-cozy)] p-[var(--ds-space-cozy)]">
        <FactsPane facts={facts}>
          {(loaded) => {
            const matrix = capabilityMatrix(loaded.workflowCapabilities, workflowLabels);
            // A build that registers no workflow is unusual and real, and the
            // six header-only tables it would otherwise draw say nothing at all
            // — six `0 of 0` badges over empty grids read as a page that failed
            // to load rather than as a build with nothing to describe.
            if (matrix.length === 0) {
              return (
                <Banner tone="warning" title="This build registers no workflows">
                  There is nothing to describe: the capability rows are derived from the descriptor
                  registry, and it is empty in this process.
                </Banner>
              );
            }
            return (
              <>
                <Banner tone="info" title="Read from the descriptors, not from a list somebody kept up to date">
                  Every cell is derived from the same descriptor the Run modal and the Explorer read.
                  A workflow that gains a dry run gains it here on the same deploy. These six are what
                  a descriptor declares; a seventh appears when a descriptor grows one, never before.
                </Banner>

                {CAPABILITY_SPECS.map((spec) => (
                  <div key={spec.key} className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
                    <div className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
                      <SectionLabel className="min-w-0 truncate">{spec.label}</SectionLabel>
                      {/* compared down the page, so the digits must not shift */}
                      <Badge tone="neutral" className={dsText.nums}>
                        {capabilityAvailableCount(matrix, spec.key)} of {matrix.length}
                      </Badge>
                      <Popover>
                        <PopoverTrigger asChild>
                          <IconButton
                            size="xs"
                            label={`What ${spec.label} means`}
                            // 20px at rest. The floor is taken as min-w/min-h
                            // rather than an `::after` overlay because this
                            // control sits in a FLEX ROW — it grows the row and
                            // cannot resolve a tap to a neighbour (F2d). The
                            // parity corpus renders at `pointer: fine`, so no
                            // reference moves.
                            className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                            icon={<Info aria-hidden className={dsIcon.sm} />}
                          />
                        </PopoverTrigger>
                        <PopoverContent title={spec.label}>
                          <p className={cn(dsText.meta, "text-[color:var(--ds-fg-secondary)]")}>
                            {spec.meaning}
                          </p>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <Table label={`${spec.label} by workflow`}>
                      <THead>
                        <TR>
                          <TH>Workflow</TH>
                          <TH>{spec.label}</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {matrix.map((row) => (
                          <TR key={row.workflowId}>
                            <TD className="w-[190px]">
                              <WorkflowName label={row.label} served={row.labelServed} />
                            </TD>
                            <TD>
                              <CapabilityCellView cell={row.cells[spec.key]} />
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  </div>
                ))}

                {/* The one fact that is not a yes/no, so it is not a capability
                    row: a workflow can honour a rehearsal, have nothing to
                    rehearse, or write and refuse one — and the third is the
                    answer worth reading before a real HR transaction. */}
                <div className="flex min-w-0 flex-col gap-[var(--ds-space-snug)]">
                  <SectionLabel>Where a dry run stops</SectionLabel>
                  <Table label="Dry-run posture by workflow">
                    <THead>
                      <TR>
                        <TH>Workflow</TH>
                        <TH>Posture</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {matrix.map((row) => (
                        <TR key={row.workflowId}>
                          <TD className="w-[190px]">
                            <WorkflowName label={row.label} served={row.labelServed} />
                          </TD>
                          <TD>{row.dryRunPosture}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              </>
            );
          }}
        </FactsPane>
      </PanelBody>
    </Panel>
  );
}

/**
 * A workflow's name in the first column. The capability wire carries no label —
 * the bootstrap already serves one, and one page may not hold two names for one
 * workflow — so a row this document does not list falls back to the workflow's
 * own id and SAYS it is the id, rather than reading as a badly-cased label.
 */
function WorkflowName({ label, served }: { label: string; served: boolean }) {
  if (served) return <>{label}</>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn(dsText.nums, dsClip.text)}>{label}</span>
      <span className={cn(dsText.micro, "text-[color:var(--ds-fg-muted)]")}>
        not in the served workflow list — this is its id
      </span>
    </span>
  );
}

/**
 * The served sections this build has a renderer for. A served id NOT in here
 * draws the named build gap below — which is the arm that must keep working, so
 * the set is spelled once and both the switch and the gap read it.
 */
const RENDERED_SERVED_SECTION_IDS: ReadonlySet<string> = new Set([
  "storage",
  SETTINGS_SYSTEM_HOSTS_SECTION_ID,
  SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID,
]);

const NAV_ICON: Record<SettingsNavIcon, typeof Database> = {
  storage: Database,
  "system-hosts": Link2,
  capabilities: Table2,
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
    <a
      // A real href — not a `button` — so middle-click, Cmd/Ctrl-click and
      // "open in new tab" all work the way any other in-page navigation does
      // (unit F4b finding 4). `onSection` still owns the actual transition
      // (through `setRoute`, which carries the rest of the route the bare
      // href below cannot), so the default navigation is prevented and the
      // click is handed to it exactly as the `button` version did.
      href={`?settings=${encodeURIComponent(entry.id)}`}
      aria-current={active ? "page" : undefined}
      onClick={(event) => {
        event.preventDefault();
        onClick();
      }}
      className={cn(
        "flex min-w-0 items-center gap-[var(--ds-space-snug)] rounded-[var(--ds-radius-md)]",
        "px-[var(--ds-space-base)] py-[var(--ds-space-snug)] text-left",
        // The finger's 44px floor, taken by GROWING the entry rather than by
        // hanging an overlay on it (`ds/tokens.css`'s coarse-pointer note, and
        // unit F2c's lesson). It is safe here where it was not on the member
        // line: these entries are separated by a real `gap-hair`, so a taller
        // entry has its own box to grow into and cannot resolve a tap to its
        // neighbour. A fine pointer sees the demo's density unchanged, and the
        // parity corpus renders at `pointer: fine`.
        //
        // `pointer-coarse:` — the variant the queue's own touch constants use.
        // The first attempt here was the arbitrary form
        // `[@media(pointer:coarse)]:min-h-[44px]`, which compiled to an EMPTY
        // rule: the class was in the DOM and the declaration was in no
        // stylesheet, so nothing on screen and nothing in the gate family would
        // have said the floor was missing. Read the generated CSS, not the
        // class list — F2c's lesson, one layer lower down.
        "pointer-coarse:min-h-11",
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
    </a>
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
      id={SETTINGS_GEAR_ID}
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
 * section's own panel filling the rest — the demo's shape (SE1–SE4, SE8).
 *
 * UF-SET-1/4/5. `TakeoverFrame`'s JSDoc owns the why — geometry, arrival and
 * focus, decided once for all four takeovers. This surface's demo container:
 * `// ported from legacy 1ec1d870
 * src/dashboard/components/dev/rebuild-demo/DemoSettings.tsx:1071-1075`, a bare
 * `flex min-h-0 flex-1` with the 220px nav as its first child. It is the only
 * takeover that lays out in a ROW, which is what `direction="row"` is for.
 */
export function SettingsPage({
  storage,
  sections,
  workflowLabels,
  section,
  onSection,
  onClose,
}: {
  storage: StorageHealthSummary;
  sections: readonly SettingsSection[];
  /**
   * The bootstrap's own workflow labels, by id. Capabilities joins on them
   * rather than being served a second copy — one page, one name per workflow.
   */
  workflowLabels: ReadonlyMap<string, string>;
  /** the open section id — `""` is the page's own default, from `?settings=` */
  section: string;
  onSection: (next: string) => void;
  onClose: () => void;
}) {
  const groups = buildSettingsNav(sections);
  const resolution = resolveSettingsSection(groups, section);
  const activeId = resolution.state === "open" ? resolution.entry.id : undefined;

  return (
    <TakeoverFrame label="Settings" direction="row">
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
          className="justify-start pointer-coarse:min-h-11"
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
            This build has no settings section called “{resolution.requested}”. Pick one from the
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
        {resolution.state === "open" && resolution.entry.id === SETTINGS_SYSTEM_HOSTS_SECTION_ID && (
          <SystemHostsSection />
        )}
        {resolution.state === "open" && resolution.entry.id === SETTINGS_WORKFLOW_CAPABILITIES_SECTION_ID && (
          <CapabilitiesSection workflowLabels={workflowLabels} />
        )}
        {resolution.state === "open"
          && resolution.entry.source === "served"
          && !RENDERED_SERVED_SECTION_IDS.has(resolution.entry.id) && (
          // A served section without a renderer is a build gap, said by name —
          // never a section that silently vanishes.
          <section
            aria-label={resolution.entry.label}
            className="flex flex-col gap-[var(--ds-space-tight)]"
          >
            <SectionLabel>{resolution.entry.label}</SectionLabel>
            <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
              This build has no renderer for the served section “{resolution.entry.id}”.
            </span>
          </section>
        )}
      </div>
    </TakeoverFrame>
  );
}
