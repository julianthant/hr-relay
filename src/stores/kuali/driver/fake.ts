/**
 * The deterministic Kuali document driver.
 *
 * It models exactly the four page behaviours the transaction proof depends on,
 * and nothing else:
 *
 *  1. the document displays a subject EID (which the caller may set to a
 *     DIFFERENT person, to drive the wrong-subject arm, or make unreadable, to
 *     drive the unknown-subject arm);
 *  2. staging reads back AND reaches Kuali's document model, or throws;
 *  3. `commit` refuses a capability the write sequencer did not mint, refuses a
 *     Save with nothing staged, records the click, and can be made to click a
 *     Save whose mutation drops the staged value (`commitPayloadOmitsValue`);
 *  4. the read-back reflects the persisted value ONLY — it is not affected by
 *     staging, so "staged but never saved" reads `absent` exactly as the live
 *     page would.
 *
 * Every call is appended to `events`, which is what the dry-run proof asserts
 * against: a preview must produce `open`/`stage`/`read` and never `commit`.
 */
import type { Clock } from "../../../domain/clock.js";
import { EidSchema, IsoInstantSchema } from "../../../domain/ids.js";
import type { ElementId, ObservationId } from "../../../domain/ids.js";
import { assertMintedMutationCapability } from "../../../base/mutation-capability.js";
import {
  KUALI_ACTION_LIST_MATCHED_NUMBER,
  KUALI_ACTION_LIST_READY,
  KualiActionListObservationSchema,
} from "../../../domain/ui/kuali-action-list.js";
import type {
  KualiActionListLink,
  KualiActionListObservation,
} from "../../../domain/ui/kuali-action-list.js";
import type { MutationCapability, UiActionProof } from "../../../domain/ui/driver.js";
import { UiActionProofSchema } from "../../../domain/ui/driver.js";
import {
  KUALI_RRSS_DISPLAYED_EID,
  KUALI_RRSS_DISPLAYED_TIMEKEEPER,
  KUALI_RRSS_DOCUMENT_READY,
  KUALI_RRSS_SAVE_BUTTON,
  KUALI_RRSS_TIMEKEEPER_STAGED,
  KualiDocumentViewSchema,
  KualiRrssDocumentDriverSchema,
  KualiTimekeeperReadBackSchema,
  KualiTimekeeperStagingSchema,
} from "../../../domain/ui/kuali-rrss-document.js";
import type {
  KualiDocumentView,
  KualiRrssDocumentDriver,
  KualiTimekeeperReadBack,
  KualiTimekeeperStaging,
} from "../../../domain/ui/kuali-rrss-document.js";
import {
  KUALI_BLANK_OPTION_TEXT,
  KUALI_RRSS_SEPARATION_READY,
  KUALI_SEPARATION_FORM_TYPE,
  KualiSeparationDocumentReadSchema,
  KualiSeparationDocumentSchema,
  KualiTransactionNumberSchema,
  parseKualiFormDate,
} from "../../../domain/ui/kuali-separation-document.js";
import type {
  KualiDateField,
  KualiFinalPayChoice,
  KualiOptionField,
  KualiSeparationDocumentRead,
  KualiTextField,
  KualiTransactionNumberField,
} from "../../../domain/ui/kuali-separation-document.js";
import {
  KUALI_RRSS_FINALIZATION_STAGED,
  KualiCommentsChangedError,
  KualiDepartmentOptionNotOfferedError,
  KualiFinalizationReadBackSchema,
  KualiFinalizationStageNotPersistedError,
  KualiFinalizationStagingSchema,
  KualiFinalizationTargetSchema,
  KualiObservedFinalizationFieldsSchema,
  compareKualiFinalizationFields,
  kualiFinalizationFields,
} from "../../../domain/ui/kuali-separation-finalization.js";
import type {
  KualiFinalizationFieldName,
  KualiFinalizationReadBack,
  KualiFinalizationStaging,
  KualiFinalizationTarget,
  KualiObservedFinalizationFields,
} from "../../../domain/ui/kuali-separation-finalization.js";
import { KUALI_TERMINATION_TYPE_OPTIONS } from "../../../domain/separations/termination-type.js";

/**
 * A document nobody has finalized: every finalization control blank, the
 * department on Kuali's sentinel, no Final Pay radio selected. This is live doc
 * 4502's shape (2026-08-12), and it is the COMMON starting state.
 */
