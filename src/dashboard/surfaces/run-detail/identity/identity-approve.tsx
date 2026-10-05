/** R1 evidence presentation. The served ceremony and complete bound write plan govern approval. */
import { useEffect, useState } from "react";
import { CheckCircle2, CircleSlash } from "lucide-react";
import { cn } from "../../../lib/utils.js";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  KeyValueList,
  MetaLine,
  RadioGroup,
  Refusal,
  SectionLabel,
  Textarea,
  dsIcon,
  dsText,
  useToasts,
} from "../../../ds/ui.js";
import { RefusedNotice } from "../../shared/actions/refused-notice.js";
import type { Refused } from "../../shared/actions/refused-notice-model.js";
import { identityGateArm, identityComparisonRows } from "./identity-approve-model.js";
import { useDashboardClient } from "../../../state/client-context.js";
import { composeCommandRequest, type CommandAction } from "../../../app/commands/command-dispatch.js";
import { settleCommandResult } from "../../../app/commands/command-result.js";
import {
  EMPTY_IDENTITY_GATE_DRAFT,
  identityCeremonyFor,
  identityDraftProblem,
  identityGateAnswer,
  type IdentityCeremony,
  type IdentityGateAvailable,
  type IdentityGateDetail,
  type IdentityGateDraft,
} from "./identity-ceremony.js";
import { fmtClock } from "../../shared/status/format.js";

/* which arm a served gate command resolves lives in `identity-approve-model.ts` — see the note there */

export interface IdentityApproveTarget {
  readonly gate: IdentityGateAvailable;
  readonly action: CommandAction;
}

type Outcome =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "refused"; refusal: Refused };

/* ── the evidence, in §14.4's own order ──────────────────────────────────── */

function PacketSubject({ gate }: { gate: IdentityGateDetail }) {
  return <div className="operation-identity-context">
    <span>{gate.packet.documentNumber === "protected document" ? "Protected separation document" : gate.packet.documentNumber}</span>
    <time>{fmtClock(gate.packet.observedAt)}</time>
  </div>;
}

function PacketComparisons({ gate }: { gate: IdentityGateDetail }) {
  const rows = identityComparisonRows(gate);
  return <table className="operation-comparison">
    <caption className="sr-only">Identity evidence</caption>
    <thead><tr><th scope="col">Field</th><th scope="col">Request</th><th scope="col">UCPath</th></tr></thead>
    <tbody>{rows.map((row, index) => <tr key={`${row.field}:${String(index)}`} data-disagrees={!row.agrees}>
      <th scope="row">{row.label}</th><td>{row.documentValue}</td><td>{row.ucpathValue}</td>
    </tr>)}</tbody>
  </table>;
}

function PacketCandidates({ gate }: { gate: IdentityGateDetail }) {
  return <section className="operation-candidates" aria-label="Approvable candidates">
    <SectionLabel>Approvable candidates</SectionLabel>
    {gate.options.map(option => <div className="operation-candidate" key={option.eid}>
      <div><strong>{option.displayName}</strong><span>{option.origin}</span></div>
      <span className={dsText.nums}>{option.eid}</span>
    </div>)}
  </section>;
}

/**
 * WHAT THE WRITES WILL CONSUME (§14.10, D211).
 *
 * The approval binds to the digest of the exact packet shown, so these values
 * are inside the packet and a reconciled date that moves after approval
 * re-opens the gate. Rendering them is what turns that binding into something
 * the operator saw: *an approval of a person is not an approval of a date.*
 *
 * The `not-composed` arm prints its stated reason rather than nothing — a graph
 * that files at most one write says so in a sentence somebody wrote, which is
 * exactly why that arm is required rather than optional.
 */
