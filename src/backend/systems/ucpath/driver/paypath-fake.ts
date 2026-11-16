import {
  UCPATH_PAYPATH_DISPLAYED_NAME, UCPATH_PAYPATH_WORK_STUDY_STAGED, UcpathPayPathReadSchema, UcpathPayPathRefusedError, UcpathPayPathStagedSchema,
  UcpathPayPathSubmitRefusedError, UcpathPayPathWorkStudyTargetSchema,
  type UcpathPayPathDriver, type UcpathPayPathRead, type UcpathPayPathRefusalCode, type UcpathPayPathStagedValues, type UcpathPayPathWorkStudyTarget,
} from "../../../../models/ui/ucpath-paypath.js";
import { UCPATH_SS_SMART_HR_DISPLAYED_NAME } from "../../../../models/ui/ucpath-smart-hr-termination.js";
import { UcpathTransactionFindingsSchema, type UcpathTransactionFinding, type UcpathTransactionFindings } from "../../../../models/ui/ucpath-transaction-findings.js";
import type { Eid } from "../../../../rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";

export function refusePayPathOperations(): UcpathPayPathDriver {
  const refuse = async (): Promise<never> => { throw new Error("This UCPath fixture has no PayPath surface"); };
  return { readPayPathPosition: refuse, stagePayPathWorkStudy: refuse, readPayPathSubject: refuse, submitPayPathWorkStudy: refuse };
}

/** How the fixture's Save and Submit behaves: files and answers, refuses with an alert, files but the answer is lost, or answers but nothing was filed. */
export type FakePayPathSubmit = "files" | "alert" | "answer-lost" | "nothing-filed";

/**
 * Deterministic PayPath and SS Smart HR transaction world: the read returns the given read for its own Empl ID or refuses;
 * staging echoes the target unless `stagedValues` overrides what the page kept; Save and Submit adds one Pending row to the transactions.
 */
export function deterministicPayPathOperations(options: Readonly<{
  read?: UcpathPayPathRead; refusal?: UcpathPayPathRefusalCode; alertText?: string; now?: string;
  rows?: readonly UcpathTransactionFinding[]; stagedValues?: Partial<UcpathPayPathStagedValues>; observedName?: string;
  submit?: FakePayPathSubmit; findingsUnreadable?: boolean; stageRefusal?: UcpathPayPathRefusalCode; filedAction?: string;
}>) {
  const now = options.now ?? "2026-08-03T18:00:00.000Z";
  const events: string[] = [];
  const rows = [...options.rows ?? []];
  let staged: UcpathPayPathWorkStudyTarget | undefined;
  const operations: UcpathPayPathDriver = {
    async readPayPathPosition(input) {
      events.push(`read:paypath:${directIdentifierDisplay(input.emplId)}`);
      if (options.refusal !== undefined) throw new UcpathPayPathRefusedError(options.refusal, options.alertText);
      if (options.read === undefined) throw new Error("PayPath fixture requires an explicit read or refusal");
      return UcpathPayPathReadSchema.parse(options.read);
    },
    async stagePayPathWorkStudy(raw) {
      const target = UcpathPayPathWorkStudyTargetSchema.parse(raw);
      staged = undefined;
      events.push(`prepare:paypath:${directIdentifierDisplay(target.emplId)}`);
      if (options.stageRefusal !== undefined) throw new UcpathPayPathRefusedError(options.stageRefusal, options.alertText);
      staged = target;
      return UcpathPayPathStagedSchema.parse({
        pageStateId: UCPATH_PAYPATH_WORK_STUDY_STAGED, emplId: target.emplId, displayedName: await operations.readPayPathSubject(), observedAt: now,
        values: {
          effectiveDate: target.effectiveDate, positionChangeReason: target.positionChangeReason, positionPool: target.positionPool,
          jobDataComments: target.comments, initiatorComments: target.comments, ...options.stagedValues,
        },
      });
    },
    async readPayPathSubject() {
      if (staged === undefined) throw new Error("No staged PayPath subject");
      return options.observedName ?? staged.expectedName;
    },
    async submitPayPathWorkStudy(input, capability) {
      assertMintedMutationCapability(capability);
      const target = staged;
      if (target === undefined || target.emplId !== input.emplId || target.effectiveDate !== input.effectiveDate) throw new Error("PayPath has not been staged");
      staged = undefined;
      events.push(`commit:paypath:${directIdentifierDisplay(target.emplId)}`);
      const submit = options.submit ?? "files";
      if (submit === "alert") throw new UcpathPayPathSubmitRefusedError("Synthetic PayPath save error");
      if (submit === "nothing-filed") return;
      rows.push({
        transactionId: `T${String(9000001 + rows.length).padStart(9, "0")}`, emplId: target.emplId, action: options.filedAction ?? "Data Chg", approvalStatus: "Pending",
        startDate: target.effectiveDate, displayedName: target.expectedName, submittedAt: "08/03/26 11:00:00.000000AM", detailVerified: true,
      });
      if (submit === "answer-lost") throw new Error("fixture-paypath-answer-lost");
    },
  };
  const readTransactionFindings = async (input: Readonly<{ emplId: Eid }>): Promise<UcpathTransactionFindings> => {
    events.push(`read:transactions:${directIdentifierDisplay(input.emplId)}`);
    if (options.findingsUnreadable === true) {
      return UcpathTransactionFindingsSchema.parse({ state: "unreadable", emplId: input.emplId, reason: "fixture transaction search did not settle",
        diagnostic: { state: "not-attempted", cause: "not-indeterminate-settlement" }, observedAt: now });
    }
    const own = rows.filter(row => row.emplId === input.emplId);
    return UcpathTransactionFindingsSchema.parse({ state: "read", emplId: input.emplId, rows: own, scannedRowCount: own.length,
      completeness: { state: "complete", reportedRowCount: own.length }, observedAt: now, source: "ss-smart-hr-list-and-detail" });
  };
  const read = async (id: string): Promise<string> => {
    if (id === UCPATH_PAYPATH_DISPLAYED_NAME) return operations.readPayPathSubject();
    if (id === UCPATH_SS_SMART_HR_DISPLAYED_NAME) return options.observedName ?? options.read?.displayedName ?? "";
    throw new Error(`PayPath fixture cannot read ${id}`);
  };
  return Object.assign(operations, { events, rows, readTransactionFindings, read });
}