export const KUALI_FAKE_UNFINALIZED_FIELDS: KualiObservedFinalizationFields = Object.freeze({
  department: "- - -",
  payrollTitleCode: "",
  payrollTitle: "",
  requestAcknowledged: false,
  timekeeperName: "",
  // A real unfinalized document normally CARRIES these two — they are required
  // fields the requester fills — but a fake that started them populated would
  // make "the write-back landed" and "nobody touched it" the same observation
  // for every scenario that does not set them deliberately. Blank is the
  // starting state that can only be reached by the write.
  lastDayWorked: "",
  separationDate: "",
  terminationEffectiveDate: "",
  submittedTerminationTemplate: false,
  transactionNumber: "",
  finalPay: null,
  timekeeperComments: "",
});

/**
 * The option lists the live 2026-08-12 form rendered, so a fixture that does
 * not care about a dropdown still produces a document that looks like the real
 * one. `KUALI_TERMINATION_TYPE_OPTIONS` is deliberately the SAME constant the
 * map is built from — a fake with its own copy would pass an option-list drift
 * check that the live page would fail.
 */
const KUALI_FAKE_DIVISION_OPTIONS: readonly string[] = Object.freeze([
  "- - -",
  "Building and Custodial Services",
  "Campus Dining and Retail",
  "Conference Services",
  "Early Childhood Education Center",
  "Facilities and Building Services",
  "Finance, Marketing and Communication",
  "Human Resources",
  "Logistics",
  "Marketing & Client Experience",
  "Payables, Travel and Campus Partnerships",
  "Residential Services and Child Care Solutions",
  "Residential Services",
  "Retail, Procurement and Partnership",
  "Strategic Procurement",
  "Technology Program Management",
  "Triton Print & Digital Media",
  "UC San Diego Bookstore",
]);
const KUALI_FAKE_EMPLOYEE_TYPE_OPTIONS: readonly string[] = Object.freeze([
  "- - -", "Career/Contract", "Limited", "Student", "Contingent Worker (volunteer)",
]);
const KUALI_FAKE_STUDENT_TITLE_CODE_OPTIONS: readonly string[] = Object.freeze([
  "- - -",
  "4921 - STDT 2",
  "4920 - STDT 3",
  "4919 - STDT 4",
  "4331 - ELECTED OFCR STDT GOVT",
  "4944 - STDT RSDNC HALLS",
]);
const KUALI_FAKE_DEPARTMENT_OPTIONS: readonly string[] = Object.freeze([
  "- - -",
  "000141 - Early Childhood Education Center",
  "000412 - Housing/Dining/Hospitality",
  "000414 - Bookstore",
  "000422 - Triton Print & Digital Media",
  "000719 - Supply Chain Services",
]);
const KUALI_FAKE_FINAL_PAY_OPTIONS: readonly string[] = Object.freeze([
  "Submitted Final Pay Request",
  "Does not need Final Pay (student employee)",
  "Does not need Final Pay (transfer employee)",
  "Other",
]);

/**
 * The real RRSS space id (legacy `src/config.ts:131`), repeated here rather
 * than imported: `driver/fake.ts` models the PAGE, and importing the registry's
 * constant would make a fixture's href agree with the registry by construction
 * instead of by observation.
 */
const KUALI_FAKE_SPACE_ID = "5e47518b90adda9474c14adb";