function PacketPlan({ gate }: { gate: IdentityGateDetail }) {
  const { plan } = gate.packet;
  if (plan.state === "not-composed") {
    return (
      <section className="flex flex-col gap-[var(--ds-space-snug)]">
        <SectionLabel>What this approval authorizes</SectionLabel>
        <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>{plan.reason}</span>
      </section>
    );
  }
  const { termination, document, dates } = plan;
  return (
    <section className="operation-bound-plan flex flex-col gap-[var(--ds-space-snug)]">
      <SectionLabel>Planned write values</SectionLabel>
      <KeyValueList
        items={[
          { key: "Termination", value: `${termination.terminationType} · ${termination.classification}` },
          { key: "Template", value: `${termination.template} · reason ${termination.reasonCode}` },
          { key: "Empl record", value: termination.emplRecord },
          { key: "Effective", value: termination.effectiveDate },
          { key: "Last date worked", value: termination.lastDateWorked },
          { key: "Comments", value: termination.initiatorComments },
          ...(document.documentNumber === "protected document" ? [] : [{ key: "Kuali document", value: document.documentNumber }]),
          {
            key: "Department",
            value: `${document.department} (${document.departmentCode}) · UCPath: ${document.ucpathDepartment}`,
          },
          { key: "Payroll title", value: `${document.payrollTitle} (${document.payrollTitleCode})` },
          {
            key: "Last day worked",
            tone: dates.lastDayWorkedChanged ? ("warning" as const) : undefined,
            value: dates.lastDayWorkedChanged
              ? `${dates.lastDayWorked} — the form said ${dates.kualiLastDayWorked}`
              : dates.lastDayWorked,
          },
          {
            key: "Separation date",
            tone: dates.separationDateChanged ? ("warning" as const) : undefined,
            value: dates.separationDateChanged
              ? `${dates.separationDate} — the form said ${dates.kualiSeparationDate}${
                dates.separationDeterminingLeave === null
                  ? ""
                  : ` (${dates.separationDeterminingLeave} leave moved it)`}`
              : dates.separationDate,
          },
          ...(dates.unclassifiedPayCodes.length === 0 ? [] : [{
            key: "Pay codes not counted",
            tone: "warning" as const,
            value: dates.unclassifiedPayCodes.join(", "),
          }]),
        ]}
      />
    </section>
  );
}

export function IdentityGateEvidence({ gate, fullPlan = false }: { gate: IdentityGateDetail; fullPlan?: boolean }) {
  return <div className="operation-identity-evidence">
    <PacketSubject gate={gate} />
    <PacketComparisons gate={gate} />
    <PacketCandidates gate={gate} />
    {gate.packet.jobs.disposition !== "single-active-job" && <table className="operation-comparison">
      <caption>Observed employment</caption><thead><tr><th scope="col">Record</th><th scope="col">Department / title</th><th scope="col">HR status</th></tr></thead>
      <tbody>{gate.packet.jobs.rows.map(row => <tr key={row.rowIndex}><th scope="row">{row.emplRecord}</th><td>{row.department} · {row.jobTitle}</td><td>{row.hrStatus}</td></tr>)}</tbody>
    </table>}
    {!fullPlan && gate.packet.plan.state === "planned" && <dl className="operation-plan-summary">
      <div><dt>Effective date</dt><dd>{gate.packet.plan.termination.effectiveDate}</dd></div>
      <div><dt>Last day worked</dt><dd>{gate.packet.plan.dates.lastDayWorked}</dd></div>
      <div><dt>Template</dt><dd>{gate.packet.plan.termination.template}</dd></div>
      <div><dt>Reason</dt><dd>{gate.packet.plan.termination.reasonCode}</dd></div>
    </dl>}
    {fullPlan && <PacketPlan gate={gate} />}
    <details className="operation-evidence-disclosure">
      <summary>{fullPlan ? "Evidence details" : "Planned write values and evidence details"}</summary>
      <div className="operation-secondary-tools">
        {!fullPlan && <PacketPlan gate={gate} />}
        <KeyValueList items={gate.packet.comparisons.map((row, index) => ({ key: `${row.field} · ${String(index + 1)}`, value: `${row.documentValue} → ${row.ucpathValue} · ${row.note}` }))} />
        <MetaLine items={[`packet ${gate.evidenceDigest}`, `ceremony ${gate.approvalShape}`]} />
      </div>
    </details>
  </div>;
}

/* ── the three ceremonies ────────────────────────────────────────────────── */

/**
 * The control the SERVER asked for, and nothing else.
 *
 * Each arm draws exactly one control, and the arms are not skins of one screen:
 * `choose` presents the candidates as a decision with no default selected —
 * a pre-selected radio is a one-click approve wearing a radio's clothes — and
 * `type-the-eid` presents an empty field, because the whole point of the typing
 * ceremony is that the operator states the answer rather than recognises it.
 */
