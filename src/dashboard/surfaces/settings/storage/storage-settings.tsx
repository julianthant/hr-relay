import { type ReactNode, useRef, useState } from "react";
import type { StorageDoctorWire } from "../../../../models/dashboard/storage.js";
import type { ClearRunHistoryRequest } from "../../../../models/dashboard/run-history.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { Badge,BodySection,Button,Dialog,DialogContent,DialogFooter,Disclosure,FormGroup,PageHeading,ResultRow,StatusDot, Notice } from "../../../ds/ui.js";
import { useDelayedLoading } from "../../shared/loading/loading-model.js";
import { SkeletonText } from "../../shared/loading/loading.js";
import "../../shared/run-evidence/diagnostic-presentation.css";
import { fmtClock,fmtInstantDay } from "../../shared/status/format.js";
import type { StorageHealthSummary } from "./storage-settings-model.js";
import { useRestoreNotice,useStorageDoctor } from "./storage-settings-model.js";
import { useRunHistory } from "./run-history-model.js";

const AUTHORITY_HAZARD = ERROR_CATALOG.STORAGE_AUTHORITY_UNAVAILABLE.text;

/** The bootstrap summary is cheap; the checklist only claims results from a doctor report. */
export function StorageNotice({ storage }: {
  storage: StorageHealthSummary;
}) {
  if (storage.authority === "healthy") return null;
  return <Notice sticky tone="danger" title="Storage unavailable" description={`${AUTHORITY_HAZARD} Open Settings > Storage.`} />;
}

type CheckTone = "pass" | "attention" | "unavailable" | "neutral";
interface CheckResult { tone: CheckTone; value: string; summary?: string; evidence?: string; detail?: string }
const NOT_CHECKED: CheckResult = { tone: "neutral", value: "Not checked" };

