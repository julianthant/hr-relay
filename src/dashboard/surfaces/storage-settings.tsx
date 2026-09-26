import { Database, ShieldAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { StorageDoctorWire } from "../../domain/dashboard/storage.js";
import { Banner, Button, Panel, PanelBody, PanelHeader, dsIcon } from "../ds/ui.js";
import { useStorageClient } from "../state/storage-client.js";
import { fmtClock, fmtInstantDay, plural } from "./format.js";
import { spanAuthorityProblemDetail, type StorageHealthSummary } from "./storage-settings-model.js";

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
  | { state: "idle" }
  | { state: "loading" }
  | { state: "loaded"; report: StorageDoctorWire }
  | { state: "failed"; message: string };
type CheckTone = "pass" | "attention" | "unavailable" | "neutral";
interface CheckResult { tone: CheckTone; value: string; evidence?: string; detail?: string; detailLabel?: string; extra?: ReactNode }
const NOT_CHECKED: CheckResult = { tone: "neutral", value: "Not checked" };

function CheckRow({ name, description, result }: { name: string; description: string; result: CheckResult }) {
  return <div className="storage-check-row" role="listitem">
    <div className="storage-check-copy">
      <span className="storage-check-name">{name}</span>
      <span className="storage-check-description">{description}</span>
      {result.detail !== undefined && (result.detailLabel === undefined
        ? <span className="storage-check-detail">{result.detail}</span>
        : <details className="storage-check-detail"><summary>{result.detailLabel}</summary><span>{result.detail}</span></details>)}
      {result.extra}
    </div>
    <div className="storage-check-result">
      <span className={`storage-check-badge storage-check-badge--${result.tone}`}>{result.value}</span>
      {result.evidence !== undefined && <span className="storage-check-evidence">{result.evidence}</span>}
    </div>
  </div>;
}

function CheckGroup({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return <section className="storage-check-group" aria-label={title}>
    <h3>{title}</h3><p>{subtitle}</p>
    <div className="settings-group-rows" role="list">{children}</div>
  </section>;
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
    extra: span.archived.length > 0 ? <details className="storage-check-detail">
      <summary>{plural(span.archived.length, "archived run")}</summary>
      <ul>{span.archived.map((run) => <li key={run.runId} title={run.archivedAt}>
        {run.runId} · {fmtInstantDay(run.archivedAt)} {fmtClock(run.archivedAt)}
      </li>)}</ul>
    </details> : undefined,
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
  const [doctor, setDoctor] = useState<DoctorState>({ state: "idle" });
  const report = doctor.state === "loaded" ? doctor.report : undefined;
  const authority = report?.authority.state ?? storage.authority;
  const runDoctor = (): void => {
    setDoctor({ state: "loading" });
    client.storageDoctor().then(
      (next) => setDoctor({ state: "loaded", report: next }),
      (caught: unknown) => setDoctor({ state: "failed", message: caught instanceof Error ? caught.message : String(caught) }),
    );
  };
  return <Panel className="settings-page-panel storage-checks-page">
    <PanelHeader title="Storage checks" headingLevel={2}
      subtitle="Read-only checks of the data store, unfinished work, and independent credentials."
      icon={<Database aria-hidden className={dsIcon.lg} />} />
    <PanelBody className="settings-page-body">
      <div className="storage-check-toolbar">
        <span>{report === undefined ? `Summary checked ${fmtClock(storage.checkedAt)}` : `Checks completed ${fmtClock(report.checkedAt)}`}</span>
        <Button size="sm" onClick={runDoctor} disabled={doctor.state === "loading"} aria-label="Run the read-only storage doctor">
          {doctor.state === "loading" ? "Running checks…" : report === undefined ? "Run storage checks" : "Run checks again"}
        </Button>
      </div>
      <Banner tone={authority === "healthy" ? "success" : "danger"}
        title={authority === "healthy" ? "Data store available" : "Data store unavailable"}>
        {authority !== "healthy" ? AUTHORITY_HAZARD : report === undefined
          ? "The latest summary can read the data store. Run the checks below for detailed results."
          : "The read-only check verified the current database."}
      </Banner>
      {doctor.state === "failed" && <Banner tone="danger" title="Storage checks could not finish">{doctor.message}</Banner>}
      <CheckGroup title="Data store and recovery" subtitle="Integrity, interrupted work, run records, and upgrades.">
        <CheckRow name="Database integrity" description="Can the current data store be read and verified?" result={authorityResult(report)} />
        <CheckRow name="Interrupted operation" description="Are any prior storage operations still unfinished?" result={recoveryResult(report)} />
        <CheckRow name="Run record consistency" description="Do run records match their activity history?" result={spanResult(report)} />
        <CheckRow name="Upgrade record" description="What schema upgrades have been recorded?" result={upgradeResult(report)} />
      </CheckGroup>
      <CheckGroup title="Work in progress" subtitle="Current counts; a nonzero value can be normal while work is running.">
        {COUNT_CHECKS.map((check) => <CheckRow key={check.key} name={check.name} description={check.description} result={countResult(report, check.key)} />)}
      </CheckGroup>
      <CheckGroup title="Independent credentials" subtitle="Presence only. Unset credentials affect their workflows, not data store integrity.">
        {CREDENTIAL_CHECKS.map((check) => <CheckRow key={check.key} name={check.name} description={check.description} result={credentialResult(report, check.key)} />)}
      </CheckGroup>
    </PanelBody>
  </Panel>;
}