function CeremonyControl({
  ceremony,
  draft,
  problem,
  disabled,
  showProblem,
  onDraft,
}: {
  ceremony: IdentityCeremony;
  draft: IdentityGateDraft;
  problem: string | undefined;
  disabled: boolean;
  showProblem: boolean;
  onDraft: (next: IdentityGateDraft) => void;
}) {
  switch (ceremony.kind) {
    case "unsupported":
      return (
        <Refusal
          title="This build cannot answer this gate"
          code="identity-approval-ceremony-unsupported"
          outcome="nothing was sent · the run is still held at the gate"
        >
          {ceremony.reason}
        </Refusal>
      );
    case "confirm":
      return (
        <Banner tone="info" title="One unambiguous candidate">
          {ceremony.option.displayName} · EID {ceremony.option.eid}
        </Banner>
      );
    case "choose":
      return (
        <RadioGroup
          label="Which candidate does this separation document mean?"
          name="identity-approval-candidate"
          value={draft.eid}
          onValueChange={(eid) => onDraft({ ...draft, eid })}
          options={ceremony.options.map((option) => ({
            value: option.eid,
            label: <>{option.displayName} · EID {option.eid}</>,
            description: option.origin,
            disabled,
          }))}
        />
      );
    case "type-the-eid":
      return (
        <Field
          label="Type the employee ID this separation is about"
          description="Enter an 8-digit ID shown in this evidence."
          error={showProblem ? problem ?? null : null}
          required
        >
          <Input
            value={draft.eid}
            disabled={disabled}
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            placeholder="10001799"
            onChange={(event) => onDraft({ ...draft, eid: event.target.value.trim() })}
          />
        </Field>
      );
    case "reject":
      return (
        <Field
          label="Why is this not the right person?"
          description="Recorded on the run's failure record. It is the only account of why nothing was filed."
          error={showProblem ? problem ?? null : null}
          required
        >
          <Textarea
            rows={3}
            value={draft.reason}
            disabled={disabled}
            onChange={(event) => onDraft({ ...draft, reason: event.target.value })}
            placeholder="The UCPath detail is a different person — same name, different department, and the document's EID belongs to the STDT 3 in Housing."
          />
        </Field>
      );
  }
}

/**
 * The dialog a served `resolve-gate` descriptor opens.
 *
 * CONFIRM-FIRST in ref frontend-backend-integration §8.5's literal sense: the title, the body and the
 * commit verb are the `confirm` block the SERVER authored. NO OPTIMISTIC
 * AUTHORITY — pressing the verb sends the one command envelope and then shows
 * what came back; a `conflict` or a `rejected` keeps the dialog, keeps every
 * character the operator typed, and prints the server's own sentence.
 *
 * The envelope is composed by `composeCommandRequest`, which is still THE one
 * place a served control becomes a command. This dialog supplies the one thing
 * no served fact carries — the human's answer — and reads the composer's own
 * refusal when the answer does not fit the ceremony.
 */