function CheckRow({ name, description, result, findings = false, pending = false, loading = false }: { name: string; description: string; result: CheckResult; findings?: boolean; pending?: boolean; loading?: boolean }) {
  const status = result.tone === "pass"
    ? <span className="diagnostic-check-status"><StatusDot status="verifiedDone" />{result.value}</span>
    : result.tone === "neutral"
      ? <span className="diagnostic-check-status diagnostic-check-status-neutral">{result.value}</span>
      : <Badge tone={result.tone === "attention" ? "warning" : "danger"}>{result.value}</Badge>;
  return <div className="diagnostic-check-entry" role="listitem">
    <ResultRow label={name} description={result.summary ?? description} value={pending ? loading && <SkeletonText className="w-20" /> : status} />
    {findings && result.detail !== undefined && <div className="diagnostic-check-detail diagnostic-storage-detail">
      <DiagnosticFindings name={name} result={result} />
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
  { key: "sharepointOnboardingRosterUrl", name: "SharePoint roster", description: "Link to the onboarding roster." },
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
  return { tone: "pass", value: "Recorded", summary: "Recorded changes to your saved data." };
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

function RestoreNotice({ backupCapturedAt }: { backupCapturedAt: string }) {
  return <Notice sticky tone="warning" title={`Restored from the ${fmtInstantDay(backupCapturedAt)} ${fmtClock(backupCapturedAt)} backup.`} description="Check UCPath for anything done after that." />;
}

export function StorageSection({ storage, onHistoryCleared }: { storage: StorageHealthSummary; onHistoryCleared?: () => void }) {
  const { doctor, runDoctor } = useStorageDoctor();
  const history = useRunHistory(onHistoryCleared);
  const [confirming, setConfirming] = useState<ClearRunHistoryRequest>();
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const restored = useRestoreNotice();
  const show = useDelayedLoading(doctor.state === "reading");
  const report = doctor.state === "reading" ? undefined : doctor.report;
  const pending = report === undefined && (doctor.state === "reading" || doctor.state === "running" || doctor.state === "failed" && !doctor.neverRun);
  const authority = storage.authority === "healthy" && report?.authority.state !== "degraded" ? "healthy" : "unavailable";
  const checks = [
    { name: "Stored data", description: "Readability of saved data.", result: authorityResult(report) },
    { name: "Recovery", description: "Unfinished storage operations.", result: recoveryResult(report) },
    { name: "Storage updates", description: "History of changes to saved data.", result: upgradeResult(report) },
  ];
  return <section className="diagnostics-page ds-body-stack" aria-label="Storage checks" aria-busy={doctor.state === "reading" || undefined}>
    {restored && <RestoreNotice backupCapturedAt={restored.backupCapturedAt} />}
    <PageHeading title="Storage checks" description="Check saved data." className="settings-heading-actions" actions={
      <Button onClick={runDoctor} disabled={doctor.state === "running" || doctor.state === "reading"}>
        {doctor.state === "running" ? "Running checks…" : doctor.state === "reading" ? "Loading last check…" : report === undefined ? "Run storage checks" : "Run checks again"}
      </Button>
    } />
    {storage.authority === "healthy" && authority !== "healthy" && <Notice sticky tone="danger" title="Data store unavailable" description="Review the storage checks." />}
    {(authority === "healthy" || report !== undefined) && <BodySection title="Status">
      {doctor.state === "reading" && <span role="status" aria-label="Loading storage checks" className="sr-only">Loading storage checks</span>}
      {authority !== "healthy" && report !== undefined && <p className="diagnostic-status">Last checked <time dateTime={report.checkedAt}>{fmtInstantDay(report.checkedAt)} {fmtClock(report.checkedAt)}</time></p>}
      {authority === "healthy"
        ? <FormGroup label="Data store summary" className="diagnostic-summary">
          <ResultRow controlWidth="wide" label={<span className="diagnostic-summary-label"><StatusDot status="verifiedDone" />Data store available</span>}
            value={<span className="diagnostic-summary-meta diagnostic-storage-summary-meta">
              {pending ? show && <SkeletonText className="w-40" /> : report === undefined ? <span>Not checked</span> : <span>Last checked <time dateTime={report.checkedAt}>{fmtInstantDay(report.checkedAt)} {fmtClock(report.checkedAt)}</time></span>}
            </span>} />
        </FormGroup>
        : null}
    </BodySection>}
      {doctor.state === "failed" && <Notice tone="danger" title="Storage checks could not finish" description={ERROR_CATALOG.STORAGE_DOCTOR_FAILED.text} />}
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
      <BodySection title="Run history"><FormGroup label="Run history">
        <div className="hub-settings-row">
          <div><div className="hub-row-label">Clear run history</div><span className="hub-row-note">{history.description}</span></div>
          <div className="hub-setting-control"><Button ref={historyTrigger} variant="dangerGhost" disabled={storage.authority !== "healthy" || history.disabled}
            onClick={() => history.unknown ? void history.clear() : setConfirming(history.prepare())}>{history.checking ? "Checking…" : history.pending ? "Clearing…" : history.unknown ? "Check clear result" : "Clear run history"}</Button></div>
        </div>
        {history.message && <p role="status" className="px-[var(--ds-space-loose)] pb-[var(--ds-space-cozy)]">{history.message}</p>}
        <Dialog open={confirming !== undefined} onOpenChange={open => { if (!open) setConfirming(undefined); }}>
          <DialogContent title="Clear run history?" description="All finished runs, logs, screenshots and run evidence will be removed. Spreadsheets, settings, credentials, your account and write-safety records are kept. This can’t be undone." size="sm"
            onCloseAutoFocus={event => { event.preventDefault(); historyTrigger.current?.focus(); }}>
            <DialogFooter><Button variant="secondary" autoFocus onClick={() => setConfirming(undefined)}>Cancel</Button><Button variant="danger" disabled={history.disabled || storage.authority !== "healthy"}
              onClick={() => { setConfirming(undefined); void history.clear(confirming); }}>Clear run history</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </FormGroup></BodySection>
  </section>;
}
