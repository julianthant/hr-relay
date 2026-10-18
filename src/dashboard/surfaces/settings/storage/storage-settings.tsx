import { useDelayedLoading } from "../../shared/loading/loading-model.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { SkeletonText } from "../../shared/loading/loading.js";
import { ShieldAlert } from "lucide-react";
import { type ReactNode } from "react";
import type { StorageDoctorWire } from "../../../../models/dashboard/storage.js";
import { Badge, Banner, BodySection, Button, Disclosure, FormGroup, PageHeading, ResultRow, StatusDot, dsIcon } from "../../../ds/ui.js";
import { useStorageDoctor } from "./storage-settings-model.js";
import { fmtClock, fmtInstantDay } from "../../shared/status/format.js";
import type { StorageHealthSummary } from "./storage-settings-model.js";
import "../../shared/run-evidence/diagnostic-presentation.css";

const AUTHORITY_HAZARD = ERROR_CATALOG.STORAGE_AUTHORITY_UNAVAILABLE.text;

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

type CheckTone = "pass" | "attention" | "unavailable" | "neutral";
interface CheckResult { tone: CheckTone; value: string; summary?: string; overview?: ReactNode; evidence?: string; detail?: string }
const NOT_CHECKED: CheckResult = { tone: "neutral", value: "Not checked" };

function CheckRow({ name, description, result, findings = false, pending = false, loading = false }: { name: string; description: string; result: CheckResult; findings?: boolean; pending?: boolean; loading?: boolean }) {
  const status = result.tone === "pass"
    ? <span className="diagnostic-check-status"><StatusDot status="verifiedDone" />{result.value}</span>
    : result.tone === "neutral"
      ? <span className="diagnostic-check-status diagnostic-check-status-neutral">{result.value}</span>
      : <Badge tone={result.tone === "attention" ? "warning" : "danger"}>{result.value}</Badge>;
  return <div className="diagnostic-check-entry" role="listitem">
    <ResultRow label={name} description={result.summary ?? description} value={pending ? loading && <SkeletonText className="w-20" /> : status} />
    {(result.overview !== undefined || (findings && result.detail !== undefined)) && <div className="diagnostic-check-detail diagnostic-storage-detail">
      {result.overview}
      {findings && <DiagnosticFindings name={name} result={result} />}
    </div>}
  </div>;
}

function DiagnosticFindings({ name, result }: { name: string; result: CheckResult }) {
  if (result.detail === undefined) return null;
  return <Disclosure summary="Diagnostic details" className="diagnostic-storage-disclosure" contentClassName="diagnostic-storage-findings">
    <section aria-label={`${name} diagnostics`}>
      {result.evidence !== undefined && <p className="diagnostic-check-evidence">{result.evidence}</p>}
      <p className="diagnostic-check-evidence whitespace-pre-line">{result.detail}</p>
    </section>
  </Disclosure>;
}