export interface KualiFakeWorld {
  /** Ordered call log: `open:<doc>`, `stage:<value>`, `read:<observation>`, `commit:<element>`. */
  readonly events: string[];
  readonly actionId: string;
  readonly documentNumber: string;
  /** What the document's EID field displays. Set it to another EID to drive a mismatch. */
  displayedEid: string;
  /** The PERSISTED timekeeper value. Staging does not change it; only a commit does. */
  persistedTimekeeperName: string;
  /** When set, the EID field returns this raw string instead of a readable EID. */
  unreadableEid?: string;
  /**
   * The Kuali Build space whose Action List this fake models. It defaults to the
   * real RRSS space so the href shape a fixture writes is the shape the live
   * page carries.
   */
  actionListSpace?: string;
  /**
   * What the Action List renders for a document number, when the fixture wants
   * something other than the ordinary row.
   *
   * Unset means the ordinary LIVE rendering, which is TWO links at this
   * document's own action (Kuali publishes the number in both `Document #` and
   * `Document Title`, measured 2026-08-20). A fixture sets this to drive the
   * refusal arms: an empty array is "not in the Action List", two different
   * hrefs is the ambiguity, and a `null` href is the unlinked cell.
   */
  actionListLinks?: Readonly<Record<string, readonly KualiActionListLink[]>>;
  /** Every bare-number link the filtered list renders. Defaults to the matched ones. */
  actionListListedNumbers?: readonly string[];
  /** When set, reading the Action List throws (a dead page / a lost session). */
  actionListThrows?: Error;
  /** When set, staging refuses to read back (the `fillWithVerify` failure arm). */
  stagingRefuses?: boolean;
  /**
   * What the EID field displays AFTER staging completes.
   *
   * This is the ref write-safety §2.1 case the beat-③ binding proof exists for: the probe
   * and the prepare both saw the right person, then the pooled page moved to a
   * DIFFERENT one before the fence. Set it to another EID to drive the
   * wrong-subject arm, or to an unreadable string to drive the unknown arm.
   */
  displayedEidAfterStage?: string;
  /** Runs at the end of staging — the injection point for probe→fence budget expiry. */
  onStage?: () => void;
  /** When set, the Save click throws AFTER the fence: the landing state is unknown. */
  commitThrows?: Error;
  /**
   * When set, the Save click SUCCEEDS but Kuali silently keeps the old value.
   * This is the exact UI-silent failure ref write-safety §13 OQ1 (a) records: nothing on
   * the page says anything, and only a reload read-back can tell.
   */
  commitDoesNotPersist?: boolean;
  /**
   * When set, the Save click's `submitDocumentV2` does NOT carry the staged
   * value — the exact 2026-08-04 live failure, where Kuali answered `200` and
   * rendered `Form saved` for a mutation whose `data` map had no timekeeper
   * entry at all. The real driver reads the request body and throws; the fake
   * throws the same way and persists nothing.
   */
  commitPayloadOmitsValue?: boolean;
  /**
   * When set, the document model never takes the staged value, so staging's
   * model-commit barrier times out and throws BEFORE any fence exists.
   */
  modelNeverCommits?: boolean;
  /** When set, opening the document throws (a stale action id / dead page). */
  openThrows?: Error;
  /** When set, the reload read-back throws — which must become `unknown`, never `absent`. */
  readBackThrows?: Error;
  /** The exact capability the last commit received. */
  lastCapability?: unknown;
  /**
   * The separation form this document carries, as `readSeparationDocument`
   * would read it off the page. Unset means the fake is a write-only fixture
   * and the read refuses loudly rather than inventing a form.
   */
  separationForm?: KualiFakeSeparationForm;

  /* ── The finalization write (chunk 5) ────────────────────────────────── */

  /**
   * The PERSISTED finalization field set. Staging does not change it; only a
   * commit does — so "staged but never saved" reads exactly as the live page
   * would. Unset means an unfinalized document (`KUALI_FAKE_UNFINALIZED_FIELDS`).
   */
  persistedFinalization?: KualiObservedFinalizationFields;
  /** What the `Department*` control offers. Set it to drive **S55**. */
  finalizationDepartmentOptions?: readonly string[];
  /**
   * Controls the page silently refuses to take, by field name — the
   * `fillWithVerify` failure Kuali is known for. Drives `stage-not-persisted`.
   */
  finalizationStagingDrops?: readonly KualiFinalizationFieldName[];
  /**
   * When set, the document model never takes a staged finalization value, so
   * the model-commit barrier times out and throws BEFORE any fence exists.
   */
  finalizationModelNeverCommits?: boolean;
  /**
   * When set, the Save click SUCCEEDS but Kuali keeps the old finalization —
   * **S59** / D128, the UI-silent failure only a reload read-back can see.
   */
  commitFinalizationDoesNotPersist?: boolean;
}

/**
 * The RAW page values a separation document shows — strings exactly as the
 * controls hold them, NOT the parsed output.
 *
 * The fake models the page, not the schema: a fixture sets `lastDayWorked` to
 * `"31/06/2026"` or `eid` to `"pending"` and the SAME parsing/refusal path the
 * live driver runs decides what that means. A fake that accepted pre-parsed
 * values could never exercise `unparseable-date` at all.
 */
