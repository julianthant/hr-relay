import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import type { RunRecordService } from "../../../core/run-record-service.js";
import type { GateResultRecord } from "../../../domain/gates.js";
import type { RunRecord } from "../../../domain/run/record.js";
import type { RunEvidenceReceipt } from "../../../domain/trust/evidence.js";
import type { FailureRecord } from "../../../domain/trust/failure.js";
import type { RunCheckpointRecord } from "../../../domain/workflow/checkpoint.js";
import type { WriteIntentRecord } from "../../../domain/write-safety.js";
import type { AuthorityDatabase, AuthorityRepositories } from "../../../infra/sqlite/authority-database.js";
import type { ProofShape } from "../../../validation/proof-shape.js";
import type { RunQueueProjection } from "../projectors/run-queue-projection.js";
import type { DiagnosticBundleQueryDeps } from "./diagnostic-bundle.js";

/**
 * The trust reads the receipt and failure sections need (D140/D142). They are
 * separate from `getRun` on purpose: the query never opens a database, and a
 * composition that cannot serve trust content must say so by omission rather
 * than by handing in a stub that returns nothing.
 */
export interface RunDetailTrustDeps {
  /** Derive-and-persist the run's receipt; see `ensureRunEvidenceReceipt`. */
  ensureReceipt(runId: string): RunEvidenceReceipt;
  getFailure(failureId: string): FailureRecord | undefined;
  countFailuresByFingerprint(fingerprint: string): number;
}

/**
 * The slice of a workflow descriptor the context-data section reads (2i-C):
 * the detail specs give every served value its field identity, and the
 * `editData` capability is the ONLY source of "this field is correctable" —
 * the same declaration the command kernel enforces on save. Structural and
 * unbranded, so both the registry's broad descriptor view and a test fixture
 * satisfy it.
 */
/**
 * The gate facts the identity-gate section needs, derived from the descriptor by
 * the composition rather than re-derived here.
 *
 * `dependsOn` is what locates the packet: the gate's evidence is the stored
 * output of the node the gate WAITS ON, which is a graph fact, so nothing here
 * hard-codes a node name. `resultSchemaHash` is the descriptor's own gate-schema
 * identity — the exact value the kernel will demand on a `resolve-gate` payload
 * — served so a surface never computes it.
 */
export interface RunDetailGateNodeView {
  readonly nodeId: string;
  readonly label: string;
  readonly dependsOn: readonly string[];
  readonly resultSchemaHash: string;
}

/**
 * ONE transaction node's commit contract, in the shape ref write-safety §4.1's
 * confirmed-present resolution needs (D245).
 *
 * `proofSchemaHash` is `deriveSchemaHash(completion.proofSchema, "output")` —
 * byte for byte the value `resolvePresent` compares an incoming
 * `proof.schemaHash` against, so a surface that echoes it back cannot be
 * refused for naming a schema this build does not have. `proof` is the same
 * schema described as a field list, or the named reason it cannot be.
 */
export interface RunDetailWriteContractView {
  /** The commit task the intent's `taskId` names. */
  readonly commitTaskId: string;
  readonly completionKind: "receipt" | "save-verify" | "upload-verify";
  readonly proofSchemaHash: string;
  readonly proof: ProofShape;
}

/**
 * D252 — one graph node, in the shape the Data rail's origin line needs.
 *
 * Derived at the composition root beside `gateNodes` and `writeContracts`, for
 * the reason those two state: this directory never reaches the descriptor
 * builders or the module's store list, so a query that re-derived a node's
 * label, a task's effect or a freshness precedence would be a second copy of a
 * declaration the runtime already owns.
 *
 * `dir` is the invoked task's own EFFECT, not an inference: ordinary reads and
 * transaction probe/verify roles are `read`; prepare/commit are `write`. `system` is the
 * driver system of the store that implements the task — absent for a headless
 * store, which owns none. `freshness` is pre-resolved per field path through
 * `resolveFreshnessBound`, already in the wire's shape (`unbounded` rather than
 * an `Infinity` that `JSON.stringify` would flatten to `null`); a path with no
 * entry has no declared bound, and a `prepare`/`commit` contract declares no
 * policy at all.
 */
export interface RunDetailDataOriginView {
  readonly nodeId: string;
  readonly step: string;
  /** The producing task contract; node id alone is not an observed-log address. */
  readonly taskId: string;
  /** The transaction beat that invokes the task; ordinary nodes are `task`. */
  readonly role?: "task" | "probe" | "prepare" | "commit" | "verify";
  readonly dir: "read" | "write";
  readonly system?: string;
  readonly freshness?: readonly Readonly<{
    fieldPath: string;
    maxAge: number | "unbounded";
    override: "forbidden" | "audited";
  }>[];
  /** Commit nodes this node's facts can statically reach (ref workflow-model §5.5). */
  readonly feeds: readonly Readonly<{ nodeId: string; label: string }>[];
}