function CheckGroup({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <BodySection title={title} description={subtitle}>
    <FormGroup label={title}><div role="list">{children}</div></FormGroup>
  </BodySection>;
}

const COUNT_CHECKS = [
  { key: "pendingCommands", name: "Pending actions", description: "Accepted actions that have not finished." },
  { key: "unresolvedWriteIntents", name: "Changes awaiting confirmation", description: "Changes still waiting for their final outcome." },
  { key: "leases", name: "Assigned work", description: "Tasks currently held by a worker." },
  { key: "providerReservations", name: "Provider tasks", description: "Tasks reserved with an external provider." },
  { key: "artifactOutbox", name: "Pending outputs", description: "Outputs waiting to be published." },
] as const;
const CREDENTIAL_CHECKS = [
  { key: "ucpathUserId", name: "UCPath user ID", description: "Login name for UCPath access." },
  { key: "ucpathPassword", name: "UCPath password", description: "Password for UCPath access." },
  { key: "timekeeperName", name: "Timekeeper name", description: "Name used for timekeeping workflows." },
  { key: "sharepointOnboardingRosterUrl", name: "SharePoint roster", description: "Link to the onboarding roster." },
  { key: "activityPersonPseudonym", name: "Activity identity", description: "Identifier used in activity records." },
] as const;

function authorityResult(report?: StorageDoctorWire): CheckResult {
  if (report === undefined) return NOT_CHECKED;
  if (report.authority.state === "degraded") return { tone: "unavailable", value: "Unavailable", summary: ERROR_CATALOG.STORAGE_AUTHORITY_READ_FAILED.text, detail: `${report.authority.cause.code}: ${report.authority.cause.summary}` };
  return { tone: "pass", value: "Passed", summary: "Stored data is readable." };
}
function recoveryResult(report?: StorageDoctorWire): CheckResult {
  if (report === undefined) return NOT_CHECKED;
  const recovery = report.recovery;
  if (recovery.state === "clear") return { tone: "pass", value: "Clear", summary: "No unfinished storage operations." };
  return {
    tone: recovery.state === "interrupted" ? "attention" : "unavailable",
    value: recovery.state === "interrupted" ? "Interrupted" : "Unavailable",
    summary: recovery.state === "interrupted" ? ERROR_CATALOG.STORAGE_RECOVERY_INTERRUPTED.text : ERROR_CATALOG.STORAGE_RECOVERY_UNAVAILABLE.text,
    detail: recovery.state === "unavailable" ? recovery.cause.summary : ERROR_CATALOG.STORAGE_RECOVERY_STARTUP_INTERRUPTED.text,
    evidence: recovery.findings.map((finding) => `${finding.marker}: ${finding.state}`).join(" · ") || undefined,
  };
}
function upgradeResult(report?: StorageDoctorWire): CheckResult {
  if (report === undefined) return NOT_CHECKED;
  const upgrades = report.authorityUpgrades;
  if (upgrades.state === "unavailable") return { tone: "unavailable", value: "Unavailable", summary: ERROR_CATALOG.STORAGE_UPDATE_HISTORY_UNAVAILABLE.text, detail: upgrades.cause.summary };
  if (upgrades.state === "absent") return { tone: "neutral", value: "No history", summary: upgrades.reason === "pre-journal-schema" ? "Update history wasn't recorded for this older data store." : "No storage updates have been recorded." };
  const labels = { baseline: "Starting version recorded", planned: "Update planned", committed: "Update applied", settled: "Update completed" };
  return { tone: "pass", value: "Recorded", summary: "Recorded changes to your saved data.", overview: <Disclosure summary="Update history" className="diagnostic-storage-disclosure">
    <ul className="diagnostic-storage-updates">{upgrades.phases.map((phase, index) => <li key={index}>
      <span>{labels[phase.phase]}</span><time dateTime={phase.recordedAt}>{fmtInstantDay(phase.recordedAt)} {fmtClock(phase.recordedAt)}</time>
    </li>)}</ul>
  </Disclosure> };
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
  if (entry === undefined) return { tone: "unavailable", value: "Unknown", summary: ERROR_CATALOG.STORAGE_CREDENTIAL_CHECK_INCOMPLETE.text };
  return { tone: "neutral", value: entry.present ? "Present" : "Not set" };
}

export function StorageSection({ storage }: { storage: StorageHealthSummary }) {
  const { doctor, runDoctor } = useStorageDoctor();
  const show = useDelayedLoading(doctor.state === "reading");
  const report = doctor.state === "reading" ? undefined : doctor.report;
  const pending = report === undefined && doctor.state !== "idle";
  const authority = storage.authority === "healthy" && report?.authority.state !== "degraded" ? "healthy" : "unavailable";
  const checks = [
    { name: "Stored data", description: "Readability of saved data.", result: authorityResult(report) },
    { name: "Recovery", description: "Unfinished storage operations.", result: recoveryResult(report) },
    { name: "Storage updates", description: "History of changes to saved data.", result: upgradeResult(report) },
  ];
  return <section className="diagnostics-page ds-body-stack" aria-label="Storage checks" aria-busy={doctor.state === "reading" || undefined}>
    <PageHeading title="Storage checks" description="Check saved data." className="settings-heading-actions" actions={
      <Button onClick={runDoctor} disabled={doctor.state === "running" || doctor.state === "reading"}>
        {doctor.state === "running" ? "Running checks…" : doctor.state === "reading" ? "Loading last check…" : report === undefined ? "Run storage checks" : "Run checks again"}
      </Button>
    } />
    <BodySection title="Status">
      {doctor.state === "reading" && <span role="status" aria-label="Loading storage checks" className="sr-only">Loading storage checks</span>}
      {authority !== "healthy" && report !== undefined && <p className="diagnostic-status">Last checked <time dateTime={report.checkedAt}>{fmtInstantDay(report.checkedAt)} {fmtClock(report.checkedAt)}</time></p>}
      {authority === "healthy"
        ? <FormGroup label="Data store summary" className="diagnostic-summary">
          <ResultRow controlWidth="wide" label={<span className="diagnostic-summary-label"><StatusDot status="verifiedDone" />Data store available</span>}
            value={<span className="diagnostic-summary-meta diagnostic-storage-summary-meta">
              {pending ? show && <SkeletonText className="w-40" /> : report === undefined ? <span>Not checked</span> : <span>Last checked <time dateTime={report.checkedAt}>{fmtInstantDay(report.checkedAt)} {fmtClock(report.checkedAt)}</time></span>}
            </span>} />
        </FormGroup>
        : <Banner tone="danger" title="Data store unavailable">{ERROR_CATALOG.STORAGE_DATA_UNAVAILABLE.text}</Banner>}
    </BodySection>
      {doctor.state === "failed" && <Banner tone="danger" title="Storage checks could not finish">
        {ERROR_CATALOG.STORAGE_DOCTOR_FAILED.text}
        <DiagnosticFindings name="Check error" result={{ tone: "unavailable", value: "Unavailable", detail: doctor.message }} />
      </Banner>}
      <BodySection title="Data store and recovery">
        <FormGroup label="Storage health checks"><div role="list">
        {checks.map(check => <CheckRow pending={pending} loading={show} findings key={check.name} {...check} />)}
        </div></FormGroup>
      </BodySection>
      <CheckGroup title="Work in progress" subtitle="Work waiting, assigned or awaiting confirmation. Counts can be normal while tasks are running.">
        {COUNT_CHECKS.map(check => <CheckRow pending={pending} loading={show} key={check.key} name={check.name} description={check.description} result={countResult(report, check.key)} />)}
        {report?.counts.state === "unavailable" && <div className="diagnostic-check-detail"><DiagnosticFindings name="Work in progress" result={{ tone: "unavailable", value: "Unavailable", detail: report.counts.cause.summary }} /></div>}
      </CheckGroup>
      <CheckGroup title="Connections" subtitle="Saved credentials and connection settings. Missing values affect only the workflows that use them.">
        {CREDENTIAL_CHECKS.map(check => <CheckRow pending={pending} loading={show} key={check.key} name={check.name} description={check.description} result={credentialResult(report, check.key)} />)}
        {report?.protectedSettings.state === "unavailable" && <div className="diagnostic-check-detail"><DiagnosticFindings name="Connections" result={{ tone: "unavailable", value: "Unavailable", detail: report.protectedSettings.cause.summary }} /></div>}
      </CheckGroup>
  </section>;
}