export interface KualiFakeSeparationForm {
  /** `Form - <name> - Kuali`'s middle segment. Set it to drive S2. */
  formType: string;
  employeeName: string;
  eid: string;
  employeeType: string;
  studentTitleCode: string;
  division: string;
  location: string;
  terminationType: string;
  lastDayWorked: string;
  separationDate: string;
  additionalComments: string;
  requestAcknowledged: boolean;
  timekeeperName: string;
  timekeeperComments: string;
  terminationEffectiveDate: string;
  department: string;
  payrollTitleCode: string;
  payrollTitle: string;
  submittedTerminationTemplate: boolean;
  transactionNumber: string;
  finalPay: KualiFinalPayChoice | null;
  /** The option lists the selects render, verbatim. Defaults to the live capture. */
  terminationTypeOptions?: readonly string[];
  departmentOptions?: readonly string[];
  divisionOptions?: readonly string[];
  employeeTypeOptions?: readonly string[];
  studentTitleCodeOptions?: readonly string[];
  /** When set, the document route never renders a document-number heading. */
  headingAbsent?: boolean;
}

export function createKualiFakeWorld(input: Readonly<{
  actionId: string;
  documentNumber: string;
  displayedEid: string;
  /** An unset value means the document's timekeeper field is EMPTY, not unknown. */
  persistedTimekeeperName?: string;
}>): KualiFakeWorld {
  const persisted = input.persistedTimekeeperName === undefined ? "" : input.persistedTimekeeperName;
  return {
    events: [],
    actionId: input.actionId,
    documentNumber: input.documentNumber,
    displayedEid: input.displayedEid,
    persistedTimekeeperName: persisted,
  };
}

