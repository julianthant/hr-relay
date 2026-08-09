/**
 * The read-only Archive and the version-bump flow (doc 03 §10.2 D80, doc 13 §5,
 * D179).
 *
 * ## THESIS — a record, and the act that made it one
 *
 * Charter §25's archive is not a wastebasket and it is not a second queue. It
 * is what the dashboard KEEPS when a workflow's shape moves: every run of the
 * prior version leaves the live surfaces in one act, and what remains of it is
 * a frozen row nobody may touch. So this page is built as a **ledger of
 * sweeps**, not a list of runs: each applied bump is a section header laying
 * its date and its count on the same tracks as the rows beneath it, so a
 * sweep's date sits directly over the dates of the runs it swept and the shape
 * of "these left together, on this day, because this moved" is readable
 * without expanding anything. The `--ds-w-archive-*` width tokens exist for
 * exactly that alignment.
 *
 * ## Read-only is structural, not a disabled button
 *
 * There is no retry, no cancel, no hide, no resolution and no edit on this
 * surface — not greyed out, ABSENT — because an archived run has no live
 * authority to act on. The one control is **Relaunch**, and it is not an
 * action on the archived run at all: it starts a FRESH run on the current
 * version from the archived input, which is why it sits in the header with a
 * label that says so and why the archived run stays exactly where it was
 * afterwards.
 *
 * ## The bump is on this page on purpose
 *
 * The version-bump flow is what fills the archive, so it lives beside it
 * rather than in Settings: plan → read the list → apply, in place. It is not a
 * modal. A modal "Are you sure?" would be a weaker guard than what is actually
 * here — the plan IS the confirmation, and the list of non-terminal runs that
 * block it is the thing the operator has to act on, so it is rendered as
 * content rather than dismissed as an alert. **Apply stays clickable while
 * blockers exist**, because the refusal is the contract: the server computes
 * blockers inside the applying transaction and its verbatim sentence is what
 * this surface shows. A button disabled by a client-side count would be the
 * client claiming to know what only that transaction can.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Archive as ArchiveIcon,
  ArrowLeft,
  CircleAlert,
  FileClock,
  History,
  RotateCw,
  Layers,
} from "lucide-react";
import { cn } from "../lib/utils.js";
import {
  Badge,
  BulletList,
  Button,
  Chip,
  EmptyState,
  KeyValueList,
  MetaLine,
  PageHeader,
  Panel,
  PanelBody,
  PanelHeader,
  Refusal,
  SearchInput,
  SectionLabel,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  TimelineSteps,
  Well,
  type DsStep,
  dsIcon,
  dsText,
  useDsEnterTransition,
} from "../ds/ui.js";
import { systemClock } from "../../domain/clock.js";
import type {
  ArchiveEntryWire,
  ArchiveIndexWire,
  ArchivedRunDetailWire,
  VersionBumpPlanWire,
  WorkflowVersionStateWire,
} from "../../domain/dashboard/archive.js";
import type { CommandResult } from "../../domain/commands.js";
import { DashboardClientError } from "../client/errors.js";
import { useDashboardClient } from "../state/client-context.js";
import { failed, loaded, LOADING, type AsyncResource } from "../state/async-resource.js";
import { fmtClock } from "./format.js";
import { dsStatusOf, StatusBadge } from "./status.js";

const SOURCE_SURFACE = "archive";

/** The index sentinel: `?archive=` with no run id is the ledger itself. */
export const ARCHIVE_INDEX = "";

/**
 * Why a run is prior-version, in the operator's words. The wire's reasons are a
 * closed set; naming them here keeps the archive from printing an enum.
 */
const DRIFT_TEXT: Record<string, string> = {
  "descriptor-version": "version bumped",
  "contract-fingerprint": "shape changed",
  "app-version": "app build changed",
  "app-version-unstamped": "app build unrecorded",
};

function driftWords(drift: readonly string[]): string {
  return drift.map((reason) => DRIFT_TEXT[reason] ?? reason).join(" · ");
}

function shortHash(value: string): string {
  return value.slice(0, 8);
}

/* ── the ledger ──────────────────────────────────────────────────────────── */

interface Sweep {
  readonly applicationId: string;
  readonly heading: string;
  readonly appliedAt: string;
  readonly scope: string;
  readonly count: number;
  readonly entries: readonly ArchiveEntryWire[];
}

