import { ShieldAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { StorageDoctorWire } from "../../domain/dashboard/storage.js";
import { Badge, Banner, BodySection, Button, Disclosure, FormGroup, PageHeading, ResultRow, StatusDot, dsIcon } from "../ds/ui.js";
import { useStorageClient } from "../state/storage-client.js";
import { fmtClock, fmtInstantDay, plural } from "./format.js";
import { spanAuthorityProblemDetail, type StorageHealthSummary } from "./storage-settings-model.js";
import "./diagnostic-presentation.css";

const AUTHORITY_HAZARD = "Nothing durable can be read or recorded.";

/** The bootstrap summary is cheap; the checklist only claims results from a doctor report. */
export function StorageBanner({ storage, onOpenSettings }: {
  storage: StorageHealthSummary;
  onOpenSettings: () => void;
}) {
  if (storage.authority === "healthy") return null;
  return <Banner className="shrink-0" tone="danger" shape="band"
    icon={<ShieldAlert aria-hidden className={dsIcon.lg} />}
    title="Authority storage is unavailable"
    action={<Button size="sm" variant="secondary" onClick={onOpenSettings}>Storage checks</Button>}>
    {AUTHORITY_HAZARD} Checked {fmtClock(storage.checkedAt)}.
  </Banner>;
}

type DoctorState =
  | { state: "idle"; report?: undefined }
  | { state: "reading" }
  | { state: "running"; report?: StorageDoctorWire }
  | { state: "loaded"; report: StorageDoctorWire }
  | { state: "failed"; message: string; report?: StorageDoctorWire };
type CheckTone = "pass" | "attention" | "unavailable" | "neutral";
interface CheckResult { tone: CheckTone; value: string; evidence?: string; detail?: string; detailLabel?: string; extra?: ReactNode }
const NOT_CHECKED: CheckResult = { tone: "neutral", value: "Not checked" };

function CheckRow({ name, description, result }: { name: string; description: string; result: CheckResult }) {
  const status = result.tone === "pass"
    ? <span className="diagnostic-check-status"><StatusDot status="verifiedDone" />{result.value}</span>
    : result.tone === "neutral"
      ? <span className="diagnostic-check-status diagnostic-check-status-neutral">{result.value}</span>
      : <Badge tone={result.tone === "attention" ? "warning" : "danger"}>{result.value}</Badge>;
  return <div className="diagnostic-check-entry" role="listitem">
    <ResultRow label={name} description={<><span>{description}</span>
      {result.evidence !== undefined && <span className="diagnostic-check-evidence">{result.evidence}</span>}
      {result.detail !== undefined && <span className="diagnostic-check-evidence">
        {result.detailLabel !== undefined && <><strong>{result.detailLabel}:</strong> </>}{result.detail}
      </span>}
    </>} value={status} />
    {result.extra !== undefined && <div className="diagnostic-check-detail diagnostic-storage-detail">
      {result.extra}
    </div>}
  </div>;
}

function CheckGroup({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <BodySection title={title}>
    <p className="diagnostic-section-description">{subtitle}</p>
    <FormGroup label={title}><div role="list">{children}</div></FormGroup>
  </BodySection>;
}

const COUNT_CHECKS = [
  { key: "pendingCommands", name: "Pending commands", description: "Commands accepted but not yet completed." },
  { key: "unresolvedWriteIntents", name: "Unresolved writes", description: "Database changes that still need a final outcome." },
  { key: "leases", name: "Active leases", description: "Work currently held by a worker." },
  { key: "providerReservations", name: "Provider reservations", description: "External provider work reserved by this system." },
  { key: "artifactOutbox", name: "Artifact outbox", description: "Artifacts waiting to be published." },
] as const;
const CREDENTIAL_CHECKS = [
  { key: "ucpathUserId", name: "UCPath user ID", description: "Login name for UCPath access." },
  { key: "ucpathPassword", name: "UCPath password", description: "Password for UCPath access." },
  { key: "timekeeperName", name: "Timekeeper name", description: "Name used for timekeeping workflows." },
  { key: "sharepointOnboardingRosterUrl", name: "SharePoint onboarding roster URL", description: "Location of the onboarding roster." },
  { key: "activityPersonPseudonym", name: "Activity person pseudonym", description: "Identifier used in activity records." },
] as const;

function authorityResult(report?: StorageDoctorWire): CheckResult {
  if (report === undefined) return NOT_CHECKED;
  if (report.authority.state === "degraded") return { tone: "unavailable", value: "Needs attention", detail: `${report.authority.cause.code}: ${report.authority.cause.summary}` };
  return { tone: "pass", value: "Passed", evidence: `Schema v${report.authority.schemaVersion} · generation ${report.authority.authorityGeneration} · ${plural(report.authority.pageCount, "page")}` };
}
function recoveryResult(report?: StorageDoctorWire): CheckResult {
  if (report === undefined) return NOT_CHECKED;
  const recovery = report.recovery;
  if (recovery.state === "clear") return { tone: "pass", value: "Clear", evidence: "No interruption markers" };
  return {
    tone: recovery.state === "interrupted" ? "attention" : "unavailable",
    value: recovery.state === "interrupted" ? "Interrupted" : "Unavailable",
    detail: recovery.state === "unavailable" ? recovery.cause.summary : "An interrupted operation needs review before startup.",
    evidence: recovery.findings.map((finding) => `${finding.marker}: ${finding.state}`).join(" · ") || undefined,
  };
}
function spanResult(report?: StorageDoctorWire): CheckResult {
  if (report === undefined) return NOT_CHECKED;
  const span = report.spanAuthority;
  if (span.state === "unavailable") return { tone: "unavailable", value: "Unavailable", detail: `${span.cause.code}: ${span.cause.summary}` };
  return {
    tone: span.state === "reconciled" ? "pass" : "attention",
    value: span.state === "reconciled" ? "Reconciled" : "Needs attention",
    evidence: `${plural(span.streamRunCount, "stream run")} · ${plural(span.liveRunCount, "live run")} · ${plural(span.archived.length, "archived run")} · ${plural(span.deleted.length, "deleted run")}`,
    detailLabel: span.state === "degraded" ? plural(span.problems.length, "run record issue") : undefined,
    detail: span.state === "degraded" ? span.problems.map((problem) => {
      const label = {
        missing: "Run missing",
        "restore-loss": "Run missing after recovery",
        "missing-span": "Activity history missing",
        "malformed-authority": "Run record unreadable",
        malformed: "Activity data unreadable",
      }[problem.state];
      return `${label}: ${spanAuthorityProblemDetail(problem)}`;
    }).join(" · ") : undefined,
    extra: span.archived.length > 0 ? <Disclosure summary={plural(span.archived.length, "archived run")}>
      <ul>{span.archived.map((run) => <li key={run.runId} title={run.archivedAt}>
        {run.runId} · {fmtInstantDay(run.archivedAt)} {fmtClock(run.archivedAt)}
      </li>)}</ul>
    </Disclosure> : undefined,
  };
}
function upgradeResult(report?: StorageDoctorWire): CheckResult {
  if (report === undefined) return NOT_CHECKED;
  const upgrades = report.authorityUpgrades;
  if (upgrades.state === "unavailable") return { tone: "unavailable", value: "Unavailable", detail: upgrades.cause.summary };
  if (upgrades.state === "absent") return { tone: "neutral", value: "No history", evidence: upgrades.reason === "pre-journal-schema" ? "This database predates upgrade records." : "No upgrade has been recorded." };
  return { tone: "pass", value: "Recorded", detail: upgrades.phases.map((phase) => `${phase.phase}: v${phase.fromSchemaVersion} → v${phase.toSchemaVersion} · ${fmtInstantDay(phase.recordedAt)} ${fmtClock(phase.recordedAt)}`).join(" · ") };
}
function countResult(report: StorageDoctorWire | undefined, key: typeof COUNT_CHECKS[number]["key"]): CheckResult {
  if (report === undefined) return NOT_CHECKED;
  if (report.counts.state === "unavailable") return { tone: "unavailable", value: "Unavailable", detail: report.counts.cause.summary };
  const count = report.counts.values[key];
  return { tone: "neutral", value: String(count) };
}
function credentialResult(report: StorageDoctorWire | undefined, key: typeof CREDENTIAL_CHECKS[number]["key"]): CheckResult {
  if (report === undefined) return NOT_CHECKED;
  if (report.protectedSettings.state === "unavailable") return { tone: "unavailable", value: "Unavailable", detail: report.protectedSettings.cause.summary };
  const entry = report.protectedSettings.entries.find((item) => item.name === key);
  if (entry === undefined) return { tone: "unavailable", value: "Unknown", detail: "This credential was not included in the inspection." };
  return { tone: "neutral", value: entry.present ? "Present" : "Not set" };
}

export function StorageSection({ storage }: { storage: StorageHealthSummary }) {
  const client = useStorageClient();
  const [doctor, setDoctor] = useState<DoctorState>({ state: "reading" });
  useEffect(() => {
    let active = true;
    client.latestStorageDoctor().then(
      latest => { if (active) setDoctor(latest.state === "completed" ? { state: "loaded", report: latest.report } : { state: "idle" }); },
      (caught: unknown) => { if (active) setDoctor({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }); },
    );
    return () => { active = false; };
  }, [client]);
  const report = doctor.state === "reading" ? undefined : doctor.report;
  const authority = storage.authority;
  const runDoctor = (): void => {
    setDoctor(previous => ({ state: "running", report: previous.state === "reading" ? undefined : previous.report }));
    client.storageDoctor().then(
      (next) => setDoctor({ state: "loaded", report: next }),
      (caught: unknown) => setDoctor(previous => ({ state: "failed", report: previous.state === "reading" ? undefined : previous.report,
        message: caught instanceof Error ? caught.message : String(caught) })),
    );
  };
  return <section className="diagnostics-page ds-body-stack" aria-label="Storage checks">
    <PageHeading as="h2" title="Storage checks" description="Data store health, diagnostics, and recovery." className="settings-heading-actions" actions={
      <Button onClick={runDoctor} disabled={doctor.state === "running" || doctor.state === "reading"} aria-label="Run the read-only storage doctor">
        {doctor.state === "running" ? "Running checks…" : doctor.state === "reading" ? "Loading last check…" : report === undefined ? "Run storage checks" : "Run checks again"}
      </Button>
    } />
    <p className="diagnostic-status">{report === undefined ? doctor.state === "reading" ? "Loading last storage check…" : "No completed checks in this server session" : `Last checked ${fmtInstantDay(report.checkedAt)} ${fmtClock(report.checkedAt)}`}</p>
      {authority === "healthy"
        ? <FormGroup label="Data store summary" className="diagnostic-summary">
          <ResultRow label={<span className="diagnostic-summary-label"><StatusDot status="verifiedDone" />Data store available</span>}
            description={report === undefined
              ? "The latest summary can read the data store. Run the checks below for detailed results."
              : "Showing the last completed read-only check. Run checks again to refresh these results."}
            value={<span className="diagnostic-summary-meta">{report === undefined ? "Detailed checks not run" : "Last completed check"}</span>} />
        </FormGroup>
        : <Banner tone="danger" title="Data store unavailable">{AUTHORITY_HAZARD}</Banner>}
      {doctor.state === "failed" && <Banner tone="danger" title="Storage checks could not finish">{doctor.message}</Banner>}
      <CheckGroup title="Data store and recovery" subtitle="Integrity, interrupted work, run records, and upgrades.">
        <CheckRow name="Database integrity" description="Can the current data store be read and verified?" result={authorityResult(report)} />
        <CheckRow name="Interrupted operation" description="Are any prior storage operations still unfinished?" result={recoveryResult(report)} />
        <CheckRow name="Run record consistency" description="Do run records match their activity history?" result={spanResult(report)} />
        <CheckRow name="Upgrade record" description="What schema upgrades have been recorded?" result={upgradeResult(report)} />
      </CheckGroup>
      <CheckGroup title="Work in progress" subtitle="Counts at the last check; a nonzero value can be normal while work is running.">
        {COUNT_CHECKS.map((check) => <CheckRow key={check.key} name={check.name} description={check.description} result={countResult(report, check.key)} />)}
      </CheckGroup>
      <CheckGroup title="Independent credentials" subtitle="Presence only. Unset credentials affect their workflows, not data store integrity.">
        {CREDENTIAL_CHECKS.map((check) => <CheckRow key={check.key} name={check.name} description={check.description} result={credentialResult(report, check.key)} />)}
      </CheckGroup>
  </section>;
}