export function createDeterministicKualiDriver(
  world: KualiFakeWorld,
  clock: Clock,
): KualiRrssDocumentDriver {
  const now = (): string => IsoInstantSchema.parse(clock.now().toISOString());
  /** What the field currently shows: the staged value if any, else the persisted one. */
  let stagedTimekeeperName: string | undefined;
  /** The finalization staged on this page, if any — the other thing `Save` may commit. */
  let stagedFinalization: KualiObservedFinalizationFields | undefined;
  /** The document number the last Action-List resolve matched on this page. */
  let matchedActionListNumber: string | undefined;
  /** What the field SHOWS: the staged value when one is staged, else the persisted one. */
  const displayedTimekeeper = (): string =>
    (stagedTimekeeperName === undefined ? world.persistedTimekeeperName : stagedTimekeeperName);

  const displayedEidRaw = (): string =>
    (world.unreadableEid === undefined ? world.displayedEid : world.unreadableEid);

  const requireDocument = (input: Readonly<{ actionId: string; documentNumber: string }>): void => {
    if (input.actionId !== world.actionId || input.documentNumber !== world.documentNumber) {
      throw new Error(
        `Kuali fake holds document ${world.documentNumber} (${world.actionId}), not `
        + `${input.documentNumber} (${input.actionId})`,
      );
    }
  };

  const readEid = (): string => {
    const raw = displayedEidRaw();
    const parsed = EidSchema.safeParse(raw.trim());
    if (!parsed.success) {
      throw new Error(
        `Kuali document displays "${raw.slice(0, 4)}…" in the EID field, which is not a UCPath EID; `
        + "refusing to bind a subject to an unreadable identifier",
      );
    }
    return parsed.data;
  };

  async function openDocument(input: Readonly<{
    actionId: string;
    documentNumber: string;
  }>): Promise<KualiDocumentView> {
    world.events.push(`open:${input.documentNumber}`);
    if (world.openThrows !== undefined) throw world.openThrows;
    requireDocument(input);
    return KualiDocumentViewSchema.parse({
      pageStateId: KUALI_RRSS_DOCUMENT_READY,
      actionId: world.actionId,
      documentNumber: world.documentNumber,
      observedEid: readEid(),
      currentTimekeeperName: displayedTimekeeper(),
      observedAt: now(),
    });
  }

  async function stageTimekeeperName(input: Readonly<{
    actionId: string;
    documentNumber: string;
    timekeeperName: string;
  }>): Promise<KualiTimekeeperStaging> {
    const view = await openDocument(input);
    world.events.push(`stage:${input.timekeeperName}`);
    if (world.stagingRefuses === true) {
      throw new Error(
        `Kuali document ${world.documentNumber} did not accept the staged timekeeper value; `
        + "the field reads back differently after two attempts — refusing to reach the fence",
      );
    }
    if (world.modelNeverCommits === true) {
      throw new Error(
        `Kuali document ${world.documentNumber} did not commit the staged timekeeper value into its `
        + "document model within 20000ms (measured commit point: ~723ms after the last keystroke); "
        + "refusing to reach the fence",
      );
    }
    const previous = displayedTimekeeper();
    stagedTimekeeperName = input.timekeeperName;
    const staging = KualiTimekeeperStagingSchema.parse({
      pageStateId: KUALI_RRSS_TIMEKEEPER_STAGED,
      actionId: world.actionId,
      documentNumber: world.documentNumber,
      observedEid: view.observedEid,
      previousTimekeeperName: previous,
      stagedTimekeeperName: input.timekeeperName,
      observedAt: now(),
    });
    world.onStage?.();
    if (world.displayedEidAfterStage !== undefined) {
      // The page moved under us between prepare and the fence.
      const next = world.displayedEidAfterStage;
      if (EidSchema.safeParse(next).success) world.displayedEid = next;
      else world.unreadableEid = next;
    }
    return staging;
  }

  async function readSavedTimekeeper(input: Readonly<{
    actionId: string;
    documentNumber: string;
    timekeeperName: string;
  }>): Promise<KualiTimekeeperReadBack> {
    world.events.push(`read-back:${input.timekeeperName}`);
    try {
      if (world.readBackThrows !== undefined) throw world.readBackThrows;
      requireDocument(input);
      // The reload drops unsaved staging — exactly what the live page does.
      stagedTimekeeperName = undefined;
      const observedEid = readEid();
      if (world.persistedTimekeeperName === input.timekeeperName) {
        return KualiTimekeeperReadBackSchema.parse({
          state: "present",
          proof: {
            kind: "kuali-saved-timekeeper",
            actionId: world.actionId,
            documentNumber: world.documentNumber,
            timekeeperName: input.timekeeperName,
            observedEid,
            source: "reload-read-back",
          },
          observedAt: now(),
        });
      }
      return KualiTimekeeperReadBackSchema.parse({
        state: "absent",
        actionId: world.actionId,
        documentNumber: world.documentNumber,
        observedEid,
        observedTimekeeperName: world.persistedTimekeeperName,
        observedAt: now(),
      });
    } catch (error) {
      return KualiTimekeeperReadBackSchema.parse({
        state: "unknown",
        reason: `Kuali reload read-back failed: ${error instanceof Error ? error.message : "non-Error thrown"}`,
        observedAt: now(),
      });
    }
  }

  const textField = (value: string): KualiTextField => (value.trim().length === 0
    ? { state: "absent", reason: "the control is present on the form and holds no value" }
    : { state: "present", value: value.trim() });

  const optionField = (value: string): KualiOptionField => {
    const trimmed = value.trim();
    return trimmed === KUALI_BLANK_OPTION_TEXT || trimmed.length === 0
      ? {
        state: "absent",
        reason: `the select sits on Kuali's blank sentinel ${JSON.stringify(KUALI_BLANK_OPTION_TEXT)}`,
      }
      : { state: "present", value: trimmed };
  };

  async function readSeparationDocument(input: Readonly<{
    actionId: string;
    documentNumber: string;
  }>): Promise<KualiSeparationDocumentRead> {
    world.events.push(`read-separation:${input.documentNumber}`);
    if (world.openThrows !== undefined) throw world.openThrows;
    const form = world.separationForm;
    if (form === undefined) {
      throw new Error(
        `Kuali fake holds no separation form for document ${world.documentNumber}; a fixture that reads `
        + "one must declare it rather than have the driver invent a page",
      );
    }
    if (form.headingAbsent === true) {
      return KualiSeparationDocumentReadSchema.parse({
        state: "document-unavailable",
        actionId: input.actionId,
        observedUrl: `https://ucsd.kualibuild.com/build/space/x/actions/${input.actionId}/view`,
        reason: `Kuali action ${input.actionId} did not render a document-number heading`,
        observedAt: now(),
      });
    }
    if (world.documentNumber !== input.documentNumber) {
      return KualiSeparationDocumentReadSchema.parse({
        state: "document-number-mismatch",
        actionId: input.actionId,
        expectedNumber: input.documentNumber,
        observedNumber: world.documentNumber,
        observedAt: now(),
      });
    }
    if (form.formType !== KUALI_SEPARATION_FORM_TYPE) {
      return KualiSeparationDocumentReadSchema.parse({
        state: "not-a-separation-document",
        actionId: input.actionId,
        documentNumber: world.documentNumber,
        observedFormType: form.formType,
        observedAt: now(),
      });
    }
    const rawEid = form.eid.trim();
    const parsedEid = rawEid.length === 0 ? undefined : EidSchema.safeParse(rawEid);
    if (parsedEid !== undefined && !parsedEid.success) {
      return KualiSeparationDocumentReadSchema.parse({
        state: "unreadable-eid",
        actionId: input.actionId,
        documentNumber: world.documentNumber,
        raw: rawEid,
        observedAt: now(),
      });
    }
    const dates: readonly (readonly ["lastDayWorked" | "separationDate" | "terminationEffectiveDate", string])[] = [
      ["lastDayWorked", form.lastDayWorked.trim()],
      ["separationDate", form.separationDate.trim()],
      ["terminationEffectiveDate", form.terminationEffectiveDate.trim()],
    ];
    const parsedDates = new Map<string, KualiDateField>();
    for (const [field, raw] of dates) {
      if (raw.length === 0) {
        parsedDates.set(field, {
          state: "absent",
          reason: "the date control is present on the form and holds no value",
        });
        continue;
      }
      const value = parseKualiFormDate(raw);
      if (value === null) {
        return KualiSeparationDocumentReadSchema.parse({
          state: "unparseable-date",
          actionId: input.actionId,
          documentNumber: world.documentNumber,
          field,
          raw,
          observedAt: now(),
        });
      }
      parsedDates.set(field, { state: "present", raw, value });
    }
    const dateField = (field: string): KualiDateField => {
      const value = parsedDates.get(field);
      if (value === undefined) throw new Error(`Kuali fake did not visit date field ${field}`);
      return value;
    };
    const rawTransaction = form.transactionNumber.trim();
    const transactionNumber: KualiTransactionNumberField = rawTransaction.length === 0
      ? { state: "absent", reason: "the transaction-number control is present on the form and holds no value" }
      : KualiTransactionNumberSchema.safeParse(rawTransaction).success
        ? { state: "present", value: rawTransaction }
        : {
          state: "unrecognized",
          raw: rawTransaction,
          reason: "the value is not a UCPath transaction number (T followed by 6-12 digits); it is kept "
            + "verbatim rather than reported as empty, because 'the field holds something we do not "
            + "recognise' and 'the field is empty' are different facts",
        };

    return KualiSeparationDocumentReadSchema.parse({
      state: "read",
      document: KualiSeparationDocumentSchema.parse({
        pageStateId: KUALI_RRSS_SEPARATION_READY,
        actionId: input.actionId,
        documentNumber: world.documentNumber,
        formType: { observed: form.formType, matches: true },
        employee: {
          name: textField(form.employeeName),
          eid: parsedEid === undefined || !parsedEid.success
            ? { state: "absent", reason: "the EID control is present on the form and holds no value" }
            : { state: "present", value: parsedEid.data },
          employeeType: optionField(form.employeeType),
          studentTitleCode: optionField(form.studentTitleCode),
          division: optionField(form.division),
          location: textField(form.location),
        },
        separation: {
          terminationType: optionField(form.terminationType),
          lastDayWorked: dateField("lastDayWorked"),
          separationDate: dateField("separationDate"),
          additionalComments: textField(form.additionalComments),
        },
        timekeeper: {
          requestAcknowledged: form.requestAcknowledged,
          name: textField(form.timekeeperName),
          comments: textField(form.timekeeperComments),
        },
        finalTransactions: {
          terminationEffectiveDate: dateField("terminationEffectiveDate"),
          department: optionField(form.department),
          payrollTitleCode: textField(form.payrollTitleCode),
          payrollTitle: textField(form.payrollTitle),
          submittedTerminationTemplate: form.submittedTerminationTemplate,
          transactionNumber,
          finalPay: form.finalPay === null
            ? { state: "absent", reason: "no Final Pay radio in the group is selected" }
            : { state: "present", value: form.finalPay },
        },
        options: {
          terminationType: form.terminationTypeOptions ?? KUALI_TERMINATION_TYPE_OPTIONS,
          division: form.divisionOptions ?? KUALI_FAKE_DIVISION_OPTIONS,
          employeeType: form.employeeTypeOptions ?? KUALI_FAKE_EMPLOYEE_TYPE_OPTIONS,
          studentTitleCode: form.studentTitleCodeOptions ?? KUALI_FAKE_STUDENT_TITLE_CODE_OPTIONS,
          department: form.departmentOptions ?? KUALI_FAKE_DEPARTMENT_OPTIONS,
          finalPay: KUALI_FAKE_FINAL_PAY_OPTIONS,
        },
        observedAt: now(),
      }),
    });
  }

  /* ── The finalization write (chunk 5) ──────────────────────────────────── */

  const persistedFinalization = (): KualiObservedFinalizationFields =>
    world.persistedFinalization ?? KUALI_FAKE_UNFINALIZED_FIELDS;

  const departmentOptions = (): readonly string[] =>
    world.finalizationDepartmentOptions ?? KUALI_FAKE_DEPARTMENT_OPTIONS;

  async function stageSeparationFinalization(
    input: KualiFinalizationTarget,
  ): Promise<KualiFinalizationStaging> {
    const target = KualiFinalizationTargetSchema.parse(input);
    const fields = kualiFinalizationFields(target.variables);
    stagedFinalization = undefined;
    const view = await openDocument(target);
    world.events.push(`stage-finalization:${target.variables.transactionNumber}`);
    const before = persistedFinalization();

    if (before.timekeeperComments !== target.variables.observedExistingComments) {
      throw new KualiCommentsChangedError({
        documentNumber: world.documentNumber,
        expected: target.variables.observedExistingComments,
        observed: before.timekeeperComments,
      });
    }
    const options = departmentOptions();
    if (!options.includes(fields.department)) {
      throw new KualiDepartmentOptionNotOfferedError({
        documentNumber: world.documentNumber,
        requested: fields.department,
        observedOptions: options,
      });
    }
    if (world.finalizationModelNeverCommits === true) {
      throw new Error(
        `Kuali document ${world.documentNumber} did not commit the staged department value into its `
        + "document model within 20000ms (measured commit point: ~723ms after the last keystroke); "
        + "refusing to reach the fence",
      );
    }

    // Every control the page did NOT silently drop takes its staged value.
    const dropped = new Set(world.finalizationStagingDrops ?? []);
    const settled = KualiObservedFinalizationFieldsSchema.parse({
      ...before,
      ...Object.fromEntries(
        Object.entries(fields).filter(([field]) => !dropped.has(field as KualiFinalizationFieldName)),
      ),
    });
    const mismatches = compareKualiFinalizationFields(fields, settled);
    if (mismatches.length > 0) {
      throw new KualiFinalizationStageNotPersistedError({
        documentNumber: world.documentNumber,
        mismatches,
      });
    }
    stagedFinalization = settled;
    const staging = KualiFinalizationStagingSchema.parse({
      stagedPageState: KUALI_RRSS_FINALIZATION_STAGED,
      actionId: world.actionId,
      documentNumber: world.documentNumber,
      observedEid: view.observedEid,
      previousFields: before,
      stagedFields: fields,
      observedDepartmentOptions: options,
      observedAt: now(),
    });
    world.onStage?.();
    if (world.displayedEidAfterStage !== undefined) {
      // The page moved under us between prepare and the fence.
      const next = world.displayedEidAfterStage;
      if (EidSchema.safeParse(next).success) world.displayedEid = next;
      else world.unreadableEid = next;
    }
    return staging;
  }

  async function readSavedSeparationFinalization(
    input: KualiFinalizationTarget,
  ): Promise<KualiFinalizationReadBack> {
    const target = KualiFinalizationTargetSchema.parse(input);
    world.events.push(`read-back-finalization:${target.variables.transactionNumber}`);
    try {
      if (world.readBackThrows !== undefined) throw world.readBackThrows;
      requireDocument(target);
      // The reload drops unsaved staging — exactly what the live page does.
      stagedFinalization = undefined;
      const observedEid = readEid();
      const expected = kualiFinalizationFields(target.variables);
      const observed = persistedFinalization();
      const mismatches = compareKualiFinalizationFields(expected, observed);
      if (mismatches.length === 0) {
        return KualiFinalizationReadBackSchema.parse({
          state: "present",
          proof: {
            kind: "kuali-saved-finalization",
            actionId: world.actionId,
            documentNumber: world.documentNumber,
            observedEid,
            fields: expected,
            source: "reload-read-back",
          },
          observedAt: now(),
        });
      }
      return KualiFinalizationReadBackSchema.parse({
        state: "absent",
        actionId: world.actionId,
        documentNumber: world.documentNumber,
        observedEid,
        observedFields: observed,
        mismatches,
        observedAt: now(),
      });
    } catch (error) {
      return KualiFinalizationReadBackSchema.parse({
        state: "unknown",
        reason: `Kuali finalization reload read-back failed: ${error instanceof Error ? error.message : "non-Error thrown"}`,
        observedAt: now(),
      });
    }
  }

  /**
   * The Action-List resolve. It states what the list showed and classifies
   * nothing — exactly like the live driver, so the pure fold under test is the
   * production one.
   */
  async function readActionListForDocument(input: Readonly<{
    documentNumber: string;
  }>): Promise<KualiActionListObservation> {
    world.events.push(`action-list:${input.documentNumber}`);
    if (world.actionListThrows !== undefined) throw world.actionListThrows;
    const space = world.actionListSpace ?? KUALI_FAKE_SPACE_ID;
    const authored = world.actionListLinks?.[input.documentNumber];
    const matchedLinks = authored ?? (input.documentNumber === world.documentNumber
      ? [
        { name: input.documentNumber, href: `/build/space/${space}/actions/${world.actionId}` },
        { name: input.documentNumber, href: `/build/space/${space}/actions/${world.actionId}` },
      ]
      : []);
    if (matchedLinks.length > 0) matchedActionListNumber = input.documentNumber;
    return KualiActionListObservationSchema.parse({
      pageStateId: KUALI_ACTION_LIST_READY,
      space,
      requestedDocumentNumber: input.documentNumber,
      matchedLinks,
      listedDocumentNumbers: world.actionListListedNumbers
        ?? matchedLinks.map((link) => link.name),
      observedAt: now(),
    });
  }

  async function read(id: ObservationId): Promise<string> {
    world.events.push(`read:${id}`);
    if (id === KUALI_ACTION_LIST_MATCHED_NUMBER) {
      const matched = matchedActionListNumber;
      if (matched === undefined) {
        throw new Error(`Kuali ${KUALI_ACTION_LIST_MATCHED_NUMBER} has no value on this page`);
      }
      return matched;
    }
    if (id === KUALI_RRSS_DISPLAYED_EID) return readEid();
    if (id === KUALI_RRSS_DISPLAYED_TIMEKEEPER) {
      return displayedTimekeeper().trim();
    }
    throw new Error(`Kuali driver has no observation recipe for ${id}`);
  }

  async function commit(id: ElementId, capability: MutationCapability): Promise<UiActionProof> {
    assertMintedMutationCapability(capability);
    world.lastCapability = capability;
    if (world.commitThrows !== undefined) {
      world.events.push(`commit-threw:${id}`);
      throw world.commitThrows;
    }
    if (id !== KUALI_RRSS_SAVE_BUTTON) {
      throw new Error(`Kuali driver refuses to commit through ${id}; only ${KUALI_RRSS_SAVE_BUTTON} may be clicked`);
    }
    if (stagedTimekeeperName === undefined && stagedFinalization === undefined) {
      throw new Error(
        "Kuali driver refuses to click Save without a staging on this exact page; a Save with nothing "
        + "staged re-submits the document unchanged and Kuali still answers 200 with `Form saved`",
      );
    }
    world.events.push(`commit:${id}`);
    if (stagedFinalization !== undefined) {
      if (world.commitFinalizationDoesNotPersist !== true) {
        world.persistedFinalization = stagedFinalization;
      }
      return UiActionProofSchema.parse({ elementId: id, effect: "external-commit", performed: true });
    }
    if (world.commitPayloadOmitsValue === true) {
      // The click HAPPENED — this is a post-fence throw, exactly like the live
      // case — but the mutation carried nothing of this field, so nothing
      // persists and the caller may never read it as a completed write.
      throw new Error(
        `Kuali save on document ${world.documentNumber} did NOT carry the staged timekeeper value: `
        + `submitDocumentV2 sent null at formKey QGJ63YrCom instead of `
        + `${JSON.stringify(stagedTimekeeperName)}. Kuali accepts and reports success for such a save `
        + "while persisting nothing of this field, so this is reported as a failed write, not a "
        + "completed one",
      );
    }
    if (world.commitDoesNotPersist !== true) {
      world.persistedTimekeeperName = displayedTimekeeper();
    }
    return UiActionProofSchema.parse({ elementId: id, effect: "external-commit", performed: true });
  }

  return Object.freeze(KualiRrssDocumentDriverSchema.parse({
    system: "kuali" as const,
    read,
    readActionListForDocument,
    openDocument,
    readSeparationDocument,
    stageTimekeeperName,
    readSavedTimekeeper,
    stageSeparationFinalization,
    readSavedSeparationFinalization,
    commit,
  }));
}