function scopeText(scope: ArchiveIndexWire["sweeps"][number]["scope"]): string {
  return scope.kind === "application"
    ? `app ${scope.applicationVersion}`
    : scope.workflowIds.join(", ");
}

/**
 * Sweeps, newest first, each carrying the entries it archived. A sweep with no
 * surviving entry after filtering is dropped rather than rendered empty — an
 * empty section header is a heading for nothing.
 */
function buildSweeps(wire: ArchiveIndexWire, query: string): readonly Sweep[] {
  const needle = query.trim().toLowerCase();
  const matches = (entry: ArchiveEntryWire): boolean => {
    if (needle.length === 0) return true;
    return [entry.title, entry.traceId, entry.workflowLabel, entry.workflowId]
      .some((field) => field.toLowerCase().includes(needle));
  };
  return wire.sweeps
    .map((sweep) => ({
      applicationId: sweep.applicationId,
      heading: `to ${sweep.targetVersion}`,
      appliedAt: sweep.appliedAt,
      scope: scopeText(sweep.scope),
      count: sweep.archivedCount,
      entries: wire.entries.filter((entry) => entry.applicationId === sweep.applicationId).filter(matches),
    }))
    .filter((sweep) => sweep.entries.length > 0);
}

function ArchiveLedger({
  wire,
  query,
  onQuery,
  selectedRunId,
  onSelect,
}: {
  wire: ArchiveIndexWire;
  query: string;
  onQuery: (next: string) => void;
  selectedRunId: string | undefined;
  onSelect: (runId: string) => void;
}) {
  const sweeps = useMemo(() => buildSweeps(wire, query), [wire, query]);
  const total = wire.entries.length;

  if (total === 0) {
    return (
      <EmptyState
        icon={<ArchiveIcon aria-hidden className={dsIcon.lg} />}
        title="Nothing has been archived yet"
        description={
          "A run reaches the archive when its workflow's version bumps — its shape moved, so it is no longer "
          + "comparable with what runs today. Plan a bump below to see which runs a sweep would take."
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-base)]">
      <SearchInput
        aria-label="Filter archived runs"
        placeholder="Filter by trace, title or workflow"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onClear={() => onQuery("")}
      />
      {sweeps.length === 0 ? (
        <EmptyState
          icon={<ArchiveIcon aria-hidden className={dsIcon.lg} />}
          title="No archived run matches that filter"
          description={`${String(total)} archived ${total === 1 ? "run is" : "runs are"} held; none of them match “${query}”.`}
          action={<Button size="sm" variant="secondary" onClick={() => onQuery("")}>Clear the filter</Button>}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto">
          <Table label="Archived runs, grouped by the version bump that swept them" layout="fixed">
            <colgroup>
              <col style={{ width: "var(--ds-w-archive-status)" }} />
              <col />
              <col style={{ width: "var(--ds-w-archive-trace)" }} />
              <col style={{ width: "var(--ds-w-archive-when)" }} />
              <col style={{ width: "var(--ds-w-archive-duration)" }} />
            </colgroup>
            <THead>
              <TR>
                <TH>Status</TH>
                <TH>Run</TH>
                <TH>Ran under</TH>
                <TH>Archived</TH>
                <TH align="right">Runs</TH>
              </TR>
            </THead>
            {sweeps.map((sweep) => (
              <TBody key={sweep.applicationId}>
                {/*
                  The sweep header lays its date on the `when` track and its
                  count on the `duration` track, so it sits directly over the
                  dates of the runs it took. That alignment is the whole reason
                  this is one table rather than a list of tables.
                */}
                <TR className="bg-[color:var(--ds-surface-2)]">
                  <TD colSpan={3}>
                    <span className="flex items-center gap-[var(--ds-space-tight)]">
                      <Layers aria-hidden className={cn(dsIcon.sm, "text-[color:var(--ds-fg-muted)]")} />
                      <SectionLabel>Version bump {sweep.heading}</SectionLabel>
                      <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{sweep.scope}</span>
                    </span>
                  </TD>
                  <TD numeric>{fmtClock(sweep.appliedAt)}</TD>
                  <TD numeric align="right">{sweep.count}</TD>
                </TR>
                {sweep.entries.map((entry) => (
                  <TR
                    key={entry.runId}
                    interactive
                    selected={entry.runId === selectedRunId}
                    data-demo-row-id={entry.runId}
                    onClick={() => onSelect(entry.runId)}
                  >
                    <TD>
                      <StatusBadge status={dsStatusOf(entry.status)} />
                    </TD>
                    <TD>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{entry.title}</span>
                        <span className={cn(dsText.meta, "truncate text-[color:var(--ds-fg-muted)]")}>
                          {entry.traceId} · {entry.workflowLabel} · {driftWords(entry.drift)}
                        </span>
                      </span>
                    </TD>
                    <TD numeric>v{entry.archivedIdentity.descriptorVersion} · {shortHash(entry.archivedIdentity.contractFingerprint)}</TD>
                    <TD numeric>{fmtClock(entry.archivedAt)}</TD>
                    {/*
                      Empty on purpose: the `Runs` track belongs to the SWEEP
                      header, which is what makes a sweep's count sit over the
                      runs it counted. A per-row value here would put two
                      different quantities on one axis.
                    */}
                    <TD />
                  </TR>
                ))}
              </TBody>
            ))}
          </Table>
        </div>
      )}
    </div>
  );
}