/**
 * What this query reads off a descriptor. `details` was a member until D254:
 * the Context rail joined the retired `span.patched` fold to the descriptor's
 * declared detail specs, and with the fold gone the rail's rows are exactly
 * `capabilities.editData.fields` that recorded a checkpoint. The descriptor
 * still DECLARES `details` — the evidence receipt's mandatory-leaf set, the
 * data-origin bound and the Explorer's field census all read it — this query
 * simply no longer does.
 */
export interface RunDetailDescriptorView {
  /** Ref dashboard-surfaces §1.2: where the RUN resolves the subject's name, if it ever does. */
  readonly subjectProjection?: Readonly<{ nodeId: string; fieldPath: string }>;
  /**
   * D225 — the descriptor's factory-derived categorical timeline (declared
   * categories, or the one-per-node default). Optional in the VIEW only
   * because a fixture may omit it; the registry's descriptors always carry it,
   * and an absent value serves no `steps` (the client then renders events).
   */
  readonly timeline?: readonly Readonly<{
    label: string;
    nodes: readonly Readonly<{ id: string; label: string }>[];
  }>[];
  /** Absent for a descriptor with no gate node; empty is the same answer. */
  readonly gateNodes?: readonly RunDetailGateNodeView[];
  /**
   * D245 — one entry per TRANSACTION node, carrying what ref write-safety §4.1's
   * confirmed-present resolution has to satisfy for that node's commit
   * contract. Derived by the composition root beside `gateNodes` and for the
   * same stated reason: this directory never reaches the descriptor builders,
   * and a query that re-derived a schema hash or re-walked a proof schema
   * would be a second copy of the contract's identity.
   *
   * Absent for a descriptor with no transaction node; empty is the same
   * answer, and a parked run naming a task no entry covers gets a NAMED
   * unavailable reason rather than a form.
   */
  readonly writeContracts?: readonly RunDetailWriteContractView[];
  /**
   * D252 — one entry per node that can produce a Data-section value. Optional
   * in the VIEW only because a fixture may omit it; the registry's descriptors
   * always carry it, and an absent entry serves an entry with no origin block,
   * which is the honest "this build cannot attribute this value".
   */
  readonly dataOrigins?: readonly RunDetailDataOriginView[];
  readonly capabilities?: Readonly<{
    editData?:
      | boolean
      | Readonly<{
        fields: readonly Readonly<{ nodeId: string; fieldPath: string; label: string }>[];
      }>;
  }>;
}

export type CanonicalRunReader = Pick<RunRecordService, "read" | "list">;

export interface RunDetailQueryDeps {
  /** Sole lifecycle read port; separate from the complete Context/Rerun backing bundle. */
  readonly runReader?: CanonicalRunReader;
  /** Explicit canonical backing for consumers that require retained authority reads. */
  readonly canonical?: {
    readonly reader: Pick<RunRecordService, "read" | "list">;
    readonly database: Pick<AuthorityDatabase, "authority" | "withAuthorityReadSnapshot">;
    readonly descriptors: {
      resolve(workflowId: string): AnyWorkflowDescriptor | undefined;
    };
  };
  readonly stateRoot: string;
  readonly projection: RunQueueProjection;
  readonly authority: {
    getRun(runId: string): RunRecord | undefined;
    /** Ref workflow-model §5.7's "latest compatible attempt wins" read, for edit values. */
    latestCheckpoint(
      workflowId: string,
      itemId: string,
      nodeId: string,
    ): RunCheckpointRecord | undefined;
    /**
     * Ref write-safety §4.1: the durable `write_intents` row a `parked-write` run names.
     * Read at REQUEST time, never folded into the projection — the intent is
     * the write-safety authority, and a resolution CASes against the exact
     * generation this read returned. A stale copy would let a browser resolve
     * a generation recovery has since advanced.
     */
    getWriteIntent(writeIntentId: string): WriteIntentRecord | undefined;
    /**
     * D237: every gate this run resolved, oldest first — the SAME
     * `authority.gateResults.listByRun` read D204 gave the receipt. The panel
     * and the receipt therefore cannot disagree about who answered a gate, and
     * the span stream (whose `resolutionKey` is the literal `resolved`) is not
     * consulted for the verdict at all.
     */
    listGateResults(runId: string): readonly GateResultRecord[];
  };
  /** Resolves the CURRENT registered descriptor for a workflow. */
  readonly descriptors: {
    resolve(workflowId: string): RunDetailDescriptorView | undefined;
  };
  /** Absent until a composition wires the 2g trust services. */
  readonly trust?: RunDetailTrustDeps;
  /** DCA3: exact diagnostic authority plus its content-addressed byte verifier. */
  readonly captures?: DiagnosticBundleQueryDeps & Readonly<{
    authority: DiagnosticBundleQueryDeps["authority"]
      & Pick<AuthorityRepositories["diagnosticBundles"], "listByRun">;
  }>;
}