export function IdentityApproveDialog({
  target,
  actorId,
  onClose,
  onResolved,
}: {
  target: IdentityApproveTarget | null;
  actorId: string;
  onClose: () => void;
  /** A resolved gate moved the run — the owner refetches detail + sections. */
  onResolved: () => void;
}) {
  const client = useDashboardClient();
  const { toast } = useToasts();
  const [draft, setDraft] = useState<IdentityGateDraft>(EMPTY_IDENTITY_GATE_DRAFT);
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });
  const [attempted, setAttempted] = useState(false);

  // A fresh open starts a fresh answer. A refusal does NOT — keeping what the
  // operator authored is the entire point of showing them the refusal.
  useEffect(() => {
    if (target === null) return;
    setDraft(EMPTY_IDENTITY_GATE_DRAFT);
    setOutcome({ state: "idle" });
    setAttempted(false);
  }, [target]);

  if (target === null) return null;
  const { gate, action } = target;
  const served = gate.value;
  const arm = identityGateArm(action);
  const confirm = action.confirm;
  if (arm === undefined || confirm === undefined) {
    // The wire's own `superRefine` pins every action on this section to a
    // `resolve-gate`, and the server authors a confirm block on both. Reaching
    // here means the descriptor changed shape under a surface mid-flight.
    throw new Error(
      `action ${action.key} is not a ref write-safety §14.4 gate resolution with a confirm block`,
    );
  }

  const ceremony = identityCeremonyFor(served, arm);
  const problem = identityDraftProblem(ceremony, draft);
  const sending = outcome.state === "sending";

  const refuse = (refusal: Refused): void => {
    setOutcome({ state: "refused", refusal });
    toast({
      tone: "danger",
      title: "Nothing was recorded",
      description: refusal.code === undefined
        ? refusal.message
        : `${refusal.message} (code ${refusal.code})`,
    });
  };

  const submit = (): void => {
    setAttempted(true);
    if (problem !== undefined) return;
    const answer = identityGateAnswer(ceremony, draft);
    // `identityDraftProblem` said the draft was answerable, so this is
    // unreachable — and it refuses loudly rather than sending a payload nobody
    // composed, because the alternative is a real HR identity decision made
    // from a value this surface invented.
    if (answer === undefined) {
      refuse({ message: `the ${ceremony.kind} ceremony yielded no answer from an accepted draft` });
      return;
    }
    const composed = composeCommandRequest(
      action,
      { runId: served.runId, expectedVersion: action.expectedVersion },
      { actorId, source: "run-detail", gate, gateAnswer: answer },
    );
    if (composed.state === "refused") {
      refuse({ message: composed.reason });
      return;
    }
    setOutcome({ state: "sending" });
    client.executeCommand(composed.request).then((result) => {
      // `conflict` and `rejected` are VALUES, not exceptions (ref frontend-backend-integration §3.4),
      // and the ONE fold says which arm landed (D253, Track D row D3). The
      // refusal is still drawn with the server's own facts, because a gate
      // refusal an operator cannot quote a code for is one nobody can file.
      const settlement = settleCommandResult(result);
      if (settlement.kind === "refused") {
        refuse(
          settlement.reason === "rejected"
            ? { message: settlement.message, code: settlement.code }
            : { message: settlement.message },
        );
        return;
      }
      onResolved();
      onClose();
    }, (caught: unknown) => {
      // A transport failure is not a server refusal and has no code to quote.
      refuse({ message: caught instanceof Error ? caught.message : String(caught) });
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* `lg` for the same reason the park dialog takes it: this body carries
          the packet's comparisons, its candidates, the write plan, a ceremony
          control and a reserved answer slot. */}
      <DialogContent size="lg" title={confirm.title} description={confirm.body}>
        <DialogBody className="flex flex-col gap-[var(--ds-space-cozy)]">
          <IdentityGateEvidence gate={served} fullPlan />

          <CeremonyControl
            ceremony={ceremony}
            draft={draft}
            problem={problem}
            disabled={sending}
            // A refusal suppresses the client-side note: the server has just
            // answered, and a field note above the server's own refusal would
            // be two verdicts on one answer.
            showProblem={attempted && outcome.state !== "refused"}
            onDraft={setDraft}
          />

          {/* RESERVED SPACE — the answer's slot exists before there is an
              answer, so a refusal does not shove the footer out from under a
              pointer already travelling toward it. */}
          <div className="min-h-[var(--ds-h-lg)]">
            {outcome.state === "refused" && (
              <RefusedNotice refusal={outcome.refusal} ceremony="identity-gate" />
            )}
          </div>
        </DialogBody>

        <DialogFooter
          meta={`No approval recorded until confirmed`}
        >
          <Button variant="secondary" onClick={onClose} disabled={sending}>
            Not yet
          </Button>
          {/*
            THE ARM PICKS THE VARIANT AND THE GLYPH. An approval is what binds
            the rest of the separation to a person and is drawn `primary`;
            a rejection ENDS the run and is drawn `danger` with the slashed
            circle. The LABEL stays the server's `confirmLabel` (ref frontend-backend-integration §8.5).

            `disabled` is the CEREMONY's own verdict, not a guess: an
            unsupported shape, an unpicked candidate, an EID the packet never
            showed, an empty reason. Each of those has its sentence beside the
            control it belongs to, and the same sentence rides the button's
            `title` so a pointer that lands here first still gets it.
          */}
          <Button
            variant={arm === "approved" ? "primary" : "danger"}
            disabled={problem !== undefined}
            loading={sending}
            title={problem}
            icon={arm === "approved"
              ? <CheckCircle2 aria-hidden className={dsIcon.md} />
              : <CircleSlash aria-hidden className={dsIcon.md} />}
            onClick={submit}
          >
            {confirm.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