/* ── the version-bump flow ───────────────────────────────────────────────── */

function BumpRefusal({ result, plan }: { result: CommandResult; plan: VersionBumpPlanWire | undefined }) {
  // The hook must run before any early return; a refusal that appeared with no
  // transition after a click would read as a page change rather than as the
  // answer to that click.
  const enter = useDsEnterTransition();
  if (result.state !== "conflict" && result.state !== "rejected") return null;
  const code = result.state === "conflict" ? "version-conflict" : result.code;

  return (
    // The transition rides a wrapper because `Refusal` takes a closed prop set
    // — passing `data-demo-enter` to it would type-check (TS skips excess
    // checking on hyphenated JSX attributes) and then be silently dropped.
    <div
      {...enter}
      className={cn(
        "data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))]",
        "data-[demo-enter=from]:opacity-0 ds-motion-enter",
      )}
    >
      <Refusal
        title="The bump was refused"
        code={code}
        outcome="Nothing was archived. Every prior-version run is still exactly where it was."
        meta={plan === undefined ? [] : [`plan ${shortHash(plan.versionPlanId)}`]}
      >
        {/*
          The server's sentence, verbatim. It is the only text that names every
          blocking run, and paraphrasing it here would be a second, divergent
          account of a refusal that has exactly one author.
        */}
        <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{result.message}</p>
      </Refusal>
    </div>
  );
}

