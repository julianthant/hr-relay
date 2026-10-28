
import { assertMintedMutationCapability } from "../../../../workflow-kit/mutation-capability.js";
import { IsoInstantSchema } from "../../../../rules/identity/ids.js";
import type { Eid } from "../../../../rules/identity/ids.js";
import { directIdentifierDisplay } from "../../../../rules/redaction/redaction.js";
import { UiActionProofSchema, PageStateProofSchema } from "../../../../models/ui/driver.js";
import type { MutationCapability, UiActionProof } from "../../../../models/ui/driver.js";
import type { UcpathStoreDriver } from "../../../../models/ui/ucpath-driver.js";
import {
  UCPATH_SMART_HR_DETAILS_READY,
  UCPATH_SMART_HR_DETAILS_SCREEN,
  UCPATH_SMART_HR_DISPLAYED_PERSON_NAME,
  UCPATH_SMART_HR_DELETE_SELECTED_BUTTON,
  UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON,
  UCPATH_SMART_HR_TERMINATION_STAGED,
  UCPATH_SMART_HR_IN_PROGRESS_NAME,
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  isUcpathTerminationInProgress,
  UcpathCommitRefusedError,
  UcpathEmplIdNotRecognizedError,
  UcpathPendingSweepStagingSchema,
  UcpathTerminationStagingSchema,
  UcpathTransactionScanSchema,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";
import type {
  UcpathPendingSweepStaging,
  UcpathSsSmartHrSettlementDiagnostic,
  UcpathTerminationStaging,
  UcpathTerminationTarget,
  UcpathTransactionRow,
  UcpathTransactionScan,
} from "../../../../models/ui/ucpath-smart-hr-termination.js";

function refuse(half: string, operation: string): never {
  throw new Error(
    `${half} does not implement \`${operation}\`. The \`ucpath\` store has ONE driver declaration `
    + "covering two unrelated screen families; a fixture answers only the half it was built for, "
    + "because a fabricated answer from the other half would be invented HR data.",
  );
}

/** The Smart HR operations, refused — for a Person Org fixture to spread in. */
export function refuseUnimplementedSmartHrHalf(half: string): Pick<
  UcpathStoreDriver,
  "scanTerminationTransactions" | "stageTermination" | "stagePendingTerminationSweep" | "commit"
> {
  return {
    scanTerminationTransactions: () => refuse(half, "scanTerminationTransactions"),
    stageTermination: () => refuse(half, "stageTermination"),
    stagePendingTerminationSweep: () => refuse(half, "stagePendingTerminationSweep"),
    commit: () => refuse(half, "commit"),
  };
}

/** The Person Org operations, refused — for a Smart HR fixture to spread in. */
function refuseUnimplementedPersonOrgHalf(half: string): Pick<
  UcpathStoreDriver,
  "searchPersonOrg" | "searchPersonMatch" | "readJobSummary"
> {
  return {
    searchPersonMatch: () => refuse(half, "searchPersonMatch"),
    searchPersonOrg: () => refuse(half, "searchPersonOrg"),
    readJobSummary: () => refuse(half, "readJobSummary"),
  };
}

export interface DeterministicSmartHrOptions {
  /** What the rich transaction scan answers. Required — see the module note. */
  readonly scan: UcpathTransactionScan;
  /** What `prepare` staged, if the fixture exercises the prepare arm. */
  readonly staging?: UcpathTerminationStaging;
  /** What the sweep's `prepare` selected, if the fixture exercises it. */
  readonly sweepStaging?: UcpathPendingSweepStaging;
  /** Page B's displayed name, i.e. who UCPath resolved the typed EID to. */
  readonly displayedName?: string;
  /** Set to make the commit report a click UCPath refused (S47/S50). */
  readonly commitPerformed?: boolean;
  // Zero Page-B name anchors model a refused EID lookup, including a person without a terminable job.
  readonly emplIdNotRecognized?: true;

  readonly scanThrows?: string;
}


export function createDeterministicUcpathSmartHrDriver(
  options: DeterministicSmartHrOptions,
): UcpathStoreDriver {
  const half = "the Smart HR termination fixture";
  let screen = UCPATH_SMART_HR_DETAILS_SCREEN;
  return {
    ...refuseUnimplementedPersonOrgHalf(half),
    system: "ucpath",
    async scanTerminationTransactions(input: Readonly<{ emplId: Eid; transactionId?: string }>) {
      if (options.scanThrows !== undefined) throw new Error(options.scanThrows);
      const parsed = UcpathTransactionScanSchema.parse(options.scan);
      if (parsed.emplId !== input.emplId) {
        throw new Error(
          `${half} holds a scan for ${directIdentifierDisplay(parsed.emplId)}, not ${directIdentifierDisplay(input.emplId)}; a scan read off the wrong `
          + "person is not evidence about this one",
        );
      }
      if (parsed.state === "unreadable" || input.transactionId === undefined) return parsed;
      const rows = parsed.rows.filter(row => row.transactionId === input.transactionId);
      return UcpathTransactionScanSchema.parse({ ...parsed, rows, scannedRowCount: rows.length });
    },
    async stageTermination(input) {
      if (options.emplIdNotRecognized === true) {
        throw new UcpathEmplIdNotRecognizedError({
          emplId: input.emplId,
          detail: "the fixture renders no Page-B name anchor for this Empl ID",
        });
      }
      if (options.staging === undefined) refuse(half, "stageTermination");
      const parsed = UcpathTerminationStagingSchema.parse(options.staging);
      if (parsed.emplId !== input.emplId) {
        throw new Error(`${half} holds staging for ${directIdentifierDisplay(parsed.emplId)}, not ${directIdentifierDisplay(input.emplId)}`);
      }
      return parsed;
    },
    async stagePendingTerminationSweep(input) {
      if (options.sweepStaging === undefined) refuse(half, "stagePendingTerminationSweep");
      const parsed = UcpathPendingSweepStagingSchema.parse(options.sweepStaging);
      if (parsed.emplId !== input.emplId) {
        throw new Error(`${half} holds a sweep staging for ${directIdentifierDisplay(parsed.emplId)}, not ${directIdentifierDisplay(input.emplId)}`);
      }
      return parsed;
    },
    async commit(id, capability: MutationCapability): Promise<UiActionProof> {

      assertMintedMutationCapability(capability);
      if (id !== UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON
        && id !== UCPATH_SMART_HR_DELETE_SELECTED_BUTTON) {
        throw new Error(`${half} has no commit element ${String(id)}`);
      }
      if (options.commitPerformed === false) {
        throw new UcpathCommitRefusedError({
          elementId: id,
          refusal: "the fixture models UCPath rendering a refusal after the click",
        });
      }
      return UiActionProofSchema.parse({ elementId: id, effect: "external-commit", performed: true });
    },
    async goto(next) {
      screen = next as typeof UCPATH_SMART_HR_DETAILS_SCREEN;
      return PageStateProofSchema.parse({
        system: "ucpath",
        stateId: UCPATH_SMART_HR_DETAILS_READY,
        matched: true,
      });
    },
    async waitFor(stateId) {
      return PageStateProofSchema.parse({ system: "ucpath", stateId, matched: true });
    },
    async fill(id): Promise<UiActionProof> {
      throw new Error(`${half} has no fillable element ${String(id)}`);
    },
    async read(id) {
      if (id !== UCPATH_SMART_HR_DISPLAYED_PERSON_NAME) {
        throw new Error(`${half} cannot read ${String(id)}`);
      }
      if (options.emplIdNotRecognized === true) {

        throw new Error(
          `${half} renders no Page-B name anchor: UCPath resolved no person for this Empl ID`,
        );
      }
      const name = options.displayedName ?? options.staging?.observedName;
      if (name === undefined) {
        throw new Error(
          `${half} was not given a displayed name, and the beat-③ subject observation is the one `
          + "answer a fixture may never invent",
        );
      }
      if (screen !== UCPATH_SMART_HR_DETAILS_SCREEN) {
        throw new Error(`${half} renders the displayed name on Page B only`);
      }
      return name;
    },
    async click(id): Promise<UiActionProof> {
      throw new Error(`${half} has no registered non-commit click ${String(id)}`);
    },
  };
}

/* ── The stateful world, for the write-sequencer scenarios ───────────────── */


export interface UcpathSmartHrFakeWorld {
  readonly emplId: Eid;
  /** Who UCPath resolves the typed EID to on Page B. */
  displayedName: string;

  displayedNameAfterStage?: string;
  /** The rows the SS Smart HR surface currently carries for this person. */
  rows: UcpathTransactionRow[];
  /** When set, every scan returns this complete unreadable observation (S45/S46). */
  unreadable?: Readonly<{
    reason: string;
    diagnostic: UcpathSsSmartHrSettlementDiagnostic;
  }>;
  /** `open:` / `stage:` / `read:` / `commit:` in order. */
  readonly events: string[];
  /** The capability the last commit received, for the "never minted" assertion. */
  lastCapability?: MutationCapability;
  /** Set false to model a click UCPath refused to perform (S47/S50). */
  commitPerformed: boolean;
  /** The `T…` a successful submit mints. */
  nextTransactionId: string;
  /** What `prepare` last staged, which is what a commit files. */
  staged?: UcpathTerminationTarget;
  /** Stable ids the exact-set prepare selected for deletion. */
  stagedSweepTransactionIds?: string[];
}

/** The `T…` a fixture mints when the caller does not name one. */
const DEFAULT_FIXTURE_RECEIPT = "T009000001";

export function createUcpathSmartHrFakeWorld(input: Readonly<{
  emplId: Eid;
  displayedName: string;
  rows?: readonly UcpathTransactionRow[];
  nextTransactionId?: string;
}>): UcpathSmartHrFakeWorld {
  return {
    emplId: input.emplId,
    displayedName: input.displayedName,

    rows: input.rows === undefined ? [] : [...input.rows],
    events: [],
    commitPerformed: true,
    nextTransactionId: input.nextTransactionId === undefined
      ? DEFAULT_FIXTURE_RECEIPT
      : input.nextTransactionId,
  };
}

export function createDeterministicUcpathSmartHrWorldDriver(
  world: UcpathSmartHrFakeWorld,
  now: () => Date,
): UcpathStoreDriver {
  const half = "the Smart HR termination world";
  const observedAt = (): string => IsoInstantSchema.parse(now().toISOString());
  const scan = (): UcpathTransactionScan => {
    world.events.push("scan");
    if (world.unreadable !== undefined) {
      return UcpathTransactionScanSchema.parse({
        state: "unreadable",
        emplId: world.emplId,
        reason: world.unreadable.reason,
        diagnostic: world.unreadable.diagnostic,
        observedAt: observedAt(),
      });
    }
    return UcpathTransactionScanSchema.parse({
      state: "read",
      emplId: world.emplId,
      rows: world.rows,
      scannedRowCount: world.rows.length,
      observedAt: observedAt(),
    });
  };
  return {
    ...refuseUnimplementedPersonOrgHalf(half),
    system: "ucpath",
    async scanTerminationTransactions(input: Readonly<{ emplId: Eid; transactionId?: string }>) {
      if (input.emplId !== world.emplId) {
        throw new Error(`${half} holds transactions for ${directIdentifierDisplay(world.emplId)}, not ${directIdentifierDisplay(input.emplId)}`);
      }
      const result = scan();
      if (result.state === "unreadable" || input.transactionId === undefined) return result;
      const rows = result.rows.filter(row => row.transactionId === input.transactionId);
      return UcpathTransactionScanSchema.parse({ ...result, rows, scannedRowCount: rows.length });
    },
    async stageTermination(input) {
      world.events.push(`stage:${input.effectiveDate}`);
      world.staged = input;
      return UcpathTerminationStagingSchema.parse({
        stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
        emplId: input.emplId,
        observedName: world.displayedName,
        observedEmplRecord: input.emplRecord,
        template: input.template,
        transactionDate: input.effectiveDate,
        effectiveDate: input.effectiveDate,
        resolvedReasonOption: input.reasonCode,
        observedReasonOptions: [input.reasonCode],
        lastDateWorked: input.lastDateWorked,
        lastDateWorkedOverridden: true,
        transactionIdDisplay: "NEW",
        observedAt: observedAt(),
      });
    },
    async stagePendingTerminationSweep(input) {
      const ordered = [...world.rows].sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId));
      const eligible = ordered.filter(isUcpathTerminationInProgress);
      const protectedRows = ordered.filter((row) => !isUcpathTerminationInProgress(row));
      const facts = (rows: readonly UcpathTransactionRow[]): string => JSON.stringify(rows.map((row) => [
        row.transactionId,
        row.emplId,
        row.action,
        row.approvalStatus,
        row.startDate,
        row.displayedName,
      ]));
      if (facts(eligible) !== facts(input.observedSet.eligible)
        || facts(protectedRows) !== facts(input.observedSet.protected)) {
        throw new Error(
          `${half} current rows do not exactly match the machine-observed pending set; refusing before selection`,
        );
      }
      const selected = eligible.map((row) => ({
        transactionType: "JOB",
        effectiveDate: row.startDate,
        displayedName: row.displayedName,
        emplId: row.emplId,
        action: "Terminatn",
        country: "United States",
        transactionId: row.transactionId,
      }));
      world.stagedSweepTransactionIds = selected.map((row) => row.transactionId);
      world.events.push(`select:${selected.map(({ effectiveDate }) => effectiveDate).join(",")}`);
      return UcpathPendingSweepStagingSchema.parse({
        stagedPageState: UCPATH_SMART_HR_TERMINATION_STAGED,
        emplId: input.emplId,
        observedName: world.displayedName,
        selected,
        observedAt: observedAt(),
      });
    },
    async commit(id, capability: MutationCapability): Promise<UiActionProof> {
      assertMintedMutationCapability(capability);
      world.lastCapability = capability;
      if (id !== UCPATH_SMART_HR_SAVE_AND_SUBMIT_BUTTON
        && id !== UCPATH_SMART_HR_DELETE_SELECTED_BUTTON) {
        throw new Error(`${half} refuses to commit through ${String(id)}`);
      }
      world.events.push(`commit:${String(id)}`);
      if (!world.commitPerformed) {

        throw new UcpathCommitRefusedError({
          elementId: id,
          refusal: "the world models UCPath rendering a refusal after the click",
        });
      }
      if (id === UCPATH_SMART_HR_DELETE_SELECTED_BUTTON) {
        const selected = world.stagedSweepTransactionIds;
        if (selected === undefined) throw new Error(`${half} was asked to delete a set nothing staged`);
        const selectedIds = new Set(selected);
        world.rows = world.rows.filter((row) => !selectedIds.has(row.transactionId));
      } else {
        const staged = world.staged;
        if (staged === undefined) {
          throw new Error(`${half} was asked to submit a wizard nothing staged`);
        }
        world.rows = [...world.rows, {
          transactionId: world.nextTransactionId,
          emplId: staged.emplId,
          action: "TER",
          approvalStatus: "Pending",
          startDate: staged.effectiveDate,
          displayedName: world.displayedName,
        }];
      }
      return UiActionProofSchema.parse({ elementId: id, effect: "external-commit", performed: true });
    },
    async goto(next) {
      world.events.push(`goto:${String(next)}`);
      return PageStateProofSchema.parse({
        system: "ucpath",
        stateId: UCPATH_SMART_HR_DETAILS_READY,
        matched: true,
      });
    },
    async waitFor(stateId) {
      return PageStateProofSchema.parse({ system: "ucpath", stateId, matched: true });
    },
    async fill(id): Promise<UiActionProof> {
      throw new Error(`${half} has no fillable element ${String(id)}`);
    },
    async read(id) {
      world.events.push(`read:${String(id)}`);
      if (id === UCPATH_SMART_HR_DISPLAYED_PERSON_NAME) {
        return world.displayedNameAfterStage ?? world.displayedName;
      }

      if (id === UCPATH_SMART_HR_IN_PROGRESS_NAME) {
        return world.displayedNameAfterStage ?? world.displayedName;
      }
      if (id === UCPATH_SS_SMART_HR_DISPLAYED_NAME) return world.displayedName;
      throw new Error(`${half} cannot read ${String(id)}`);
    },
    async click(id): Promise<UiActionProof> {
      throw new Error(`${half} has no registered non-commit click ${String(id)}`);
    },
  };
}
