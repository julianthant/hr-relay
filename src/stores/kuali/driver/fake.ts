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
  /** When set, staging refuses to read back (the `fillWithVerify` failure arm). */
  stagingRefuses?: boolean;
  /**
   * What the EID field displays AFTER staging completes.
   *
   * This is the doc 09 §2.1 case the beat-③ binding proof exists for: the probe
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
   * This is the exact UI-silent failure doc 09 §13 OQ1 (a) records: nothing on
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

  async function read(id: ObservationId): Promise<string> {
    world.events.push(`read:${id}`);
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
    if (stagedTimekeeperName === undefined) {
      throw new Error(
        "Kuali driver refuses to click Save without a staging on this exact page; a Save with nothing "
        + "staged re-submits the document unchanged and Kuali still answers 200 with `Form saved`",
      );
    }
    world.events.push(`commit:${id}`);
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
    openDocument,
    stageTimekeeperName,
    readSavedTimekeeper,
    commit,
  }));
}