function BlockerTable({ blockers }: { blockers: WorkflowVersionStateWire["blockers"] }) {
  return (
    <div className="overflow-x-auto">
      <Table label="Prior-version runs that are not terminal">
        <THead>
          <TR>
            <TH>Run</TH>
            <TH>State</TH>
            <TH>What has to happen</TH>
          </TR>
        </THead>
        <TBody>
          {blockers.map((blocker) => (
            <TR key={blocker.runId}>
              <TD numeric>{blocker.traceId}</TD>
              <TD>{blocker.runState}</TD>
              <TD>
                {blocker.runState === "parked-write"
                  ? "Resolve the parked write present or absent — an unresolved possible-submit is never archived."
                  : blocker.runState === "parked-gate"
                    ? "Answer the open gate, or cancel the run."
                    : "Let it finish, or cancel it."}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}

function VersionBumpPanel({
  wire,
  actorId,
  busy,
  onCommand,
  result,
}: {
  wire: ArchiveIndexWire;
  actorId: string;
  busy: boolean;
  onCommand: (request: unknown) => void;
  result: CommandResult | undefined;
}) {
  const openPlan = wire.plans.find((plan) => plan.state === "planned");
  const movable = wire.versionState.filter((state) => state.archivable > 0 || state.blockers.length > 0);

  const plan = useCallback(
    (state: WorkflowVersionStateWire) => {
      onCommand({
        commandId: crypto.randomUUID(),
        requestedAt: systemClock.now().toISOString(),
        requestedBy: actorId,
        source: SOURCE_SURFACE,
        family: "version-archive",
        type: "plan-version-bump",
        target: { scope: { kind: "workflows", workflowIds: [state.workflowId] } },
        payload: {
          targetVersion: wire.currentAppVersion,
          changeFingerprint: state.current.contractFingerprint,
        },
      });
    },
    [actorId, onCommand, wire.currentAppVersion],
  );

  const apply = useCallback(() => {
    if (openPlan === undefined) return;
    onCommand({
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: actorId,
      source: SOURCE_SURFACE,
      family: "version-archive",
      type: "apply-version-bump",
      target: { versionPlanId: openPlan.versionPlanId, expectedVersion: openPlan.expectedVersion },
      payload: { planFingerprint: openPlan.planFingerprint },
    });
  }, [actorId, onCommand, openPlan]);

  return (
    <Panel aria-label="Version bump">
      <PanelHeader
        title="Version bump"
        subtitle="A bump moves every prior-version run out of the live surfaces and into this archive."
        icon={<History aria-hidden className={dsIcon.lg} />}
        meta={<span>app {wire.currentAppVersion}</span>}
      />
      <PanelBody>
        <div className="flex flex-col gap-[var(--ds-space-base)]">
          {movable.length === 0 && openPlan === undefined ? (
            <Well>
              <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>
                Every run on the live surfaces is current-version. There is nothing for a bump to move.
              </p>
            </Well>
          ) : (
            movable.map((state) => (
              <div key={state.workflowId} className="flex flex-col gap-[var(--ds-space-snug)]">
                <div className="flex items-baseline justify-between gap-[var(--ds-space-base)]">
                  <span className="flex min-w-0 flex-col">
                    <span className={dsText.ui}>{state.workflowLabel}</span>
                    <MetaLine
                      items={[
                        `now v${String(state.current.descriptorVersion)} · ${shortHash(state.current.contractFingerprint)}`,
                        `${String(state.archivable)} archivable`,
                        `${String(state.blockers.length)} blocking`,
                      ]}
                    />
                  </span>
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => plan(state)}>
                    Plan a bump
                  </Button>
                </div>
                {/*
                  The blocker list is rendered ONCE. When a plan is open it
                  belongs with the plan (that is the decision the operator is
                  about to make); until then it belongs with the workflow.
                */}
                {state.blockers.length > 0 && openPlan === undefined && <BlockerTable blockers={state.blockers} />}
              </div>
            ))
          )}

          {openPlan !== undefined && (
            <Well>
              <div className="flex flex-col gap-[var(--ds-space-snug)]">
                <SectionLabel>Reviewed plan</SectionLabel>
                <MetaLine
                  items={[
                    `plan ${shortHash(openPlan.versionPlanId)}`,
                    `${String(openPlan.candidates.length)} would be archived`,
                    `${String(openPlan.blockers.length)} would block`,
                    `planned ${fmtClock(openPlan.plannedAt)}`,
                  ]}
                />
                <BulletList
                  items={[
                    "Applying archives every prior-version run in scope. It cannot be undone — the archive is the record.",
                    "A relaunch from the archive later starts a FRESH run on the current version; it never resumes one of these.",
                  ]}
                />
                <div className="flex items-center gap-[var(--ds-space-snug)]">
                  <Button size="sm" variant="primary" loading={busy} onClick={apply}>
                    Apply the bump
                  </Button>
                  {openPlan.blockers.length > 0 && (
                    <span className={cn(dsText.meta, "flex items-center gap-[var(--ds-space-hair)] text-[color:var(--ds-status-waiting-fg)]")}>
                      <CircleAlert aria-hidden className={dsIcon.sm} />
                      This will be refused while those runs are not terminal.
                    </span>
                  )}
                </div>
              </div>
            </Well>
          )}

          {/*
            OUTSIDE the well on purpose: the blocking runs are the thing the
            operator has to act on, and a recessed surface is where this design
            system puts context, not consequence.
          */}
          {openPlan !== undefined && openPlan.blockers.length > 0 && (
            <BlockerTable blockers={openPlan.blockers} />
          )}

          {result !== undefined && <BumpRefusal result={result} plan={openPlan} />}
        </div>
      </PanelBody>
    </Panel>
  );
}

/* ── one archived run ────────────────────────────────────────────────────── */

function ArchivedRunDetail({
  detail,
  actorId,
  busy,
  onCommand,
}: {
  detail: ArchivedRunDetailWire;
  actorId: string;
  busy: boolean;
  onCommand: (request: unknown) => void;
}) {
  const relaunch = useCallback(() => {
    onCommand({
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: actorId,
      source: SOURCE_SURFACE,
      family: "version-archive",
      type: "relaunch-archived-run",
      target: { archivedRunId: detail.runId, archiveFingerprint: detail.archiveFingerprint },
    });
  }, [actorId, detail.archiveFingerprint, detail.runId, onCommand]);

  /**
   * The FROZEN timeline, mapped to the design system's step vocabulary. The
   * archived detail carries the events verbatim; nothing here re-derives a
   * state from a descriptor, which is what makes the whole page renderable
   * with the workflow registry emptied.
   */
  const steps: DsStep[] = detail.detail.timeline.events.map((event) => ({
    label: event.label,
    state: event.state === "active"
      ? "current"
      : event.state === "done" || event.state === "failed" || event.state === "skipped"
        ? event.state
        : "pending",
  }));

  return (
    <Panel aria-label={`Archived run ${detail.detail.header.title}`}>
      <PanelHeader
        title={detail.detail.header.title}
        subtitle={`${detail.workflowLabel} · ${detail.detail.header.traceId}`}
        icon={<FileClock aria-hidden className={dsIcon.lg} />}
        actions={
          detail.relaunch.state === "available" ? (
            <Button
              size="sm"
              variant="secondary"
              loading={busy}
              icon={<RotateCw aria-hidden className={dsIcon.sm} />}
              onClick={relaunch}
            >
              Relaunch as a new run
            </Button>
          ) : undefined
        }
      />
      <PanelBody>
        <div className="flex flex-col gap-[var(--ds-space-base)]">
          {/*
            No action rail, no retry, no resolution. An archived run has no live
            authority to act on, so the affordances are absent rather than
            disabled — a disabled control still claims the act exists.
          */}
          <KeyValueList
            items={[
              { key: "Status", value: <StatusBadge status={dsStatusOf(detail.row.status)} /> },
              { key: "Ran under", value: `v${String(detail.archivedIdentity.descriptorVersion)} · ${shortHash(detail.archivedIdentity.contractFingerprint)}` },
              {
                key: "App build",
                value: detail.appVersion.state === "present" ? detail.appVersion.value : detail.appVersion.reason,
                tone: detail.appVersion.state === "present" ? "default" : "warning",
              },
              { key: "Archived", value: `${fmtClock(detail.archivedAt)} by ${detail.archivedBy}` },
              { key: "Why", value: driftWords(detail.drift) },
              { key: "Integrity", value: shortHash(detail.archiveFingerprint) },
            ]}
          />

          <div className="flex flex-col gap-[var(--ds-space-snug)]">
            <SectionLabel>What it did</SectionLabel>
            {steps.length === 0
              ? <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>This run recorded no steps.</p>
              : <TimelineSteps steps={steps} variant="full" label="Archived run timeline" />}
          </div>

          <div className="flex flex-col gap-[var(--ds-space-snug)]">
            <SectionLabel>Evidence</SectionLabel>
            {detail.receipt.state === "present" ? (
              <MetaLine items={[`receipt ${shortHash(String(detail.receipt.value.receiptId))}`, detail.receipt.value.result]} />
            ) : (
              <p className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{detail.receipt.reason}</p>
            )}
            {detail.failure.state === "present" && (
              <MetaLine items={[detail.failure.value.code, detail.failure.value.summary]} />
            )}
            <div className="flex flex-wrap gap-[var(--ds-space-hair)]">
              {detail.evidence.checkpointNodeIds.map((nodeId) => <Chip key={nodeId}>{nodeId}</Chip>)}
              {detail.evidence.writeIntentIds.map((intentId) => (
                <Chip key={intentId} tone="warning">write {shortHash(intentId)}</Chip>
              ))}
            </div>
            <p className={cn(dsText.meta, "text-[color:var(--ds-fg-faint)]")}>
              The write ledger is never archived. What was filed in a real system stays where it was filed.
            </p>
          </div>

          {detail.relaunch.state === "unavailable" ? (
            <Well>
              <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{detail.relaunch.reason}</p>
            </Well>
          ) : detail.relaunches.length > 0 && (
            <div className="flex flex-col gap-[var(--ds-space-hair)]">
              <SectionLabel>Relaunched as</SectionLabel>
              {detail.relaunches.map((entry) => (
                <MetaLine
                  key={entry.runId}
                  items={[
                    entry.runId,
                    `v${String(entry.relaunchedIdentity.descriptorVersion)}`,
                    fmtClock(entry.relaunchedAt),
                  ]}
                />
              ))}
            </div>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}

/* ── the takeover ────────────────────────────────────────────────────────── */

export function ArchiveWorkspace({
  selection,
  actorId,
  onSelection,
  onClose,
}: {
  /** `""` is the ledger; anything else is an archived run id. */
  selection: string;
  actorId: string;
  onSelection: (next: string) => void;
  onClose: () => void;
}) {
  const client = useDashboardClient();
  const enter = useDsEnterTransition();
  const [index, setIndex] = useState<AsyncResource<ArchiveIndexWire>>(LOADING);
  const [detail, setDetail] = useState<AsyncResource<ArchivedRunDetailWire>>(LOADING);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CommandResult | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setIndex(LOADING);
    client.archiveIndex().then(
      (value) => { if (live) setIndex(loaded(value)); },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) { setIndex(failed(error)); return; }
        throw error;
      },
    );
    return () => { live = false; };
  }, [client, nonce]);

  useEffect(() => {
    if (selection === ARCHIVE_INDEX) return undefined;
    let live = true;
    setDetail(LOADING);
    client.archivedRun(selection).then(
      (value) => { if (live) setDetail(loaded(value)); },
      (error: unknown) => {
        if (!live) return;
        if (error instanceof DashboardClientError) { setDetail(failed(error)); return; }
        throw error;
      },
    );
    return () => { live = false; };
  }, [client, selection, nonce]);

  const onCommand = useCallback(
    (request: unknown) => {
      setBusy(true);
      setResult(undefined);
      client.executeCommand(request).then(
        (next) => {
          setResult(next);
          setBusy(false);
          // Any applied command changes what the ledger holds, so the index is
          // re-read rather than patched: this surface has no live stream and a
          // client-side splice would be a second projection of the archive.
          if (next.state === "applied" || next.state === "already-applied") setNonce((value) => value + 1);
        },
        (error: unknown) => {
          setBusy(false);
          if (error instanceof DashboardClientError) {
            setResult({ state: "rejected", commandId: "00000000-0000-4000-8000-000000000000", code: "authority-unavailable", message: error.message } as CommandResult);
            return;
          }
          throw error;
        },
      );
    },
    [client],
  );

  const body = (): ReactNode => {
    if (selection !== ARCHIVE_INDEX) {
      if (detail.state === "loading" || detail.state === "idle") return <Skeleton className="h-64 w-full" />;
      if (detail.state === "failed") {
        return (
          <Refusal title="That archived run could not be read" code="archive-read-failed" outcome="Nothing was changed.">
            <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{detail.error.message}</p>
          </Refusal>
        );
      }
      return (
        <ArchivedRunDetail detail={detail.value} actorId={actorId} busy={busy} onCommand={onCommand} />
      );
    }
    if (index.state === "loading" || index.state === "idle") return <Skeleton className="h-64 w-full" />;
    if (index.state === "failed") {
      return (
        <Refusal title="The archive could not be read" code="archive-read-failed" outcome="Nothing was changed.">
          <p className={cn(dsText.body, "text-[color:var(--ds-fg-secondary)]")}>{index.error.message}</p>
        </Refusal>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-loose)]">
        <ArchiveLedger
          wire={index.value}
          query={query}
          onQuery={setQuery}
          selectedRunId={undefined}
          onSelect={onSelection}
        />
        <VersionBumpPanel
          wire={index.value}
          actorId={actorId}
          busy={busy}
          onCommand={onCommand}
          result={result}
        />
      </div>
    );
  };

  return (
    <Panel
      {...enter}
      aria-label="Archive"
      className={cn(
        "flex-1 data-[demo-enter=from]:translate-y-[calc(-1*var(--ds-travel-sm))]",
        "data-[demo-enter=from]:opacity-0 ds-motion-enter",
      )}
    >
      <PanelBody>
        <div className="flex min-h-0 flex-1 flex-col gap-[var(--ds-space-base)]">
          <PageHeader
            title="Archive"
            badge={<Badge tone="neutral">Read-only</Badge>}
            icon={<ArchiveIcon aria-hidden className={dsIcon.lg} />}
            back={
              <Button
                size="sm"
                variant="ghost"
                icon={<ArrowLeft aria-hidden className={dsIcon.sm} />}
                onClick={() => (selection === ARCHIVE_INDEX ? onClose() : onSelection(ARCHIVE_INDEX))}
              >
                {selection === ARCHIVE_INDEX ? "Dashboard" : "Ledger"}
              </Button>
            }
          />
          {body()}
        </div>
      </PanelBody>
    </Panel>
  );
}
